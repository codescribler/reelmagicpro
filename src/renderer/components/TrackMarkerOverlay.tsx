import React, { useEffect, useRef, useState } from 'react';
import type { Clip, FocusMarkerPathPoint } from '../../shared/types';
import { useProjectStore } from '../state/projectStore';
import { useSettings } from '../state/settings';
import { smoothPath, decimatePath } from '../state/markerPosition';
import { clampPlayhead, frameStepSeconds, snapToFrame, keyToNudgeDelta } from '../state/playhead';

// Tracking workflow:
//   1) Mount in 'track-marker' mode. Video is paused at clip.in.
//   2) On first click: record a starting path point at the click position.
//      Set the marker's `in` to the current source time. Start playback at 0.5×
//      and a requestAnimationFrame loop that samples the cursor every frame
//      against the video's current time — this catches the "user is following
//      a player but holding the mouse still" case where mousemove alone would
//      record almost nothing.
//   3) On second click (or playback reaching clip.out): stop the rAF loop,
//      set the marker's `out` to the current source time, save the path onto
//      the marker, exit to clip mode, and auto-replay so the user sees it.
export function TrackMarkerOverlay({
  clip, markerId, videoRef,
  sourceWidth, sourceHeight, displayWidth, displayHeight,
}: {
  clip: Clip;
  markerId: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  sourceWidth: number;
  sourceHeight: number;
  displayWidth: number;
  displayHeight: number;
}) {
  const updateMarker = useProjectStore(s => s.updateFocusMarker);
  const setMode = useProjectStore(s => s.setPreviewMode);
  const replayClip = useProjectStore(s => s.replayClip);
  const fps = useProjectStore(s => s.project?.sourceVideo.fps ?? 30);
  const skipSeconds = useSettings(s => s.skipSeconds);

  const ref = useRef<HTMLDivElement>(null);
  const recordingRef = useRef(false);
  const pathRef = useRef<FocusMarkerPathPoint[]>([]);
  const lastSampleTimeRef = useRef<number>(-Infinity);
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<'waiting-start' | 'recording' | 'done'>('waiting-start');
  const [sampleCount, setSampleCount] = useState(0);
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number } | null>(null);
  const trackingRate = useSettings(s => s.trackingPlaybackRate);

  // Width/height of the preview marker box at current display scale, so the
  // user sees the same outline they'll get during playback.
  const dispW = clip.focusMarkers.find(m => m.id === markerId)?.width ?? 100;
  const dispH = clip.focusMarkers.find(m => m.id === markerId)?.height ?? 100;
  const boxDisplayW = (dispW / sourceWidth) * displayWidth;
  const boxDisplayH = (dispH / sourceHeight) * displayHeight;

  // Seek the video to clip.in once on mount, slow playback to the configured
  // tracking rate (default 0.5×; lower for fast action), paused. On exit,
  // restore the clip's normal speed.
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

  // Nudge keyboard shortcuts during the waiting-start phase only — once the
  // user clicks to start recording, key events would derail the recorded path,
  // so the handler self-removes when the phase advances.
  // App.tsx's global handler bails out in track-marker mode, so this is the
  // sole keyboard owner for the overlay.
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
      if (e.code === 'ArrowLeft' && !e.shiftKey) {
        e.preventDefault();
        nudge(-skipSeconds);
        return;
      }
      if (e.code === 'ArrowRight' && !e.shiftKey) {
        e.preventDefault();
        nudge(+skipSeconds);
        return;
      }
      const delta = keyToNudgeDelta(
        { code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey },
        fps,
      );
      if (delta !== null) {
        e.preventDefault();
        nudge(delta);
      }
    }
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, [phase, skipSeconds, fps, clip.in, clip.out]);

  // Move the playhead by `delta` seconds, snapped to the nearest source frame
  // and clamped to the active clip's [in, out]. Used by the nudge keyboard
  // shortcuts and the on-screen nudge buttons during the waiting-start phase.
  function nudge(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    const target = snapToFrame(v.currentTime + delta, fps);
    v.currentTime = clampPlayhead(target, clip.in, clip.out);
  }

  function localXY(e: { clientX: number; clientY: number }) {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(displayWidth, e.clientX - r.left)),
      y: Math.max(0, Math.min(displayHeight, e.clientY - r.top)),
    };
  }
  function toSource(x: number, y: number) {
    return {
      sx: (x / displayWidth) * sourceWidth,
      sy: (y / displayHeight) * sourceHeight,
    };
  }

  function appendSample(localX: number, localY: number) {
    const v = videoRef.current;
    if (!v) return;
    const t = Math.max(0, v.currentTime - clip.in);
    if (t - lastSampleTimeRef.current < 0.001) return;
    lastSampleTimeRef.current = t;
    const { sx, sy } = toSource(localX, localY);
    pathRef.current.push({ t, cx: sx, cy: sy });
    setSampleCount(pathRef.current.length);
  }

  // rAF loop: every animation frame, sample current mouse position against
  // current video time. Runs only while recording.
  function rafLoop() {
    if (!recordingRef.current) return;
    const pos = mousePosRef.current;
    if (pos) appendSample(pos.x, pos.y);
    rafRef.current = requestAnimationFrame(rafLoop);
  }

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const p = localXY(e);
    mousePosRef.current = p;
    if (phase === 'waiting-start') {
      pathRef.current = [];
      lastSampleTimeRef.current = -Infinity;
      appendSample(p.x, p.y);
      recordingRef.current = true;
      setPhase('recording');
      v.play().catch(() => {});
      rafRef.current = requestAnimationFrame(rafLoop);
    } else if (phase === 'recording') {
      appendSample(p.x, p.y);
      stopAndSave();
    }
  }

  function onMouseMove(e: React.MouseEvent) {
    const p = localXY(e);
    mousePosRef.current = p;
    setPreviewPos(p);
  }

  function stopAndSave() {
    const v = videoRef.current;
    if (v) v.pause();
    recordingRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPhase('done');
    const rawPath = pathRef.current;
    const saved = rawPath.length >= 2;
    if (saved) {
      // Smooth out hand tremor / per-frame jitter, then thin the path so the
      // exported ffmpeg expression doesn't blow past the OS argv length cap.
      // 15Hz is plenty for smooth linear interpolation between samples.
      const path = decimatePath(smoothPath(rawPath));
      // The marker is visible exactly between the first and second clicks:
      // the path's first/last sample times correspond to those click moments
      // (clip-relative), so we set marker.in/out from them in source seconds.
      const newIn = clip.in + path[0]!.t;
      const newOut = clip.in + path[path.length - 1]!.t;
      updateMarker(clip.id, markerId, { path, in: newIn, out: newOut });
    }
    setMode({ kind: 'clip', clipId: clip.id });
    if (saved) {
      queueMicrotask(() => replayClip());
    }
  }

  function cancel() {
    const v = videoRef.current;
    if (v) v.pause();
    recordingRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setMode({ kind: 'clip', clipId: clip.id });
  }

  // Auto-stop if playback reaches clip.out while recording.
  useEffect(() => {
    if (phase !== 'recording') return;
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (v.currentTime >= clip.out) {
        stopAndSave();
      }
    };
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [phase, clip.out]);

  return (
    <div ref={ref}
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setPreviewPos(null)}
      style={{
        position: 'absolute', inset: 0, cursor: 'crosshair',
        background: 'rgba(0,0,0,0.15)',
      }}>
      <div style={{
        position: 'absolute', top: 8, left: 8, right: 8,
        display: 'flex', justifyContent: 'space-between', gap: 8,
        pointerEvents: 'none',
      }}>
        <span style={{
          background: 'rgba(0,0,0,0.7)', color: 'var(--text)',
          padding: '4px 10px', borderRadius: 3, fontSize: 12,
        }}>
          {phase === 'waiting-start' && `Click on the player to start tracking. Video will play at ${trackingRate}×.`}
          {phase === 'recording' && `Tracking… keep the cursor on the player. Click again to stop. (${sampleCount} samples)`}
        </span>
      </div>
      {/* Nudge controls so the user can advance the playhead to a frame where
          the player is visible before the first click. Hidden once recording
          starts to avoid derailing the path. */}
      {phase === 'waiting-start' && (
        <div
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: 40, left: 8,
            display: 'flex', gap: 4, zIndex: 5,
          }}>
          <button onClick={() => nudge(-skipSeconds)} title={`Skip back ${skipSeconds}s (←)`}>− {skipSeconds}s</button>
          <button onClick={() => nudge(-1)} title="Step back 1s (Shift+,)">−1s</button>
          <button onClick={() => nudge(-frameStepSeconds(fps))} title="Step back 1 frame (,)">◀</button>
          <button onClick={() => nudge(+frameStepSeconds(fps))} title="Step forward 1 frame (.)">▶</button>
          <button onClick={() => nudge(+1)} title="Step forward 1s (Shift+.)">+1s</button>
          <button onClick={() => nudge(+skipSeconds)} title={`Skip forward ${skipSeconds}s (→)`}>+ {skipSeconds}s</button>
        </div>
      )}
      {/* Live preview box at the cursor position so the user sees the size and
          location of what they're recording. */}
      {previewPos && (
        <div style={{
          position: 'absolute',
          left: previewPos.x - boxDisplayW / 2,
          top: previewPos.y - boxDisplayH / 2,
          width: boxDisplayW,
          height: boxDisplayH,
          border: '3px dashed yellow',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }} />
      )}
      <div
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', gap: 6 }}>
        <button onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}
