import React, { useEffect, useRef, useState } from 'react';
import type { Clip, FocusMarkerPathPoint, ReelPanPoint } from '../../shared/types';
import { useProjectStore } from '../state/projectStore';
import { useSettings } from '../state/settings';
import { smoothPath, decimatePath } from '../state/markerPosition';
import { clampPlayhead, frameStepSeconds, snapToFrame, keyToNudgeDelta } from '../state/playhead';

// Reel-framing workflow (mirrors TrackMarkerOverlay, horizontal-only):
//   1) Mount in 'frame-reel' mode. Video paused at clip.in.
//   2) A 9:16 reel box follows the cursor X (vertically centred). The captured
//      square region is clear; the cropped-out sides are dimmed.
//   3) First click: record a starting pan point, play at the tracking rate,
//      sample cursor X every animation frame.
//   4) Second click (or playback reaching clip.out): smooth + decimate the
//      path, save it as clip.reelFraming, exit to clip mode, auto-replay.
export function ReelFrameOverlay({
  clip, videoRef, sourceWidth, sourceHeight, displayWidth, displayHeight,
}: {
  clip: Clip;
  videoRef: React.RefObject<HTMLVideoElement>;
  sourceWidth: number;
  sourceHeight: number;
  displayWidth: number;
  displayHeight: number;
}) {
  const setReelFraming = useProjectStore(s => s.setReelFraming);
  const setMode = useProjectStore(s => s.setPreviewMode);
  const replayClip = useProjectStore(s => s.replayClip);
  const fps = useProjectStore(s => s.project?.sourceVideo.fps ?? 30);
  const skipSeconds = useSettings(s => s.skipSeconds);
  const trackingRate = useSettings(s => s.trackingPlaybackRate);

  const ref = useRef<HTMLDivElement>(null);
  const recordingRef = useRef(false);
  const pathRef = useRef<ReelPanPoint[]>([]);
  const lastSampleTimeRef = useRef<number>(-Infinity);
  const mouseXRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<'waiting-start' | 'recording' | 'done'>('waiting-start');
  const [sampleCount, setSampleCount] = useState(0);
  const [previewX, setPreviewX] = useState<number | null>(null);

  // Square capture side in source px → display px. The 9:16 reel box is taller
  // than the display (it bleeds off top/bottom = the black bars).
  const cropSide = Math.min(sourceWidth, sourceHeight);
  const boxDisplayW = (cropSide / sourceWidth) * displayWidth;
  const boxDisplayH = (cropSide / sourceHeight) * displayHeight; // = displayHeight for landscape
  const halfSrc = cropSide / 2;

  // Seek to clip.in once, slow to the tracking rate, paused & muted. Restore
  // clip speed on exit.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = clip.in;
    v.playbackRate = useSettings.getState().trackingPlaybackRate;
    v.muted = true;
    return () => {
      v.playbackRate = clip.speed;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Nudge shortcuts during waiting-start only (self-removes once recording).
  useEffect(() => {
    if (phase !== 'waiting-start') return;
    function isTyping(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping()) return;
      if (e.code === 'ArrowLeft' && !e.shiftKey) { e.preventDefault(); nudge(-skipSeconds); return; }
      if (e.code === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); nudge(+skipSeconds); return; }
      const delta = keyToNudgeDelta(
        { code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey },
        fps,
      );
      if (delta !== null) { e.preventDefault(); nudge(delta); }
    }
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, [phase, skipSeconds, fps, clip.in, clip.out]);

  function nudge(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    const target = snapToFrame(v.currentTime + delta, fps);
    v.currentTime = clampPlayhead(target, clip.in, clip.out);
  }

  function localX(e: { clientX: number }) {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(displayWidth, e.clientX - r.left));
  }
  // Display x → source cx, clamped so the square slice stays inside the source.
  function toSourceCx(x: number) {
    const sx = (x / displayWidth) * sourceWidth;
    return Math.max(halfSrc, Math.min(sourceWidth - halfSrc, sx));
  }

  function appendSample(displayX: number) {
    const v = videoRef.current;
    if (!v) return;
    const t = Math.max(0, v.currentTime - clip.in);
    if (t - lastSampleTimeRef.current < 0.001) return;
    lastSampleTimeRef.current = t;
    pathRef.current.push({ t, cx: toSourceCx(displayX) });
    setSampleCount(pathRef.current.length);
  }

  function rafLoop() {
    if (!recordingRef.current) return;
    const x = mouseXRef.current;
    if (x !== null) appendSample(x);
    rafRef.current = requestAnimationFrame(rafLoop);
  }

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const x = localX(e);
    mouseXRef.current = x;
    if (phase === 'waiting-start') {
      pathRef.current = [];
      lastSampleTimeRef.current = -Infinity;
      appendSample(x);
      recordingRef.current = true;
      setPhase('recording');
      v.play().catch(() => {});
      rafRef.current = requestAnimationFrame(rafLoop);
    } else if (phase === 'recording') {
      appendSample(x);
      stopAndSave();
    }
  }

  function onMouseMove(e: React.MouseEvent) {
    const x = localX(e);
    mouseXRef.current = x;
    setPreviewX(x);
  }

  function stopAndSave() {
    const v = videoRef.current;
    if (v) v.pause();
    recordingRef.current = false;
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setPhase('done');
    const raw = pathRef.current;
    const saved = raw.length >= 2;
    if (saved) {
      // Reuse the marker path smoothing/decimation helpers. They operate on
      // {t,cx,cy}; carry a constant cy through and drop it on the way out.
      const asPoints: FocusMarkerPathPoint[] = raw.map(p => ({ t: p.t, cx: p.cx, cy: sourceHeight / 2 }));
      const cleaned = decimatePath(smoothPath(asPoints));
      const panPath: ReelPanPoint[] = cleaned.map(p => ({ t: p.t, cx: p.cx }));
      setReelFraming(clip.id, { panPath });
    }
    setMode({ kind: 'clip', clipId: clip.id });
    if (saved) queueMicrotask(() => replayClip());
  }

  function cancel() {
    const v = videoRef.current;
    if (v) v.pause();
    recordingRef.current = false;
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setMode({ kind: 'clip', clipId: clip.id });
  }

  // Auto-stop when playback reaches clip.out while recording.
  useEffect(() => {
    if (phase !== 'recording') return;
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => { if (v.currentTime >= clip.out) stopAndSave(); };
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [phase, clip.out]);

  // Box left edge (display px), centred on the cursor and clamped to bounds.
  const boxLeft = previewX === null
    ? (displayWidth - boxDisplayW) / 2
    : Math.max(0, Math.min(displayWidth - boxDisplayW, previewX - boxDisplayW / 2));
  // The 9:16 reel outline is taller than the display; it extends symmetrically
  // beyond the top/bottom (the black-bar zones).
  const reelDisplayH = boxDisplayW * (1920 / 1080);
  const reelTop = (boxDisplayH - reelDisplayH) / 2;

  return (
    <div ref={ref}
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setPreviewX(null)}
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', overflow: 'hidden' }}>
      {/* Dim the cropped-out sides (left & right of the square capture). */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: boxLeft, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: boxLeft + boxDisplayW, right: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
      {/* The 9:16 reel outline (bleeds off top/bottom = black bars). */}
      <div style={{
        position: 'absolute', left: boxLeft, top: reelTop, width: boxDisplayW, height: reelDisplayH,
        border: '2px dashed rgba(255,255,255,0.8)', boxSizing: 'border-box', pointerEvents: 'none',
      }} />
      {/* The captured square (what's actually rendered, full height). */}
      <div style={{
        position: 'absolute', left: boxLeft, top: 0, width: boxDisplayW, height: boxDisplayH,
        border: '2px solid white', boxSizing: 'border-box', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', top: 8, left: 8, right: 8,
        display: 'flex', justifyContent: 'space-between', gap: 8, pointerEvents: 'none',
      }}>
        <span style={{ background: 'rgba(0,0,0,0.7)', color: 'var(--text)', padding: '4px 10px', borderRadius: 3, fontSize: 12 }}>
          {phase === 'waiting-start' && `Click to start framing the reel. Pan left/right; plays at ${trackingRate}×.`}
          {phase === 'recording' && `Framing… slide left/right to keep the action in shot. Click to stop. (${sampleCount})`}
        </span>
      </div>
      {phase === 'waiting-start' && (
        <div onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
          style={{ position: 'absolute', top: 40, left: 8, display: 'flex', gap: 4, zIndex: 5 }}>
          <button onClick={() => nudge(-skipSeconds)} title={`Skip back ${skipSeconds}s (←)`}>− {skipSeconds}s</button>
          <button onClick={() => nudge(-frameStepSeconds(fps))} title="Step back 1 frame (,)">◀</button>
          <button onClick={() => nudge(+frameStepSeconds(fps))} title="Step forward 1 frame (.)">▶</button>
          <button onClick={() => nudge(+skipSeconds)} title={`Skip forward ${skipSeconds}s (→)`}>+ {skipSeconds}s</button>
        </div>
      )}
      <div onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
        style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', gap: 6 }}>
        <button onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}
