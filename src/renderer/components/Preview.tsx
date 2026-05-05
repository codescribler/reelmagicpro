import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { useSettings } from '../state/settings';
import { previewClock } from '../state/previewClock';
import { markerCentreAt } from '../state/markerPosition';
import { clampPlayhead, snapToFrame } from '../state/playhead';
import { ZoomRegionOverlay } from './ZoomRegionOverlay';
import { FocusPlaceOverlay } from './FocusPlaceOverlay';
import { TrackMarkerOverlay } from './TrackMarkerOverlay';

export function Preview() {
  const project = useProjectStore(s => s.project);
  const previewMode = useProjectStore(s => s.previewMode);
  const setPreviewMode = useProjectStore(s => s.setPreviewMode);
  const requestSkip = useProjectStore(s => s.requestSkip);
  const skipSeconds = useSettings(s => s.skipSeconds);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  // Re-render at video tick rate so focus markers can appear/disappear at
  // their in/out times. Held in state so the JSX re-runs the visibility
  // filter every tick.
  const [tickTime, setTickTime] = useState(0);

  const seqIndex = previewMode.kind === 'sequence' ? previewMode.index : -1;

  const activeClip = (() => {
    if (!project) return null;
    if (previewMode.kind === 'clip'
      || previewMode.kind === 'set-zoom'
      || previewMode.kind === 'place-focus'
      || previewMode.kind === 'track-marker') {
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

  // Replay: rewind to clip.in and play. Triggered by the Replay button in the
  // clip editor incrementing replayToken.
  const replayToken = useProjectStore(s => s.replayToken);
  useEffect(() => {
    if (replayToken === 0) return;
    const v = videoRef.current;
    if (!v || !activeClip) return;
    v.currentTime = activeClip.in;
    v.play().catch(() => {});
  }, [replayToken]);

  // Bookmark seek: when the user clicks a bookmark, the store flips into
  // source mode and bumps seekRequest.token. Jump the video to the requested
  // time, clamped to source duration.
  const seekRequest = useProjectStore(s => s.seekRequest);
  useEffect(() => {
    if (!seekRequest) return;
    const v = videoRef.current;
    if (!v || !project) return;
    v.currentTime = Math.max(0, Math.min(project.sourceVideo.duration, seekRequest.time));
  }, [seekRequest?.token]);

  // Relative skip nudges. Single mechanism shared with the clip editor's
  // skip buttons via the store so both call-sites do the same thing. When an
  // active clip is in scope, clamp to its [in, out] so a frame-step or second-
  // step doesn't push past the clip boundary; otherwise clamp to source range.
  // snapToFrame keeps the playhead on the source-frame grid across many nudges.
  const skipRequest = useProjectStore(s => s.skipRequest);
  useEffect(() => {
    if (!skipRequest) return;
    const v = videoRef.current;
    if (!v || !project) return;
    const target = snapToFrame(v.currentTime + skipRequest.delta, project.sourceVideo.fps);
    const lo = activeClip ? activeClip.in : 0;
    const hi = activeClip ? activeClip.out : project.sourceVideo.duration;
    v.currentTime = clampPlayhead(target, lo, hi);
  }, [skipRequest?.token]);

  // External pause requests. The timeline's "Set out (from preview)" button
  // uses this so the playhead actually rests on the moment that was marked.
  const pauseRequest = useProjectStore(s => s.pauseRequest);
  useEffect(() => {
    if (!pauseRequest) return;
    videoRef.current?.pause();
  }, [pauseRequest?.token]);

  // On reaching clip.out, either pause (clip mode) or advance / end (sequence).
  // On press of play while paused at the clip's end, rewind to clip.in so the
  // clip plays again instead of being stuck.
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
    function onPlay() {
      if (!v || !activeClip) return;
      // If the user hits play while at (or past) the clip's out-point, rewind
      // to in so playback restarts the clip rather than instantly pausing.
      if (v.currentTime >= activeClip.out - 0.05) {
        v.currentTime = activeClip.in;
      }
    }
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
    };
  }, [activeClip?.id, activeClip?.in, activeClip?.out, previewMode.kind, seqIndex, project, setPreviewMode]);

  // Mirror the playhead into the shared previewClock so the Timeline's
  // "Set in / Set out from preview" buttons can read the current time, and
  // drive a state update so focus markers re-evaluate visibility / position.
  //
  // We use a continuous requestAnimationFrame loop instead of the video's
  // 'timeupdate' event because timeupdate fires at only ~4-30 Hz, which makes
  // a marker moving along a recorded path look jerky. rAF gives 60+ Hz, and
  // React skips re-renders when setTickTime is called with the same value, so
  // there's no cost while the video is paused.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      previewClock.currentTime = v.currentTime;
      setTickTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [project?.sourceVideo.path]);

  if (!project) return <span className="dim">Open a video to begin</span>;

  const sw = project.sourceVideo.width;
  const sh = project.sourceVideo.height;
  const dw = sw * fit;
  const dh = sh * fit;

  const isSetZoom = previewMode.kind === 'set-zoom';
  const isPlaceFocus = previewMode.kind === 'place-focus';
  const isTrackMarker = previewMode.kind === 'track-marker';
  // While placing or tracking a focus marker we temporarily disable the zoom
  // transform so the user can interact with the full source frame.
  const suspendZoom = isSetZoom || isPlaceFocus || isTrackMarker;

  let zoomTransform = '';
  let zoomFactor = 1;
  if (activeClip && !suspendZoom) {
    const z = activeClip.zoom;
    const fullFrame = z.x === 0 && z.y === 0 && z.width === sw && z.height === sh;
    if (!fullFrame) {
      const sx = sw / z.width;
      const sy = sh / z.height;
      const tx = -z.x * fit;
      const ty = -z.y * fit;
      zoomTransform = `scale(${sx}, ${sy}) translate(${tx}px, ${ty}px)`;
      zoomFactor = sx;
    }
  }
  const isZoomed = zoomFactor > 1.001;

  // Markers visible at the current playhead. In clip / sequence mode the
  // playhead is the video's currentTime in source seconds. In editing modes
  // we hide markers.
  const visibleMarkers = (() => {
    if (!activeClip || suspendZoom) return [];
    return activeClip.focusMarkers.filter(m => tickTime >= m.in && tickTime <= m.out);
  })();
  const clipRelT = activeClip ? Math.max(0, tickTime - activeClip.in) : 0;

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
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
          controls={!suspendZoom && !isZoomed}
          style={{
            position: 'absolute', top: 0, left: 0,
            width: dw, height: dh,
            transformOrigin: '0 0',
            transform: zoomTransform,
          }}
        />
        {/* Focus marker overlays — same transform as the video so they stay
            anchored to the source pixels they were placed on, and inherit the
            zoom transform too. */}
        {visibleMarkers.length > 0 && (
          <div style={{
            position: 'absolute', top: 0, left: 0,
            width: dw, height: dh,
            transformOrigin: '0 0',
            transform: zoomTransform,
            pointerEvents: 'none',
          }}>
            {visibleMarkers.map(m => {
              const { cx, cy } = markerCentreAt(m, clipRelT);
              const left = (cx - m.width / 2) * fit;
              const top = (cy - m.height / 2) * fit;
              const w = m.width * fit;
              const h = m.height * fit;
              return (
                <React.Fragment key={m.id}>
                  <div style={{
                    position: 'absolute',
                    left, top, width: w, height: h,
                    borderTop: `1px solid ${m.color}`,
                    borderLeft: `1px solid ${m.color}`,
                    borderRight: `1px solid ${m.color}`,
                    borderBottom: `4px solid ${m.color}`,
                    boxSizing: 'border-box',
                  }} />
                  {m.label && (
                    <div style={{
                      position: 'absolute',
                      left: left + w / 2,
                      top: top + h + 4,
                      transform: 'translateX(-50%)',
                      background: 'rgba(0,0,0,0.7)',
                      color: m.color,
                      padding: '2px 8px',
                      borderRadius: 3,
                      fontSize: 13 * fit + 8,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                    }}>{m.label}</div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
        {isZoomed && !suspendZoom && (
          <>
            <div
              onClick={togglePlay}
              title="Click to play/pause"
              style={{
                position: 'absolute', inset: 0, cursor: 'pointer',
                background: 'transparent',
              }}
            />
            <div style={{
              position: 'absolute', top: 8, right: 8,
              background: 'rgba(0,0,0,0.6)', color: 'var(--text)',
              padding: '2px 8px', borderRadius: 3, fontSize: 11,
              pointerEvents: 'none',
            }}>
              Zoom {zoomFactor.toFixed(1)}× — click to play/pause
            </div>
          </>
        )}
        {/* Skip ±5s controls. Sit on top of any click-to-play overlay so they
            stay clickable, but hide during the editing modes (set-zoom etc.)
            since those drive their own interactions. */}
        {!suspendZoom && (
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: 8, left: 8,
              display: 'flex', gap: 4, zIndex: 5,
            }}>
            <button
              onClick={e => { e.stopPropagation(); requestSkip(-skipSeconds); }}
              title={`Skip back ${skipSeconds} seconds (← arrow)`}>
              − {skipSeconds}s
            </button>
            <button
              onClick={e => { e.stopPropagation(); requestSkip(+skipSeconds); }}
              title={`Skip forward ${skipSeconds} seconds (→ arrow)`}>
              + {skipSeconds}s
            </button>
          </div>
        )}
        {isSetZoom && previewMode.kind === 'set-zoom' && (
          <ZoomRegionOverlay
            clipId={previewMode.clipId}
            sourceWidth={sw}
            sourceHeight={sh}
            displayWidth={dw}
            displayHeight={dh}
          />
        )}
        {isPlaceFocus && previewMode.kind === 'place-focus' && (
          <FocusPlaceOverlay
            clipId={previewMode.clipId}
            markerId={previewMode.markerId}
            sourceWidth={sw}
            sourceHeight={sh}
            displayWidth={dw}
            displayHeight={dh}
          />
        )}
        {isTrackMarker && previewMode.kind === 'track-marker' && activeClip && (
          <TrackMarkerOverlay
            clip={activeClip}
            markerId={previewMode.markerId}
            videoRef={videoRef}
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
