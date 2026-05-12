import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { useSettings } from '../state/settings';

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

// Slim custom transport bar that replaces the native <video controls>. Sits
// at the bottom of the preview, fades into the picture, and adapts its scrub
// range to whatever's playing — full source in source mode, clip range in
// clip / sequence mode — so the dot reflects the user's mental model rather
// than the underlying source seconds.
export function TransportBar({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement> }) {
  const project = useProjectStore(s => s.project);
  const previewMode = useProjectStore(s => s.previewMode);
  const activeSourceId = useProjectStore(s => s.activeSourceId);
  const requestSkip = useProjectStore(s => s.requestSkip);
  const skipSeconds = useSettings(s => s.skipSeconds);

  const [isPlaying, setIsPlaying] = useState(false);
  const [tickTime, setTickTime] = useState(0);
  const scrubRef = useRef<HTMLDivElement>(null);

  // Track play/pause so the toggle button shows the right glyph.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setIsPlaying(!v.paused);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [project?.sourceVideo.path]);

  // rAF poll of currentTime — same trick the rest of the app uses for the
  // playhead. Cheap because setTickTime with the same value is a no-op.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setTickTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!project) return null;

  const activeClip = (() => {
    if (previewMode.kind === 'clip'
      || previewMode.kind === 'set-zoom'
      || previewMode.kind === 'track-marker') {
      return project.clips.find(c => c.id === previewMode.clipId) ?? null;
    }
    if (previewMode.kind === 'sequence') {
      const entry = project.sequence[previewMode.index];
      return entry ? project.clips.find(c => c.id === entry.clipId) ?? null : null;
    }
    return null;
  })();

  // For source-mode scrubbing, the scrubber's range is the ACTIVE source's
  // duration, not the project primary's — multi-source projects let the
  // scrubber follow whichever source is currently loaded.
  const activeSourceDuration = (
    project.sources.find(s => s.id === activeSourceId)
    ?? project.sources[0]
    ?? project.sourceVideo
  ).duration;
  const rangeStart = activeClip ? activeClip.in : 0;
  const rangeEnd = activeClip ? activeClip.out : activeSourceDuration;
  const rangeDuration = Math.max(0.0001, rangeEnd - rangeStart);
  const localTime = Math.max(0, Math.min(rangeDuration, tickTime - rangeStart));
  const pct = (localTime / rangeDuration) * 100;

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function seekToFrac(frac: number) {
    const v = videoRef.current;
    if (!v) return;
    const localT = Math.max(0, Math.min(rangeDuration, frac * rangeDuration));
    v.currentTime = rangeStart + localT;
  }

  function onScrubDown(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const seek = (clientX: number) => {
      const el = scrubRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      seekToFrac(x / rect.width);
    };
    seek(e.clientX);
    const onMove = (ev: MouseEvent) => seek(ev.clientX);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div
      className="transport-bar"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}>
      <button
        className="transport-btn play-btn"
        onClick={togglePlay}
        title={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? '⏸' : '▶'}
      </button>
      <button
        className="transport-btn"
        onClick={() => requestSkip(-skipSeconds)}
        title={`Skip back ${skipSeconds}s (← arrow)`}>
        −{skipSeconds}s
      </button>
      <button
        className="transport-btn"
        onClick={() => requestSkip(+skipSeconds)}
        title={`Skip forward ${skipSeconds}s (→ arrow)`}>
        +{skipSeconds}s
      </button>
      <div
        ref={scrubRef}
        className="scrub-wrap"
        onMouseDown={onScrubDown}
        title={activeClip ? 'Scrub within this clip' : 'Scrub the source video'}>
        <div className="scrub-track">
          <div className="scrub-progress" style={{ width: `${pct}%` }} />
          <div className="scrub-thumb" style={{ left: `${pct}%` }} />
        </div>
      </div>
      <span className="transport-time">{fmtTime(localTime)} / {fmtTime(rangeDuration)}</span>
    </div>
  );
}
