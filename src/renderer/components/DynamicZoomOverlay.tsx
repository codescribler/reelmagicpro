import React, { useEffect, useRef, useState } from 'react';
import type { CameraPoint, CameraView, Clip, SourceMeta } from '../../shared/types';
import { easeCamera, pointerTarget, wheelZoom } from '../../shared/dynamicZoom';
import { useProjectStore } from '../state/projectStore';
import '../styles/dynamicZoom.css';

export function DynamicZoomOverlay({ clip, source, videoRef, onView }: {
  clip: Clip;
  source: SourceMeta;
  videoRef: React.RefObject<HTMLVideoElement>;
  onView: (view: CameraView) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const view = useRef<CameraView>({ cx: source.width / 2, cy: source.height / 2, zoom: 1 });
  const target = useRef({ ...view.current });
  const points = useRef<CameraPoint[]>([]);
  const recording = useRef(false);
  const finished = useRef(false);
  const [phase, setPhase] = useState<'ready' | 'recording'>('ready');
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');

  function finish(save: boolean) {
    if (finished.current) return;
    finished.current = true;
    const v = videoRef.current;
    v?.pause();
    if (save && recording.current && v) {
      const t = Math.min(clip.out - clip.in, Math.max(0, v.currentTime - clip.in));
      const last = points.current[points.current.length - 1];
      if (!last || t > last.t) points.current.push({ t, ...view.current });
      // Draft samples only enter the project when explicitly saved.
      useProjectStore.getState().updateClip(clip.id, { zoomPath: points.current });
    }
    recording.current = false;
    useProjectStore.getState().setPreviewMode({ kind: 'clip', clipId: clip.id });
    if (save) useProjectStore.getState().replayClip();
  }

  async function start() {
    const v = videoRef.current;
    if (!v || !ready || recording.current || finished.current) return;
    setError('');
    v.currentTime = clip.in;
    points.current = [{ t: 0, ...view.current }];
    recording.current = true;
    setPhase('recording');
    try { await v.play(); }
    catch {
      if (finished.current) return;
      recording.current = false;
      setPhase('ready');
      setError('Playback could not start. Try recording again.');
    }
  }

  useEffect(() => {
    const v = videoRef.current;
    const el = surface.current;
    if (!v || !el) return;
    finished.current = false;
    const prepare = () => { v.pause(); v.currentTime = clip.in; setReady(true); };
    if (v.readyState >= 1) prepare();
    else v.addEventListener('loadedmetadata', prepare, { once: true });
    let raf = 0;
    let previousWall = performance.now();
    let previousTime = clip.in;
    const tick = (now: number) => {
      if (finished.current) return;
      const time = Math.min(clip.out, v.currentTime);
      // Any external rewind discards this draft rather than mixing two takes.
      if (recording.current && time < previousTime - 0.001) { finish(false); return; }
      const dt = recording.current ? Math.max(0, time - Math.max(clip.in, previousTime)) : Math.min(0.05, (now - previousWall) / 1000);
      view.current = easeCamera(view.current, target.current, dt, source);
      onView(view.current);
      setZoom(view.current.zoom);
      if (recording.current) {
        const t = Math.max(0, time - clip.in);
        const last = points.current[points.current.length - 1]!;
        if (t - last.t >= 1 / 30) points.current.push({ t, ...view.current });
        if (time >= clip.out || v.ended) { finish(true); return; }
      }
      previousTime = time;
      previousWall = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      target.current.zoom = wheelZoom(target.current.zoom, e.deltaY, e.deltaMode);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(false); }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      finished.current = true;
      recording.current = false;
      cancelAnimationFrame(raf);
      el.removeEventListener('wheel', wheel);
      document.removeEventListener('keydown', key, true);
      v.removeEventListener('loadedmetadata', prepare);
      v.pause();
    };
  }, []);

  function point(e: { clientX: number; clientY: number }) {
    const bounds = surface.current!.getBoundingClientRect();
    const focus = pointerTarget(view.current, (e.clientX - bounds.left) / bounds.width,
      (e.clientY - bounds.top) / bounds.height, source);
    target.current = { ...target.current, ...focus };
  }

  function toggleRecording() {
    if (recording.current) finish(true);
    else void start();
  }

  return (
    <div ref={surface} className="dynamic-zoom-overlay" onPointerMove={point}
      role="button" tabIndex={0} aria-disabled={!ready}
      aria-label={phase === 'recording' ? 'Stop and save zoom recording' : 'Start zoom recording'}
      onClick={e => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (!recording.current) point(e);
        toggleRecording();
      }}
      onKeyDown={e => {
        if (e.code !== 'Space' && e.code !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) toggleRecording();
      }}>
      <div className="dynamic-zoom-hint" role="status">
        {phase === 'recording' ? '● Recording zoom — click to stop and save' : 'Click the video to start recording'} · {zoom.toFixed(1)}×
        <span>Follow the action with your pointer. Scroll up to zoom in, down for context.</span>
        <span>Esc cancels.</span>
        {error && <span role="alert">{error}</span>}
      </div>
    </div>
  );
}
