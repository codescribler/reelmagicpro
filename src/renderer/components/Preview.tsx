import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { ZoomRegionOverlay } from './ZoomRegionOverlay';

export function Preview() {
  const project = useProjectStore(s => s.project);
  const previewMode = useProjectStore(s => s.previewMode);
  const setPreviewMode = useProjectStore(s => s.setPreviewMode);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  const seqIndex = previewMode.kind === 'sequence' ? previewMode.index : -1;

  const activeClip = (() => {
    if (!project) return null;
    if (previewMode.kind === 'clip' || previewMode.kind === 'set-zoom') {
      return project.clips.find(c => c.id === previewMode.clipId) ?? null;
    }
    if (previewMode.kind === 'sequence') {
      const entry = project.sequence[previewMode.index];
      if (!entry) return null;
      return project.clips.find(c => c.id === entry.clipId) ?? null;
    }
    return null;
  })();

  useLayoutEffect(() => {
    if (!containerRef.current || !project) return;
    const c = containerRef.current;
    const update = () => {
      const sx = c.clientWidth / project.sourceVideo.width;
      const sy = c.clientHeight / project.sourceVideo.height;
      setFit(Math.max(0.0001, Math.min(sx, sy, 1)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(c);
    return () => ro.disconnect();
  }, [project?.sourceVideo.width, project?.sourceVideo.height]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (activeClip) {
      v.playbackRate = activeClip.speed;
      v.muted = activeClip.speed !== 1;
    } else {
      v.playbackRate = 1;
      v.muted = false;
    }
  }, [activeClip?.speed, activeClip?.id, seqIndex]);

  // Seek to clip in-point when entering a new clip OR new sequence index (even
  // if it's the same clip id as the previous sequence entry).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeClip) return;
    v.currentTime = activeClip.in;
    if (previewMode.kind === 'sequence') {
      v.play().catch(() => {});
    }
  }, [activeClip?.id, previewMode.kind, seqIndex]);

  // On reaching clip.out, either pause (clip mode) or advance / end (sequence).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeClip || !project) return;
    function onTime() {
      if (!v || !activeClip || !project) return;
      if (v.currentTime >= activeClip.out) {
        if (previewMode.kind === 'sequence') {
          const next = previewMode.index + 1;
          if (next < project.sequence.length) {
            setPreviewMode({ kind: 'sequence', index: next });
          } else {
            v.pause();
            setPreviewMode({ kind: 'source' });
          }
        } else {
          v.pause();
          v.currentTime = activeClip.out;
        }
      }
    }
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [activeClip?.id, activeClip?.out, previewMode.kind, seqIndex, project, setPreviewMode]);

  if (!project) return <span className="dim">Open a video to begin</span>;

  const sw = project.sourceVideo.width;
  const sh = project.sourceVideo.height;
  const dw = sw * fit;
  const dh = sh * fit;

  const isSetZoom = previewMode.kind === 'set-zoom';

  let zoomTransform = '';
  if (activeClip && !isSetZoom) {
    const z = activeClip.zoom;
    const fullFrame = z.x === 0 && z.y === 0 && z.width === sw && z.height === sh;
    if (!fullFrame) {
      const sx = sw / z.width;
      const sy = sh / z.height;
      const tx = -z.x * fit;
      const ty = -z.y * fit;
      zoomTransform = `scale(${sx}, ${sy}) translate(${tx}px, ${ty}px)`;
    }
  }

  return (
    <div ref={containerRef} style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'relative',
        width: dw, height: dh,
        overflow: 'hidden',
        background: 'black',
      }}>
        <video
          ref={videoRef}
          src={`file://${project.sourceVideo.path}`}
          controls={!isSetZoom}
          style={{
            position: 'absolute', top: 0, left: 0,
            width: dw, height: dh,
            transformOrigin: '0 0',
            transform: zoomTransform,
          }}
        />
        {isSetZoom && previewMode.kind === 'set-zoom' && (
          <ZoomRegionOverlay
            clipId={previewMode.clipId}
            sourceWidth={sw}
            sourceHeight={sh}
            displayWidth={dw}
            displayHeight={dh}
          />
        )}
      </div>
    </div>
  );
}
