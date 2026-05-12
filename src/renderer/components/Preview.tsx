import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { previewClock } from '../state/previewClock';
import { markerCentreAt } from '../state/markerPosition';
import { clampPlayhead, snapToFrame } from '../state/playhead';
import { ZoomRegionOverlay } from './ZoomRegionOverlay';
import { TrackMarkerOverlay } from './TrackMarkerOverlay';
import { TransportBar } from './TransportBar';

export function Preview() {
  const project = useProjectStore(s => s.project);
  const previewMode = useProjectStore(s => s.previewMode);
  const setPreviewMode = useProjectStore(s => s.setPreviewMode);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
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

  // Backing track active in the current preview. Clip mode reads from the
  // clip; sequence mode reads from the project-level track. Editing modes
  // (set-zoom / track-marker) leave the audio idle so they don't compete with
  // the marker-tracking video that plays at 0.5×.
  const seqBackingTrack = project?.sequenceBackingTrack ?? null;
  const isSequenceMode = previewMode.kind === 'sequence';
  const isPlaybackMode = previewMode.kind === 'clip' || isSequenceMode;
  const activeBackingTrack = isSequenceMode
    ? seqBackingTrack
    : (previewMode.kind === 'clip' ? activeClip?.backingTrack ?? null : null);
  const audioActive = !!activeBackingTrack && isPlaybackMode;

  // Brightness preview. Clip-mode shows the clip's own brightness; sequence
  // mode stacks the per-clip and sequence brightness so the picture matches
  // what the export will produce. Source-mode previews the raw footage with
  // no adjustment, even if some clip has one set.
  const previewBrightness = (() => {
    if (!project || !isPlaybackMode || !activeClip) return 0;
    const clipB = activeClip.brightness ?? 0;
    const seqB = isSequenceMode ? (project.sequenceBrightness ?? 0) : 0;
    return clipB + seqB;
  })();
  // CSS filter takes a multiplier where 1 = no change. ffmpeg's eq=brightness
  // adds N to luma in normalised [-1, 1] space — approximated for preview as
  // 1+N (so +0.3 brightness ≈ filter: brightness(1.3)). Clamp to a sensible
  // non-negative range so the picture can't go negative.
  const cssBrightness = Math.max(0, 1 + previewBrightness);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!activeClip) {
      v.playbackRate = 1; v.muted = false; return;
    }
    v.playbackRate = activeClip.speed;
    // Mute the source video audio when (a) we're slow-mo (no usable audio
    // anyway) or (b) the active backing track is configured to hide source.
    // Otherwise leave source audible so it sits underneath the music.
    const slowmoMutes = activeClip.speed !== 1;
    const bgMutes = !!activeBackingTrack && activeBackingTrack.muteSource;
    v.muted = slowmoMutes || bgMutes;
  }, [activeClip?.speed, activeClip?.id, seqIndex, activeBackingTrack?.muteSource, activeBackingTrack?.path]);

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

  // Keep the <video> element from holding keyboard focus. Clicking native
  // controls (play, pause, scrub) focuses something inside the video's shadow
  // DOM, and Chromium swallows keydown events from there before they reach
  // our document-level capture listeners — the symptom is "press play, then
  // [ / ] / B do nothing until you click off the video." Blurring on play /
  // pause / focusin keeps focus on the body so shortcuts always fire.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const drop = () => {
      // Defer one frame: the focus has often just moved into the shadow DOM
      // synchronously with the click, and a same-tick blur can be ignored.
      requestAnimationFrame(() => v.blur());
    };
    v.addEventListener('play', drop);
    v.addEventListener('pause', drop);
    v.addEventListener('focusin', drop);
    return () => {
      v.removeEventListener('play', drop);
      v.removeEventListener('pause', drop);
      v.removeEventListener('focusin', drop);
    };
  }, [project?.sourceVideo.path]);

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

  // Set / clear the backing-track audio element's src and volume in response
  // to backing-track changes. Separate from the play/pause sync below so the
  // sync effect doesn't tear down when the user merely drags the volume
  // slider while a clip is playing.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (audioActive && activeBackingTrack) {
      const url = `file://${activeBackingTrack.path}`;
      if (a.src !== url) a.src = url;
      a.volume = Math.max(0, Math.min(1, activeBackingTrack.volume));
    } else {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
  }, [audioActive, activeBackingTrack?.path, activeBackingTrack?.volume]);

  // Refs to the latest project / preview-mode / activeClip so the sync effect
  // below can read current values without having to tear down + rebuild on
  // every sequence-index change. Critical for sequence playback: re-attaching
  // listeners between clips would chop the audio at every boundary.
  const projectRef = useRef(project);
  const previewModeRef = useRef(previewMode);
  const activeClipRef = useRef(activeClip);
  projectRef.current = project;
  previewModeRef.current = previewMode;
  activeClipRef.current = activeClip;

  // Mirror the video's play / pause / seek into the backing-track audio.
  // The audio always plays at 1× wall-clock; the video plays at clip.speed.
  // For clip mode, audio position = (video.currentTime - clip.in) / speed.
  // For sequence mode, add the wall-clock-equivalent duration of every
  // earlier clip so the music spans the whole reel continuously.
  useEffect(() => {
    if (!audioActive) return;
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    function computeAudioTime(): number {
      const proj = projectRef.current;
      const pm = previewModeRef.current;
      const ac = activeClipRef.current;
      if (!v || !proj || !ac) return 0;
      let elapsed = 0;
      if (pm.kind === 'sequence') {
        for (let i = 0; i < pm.index; i++) {
          const entry = proj.sequence[i];
          if (!entry) continue;
          const c = proj.clips.find(cl => cl.id === entry.clipId);
          if (c) elapsed += (c.out - c.in) / c.speed;
        }
      }
      elapsed += Math.max(0, (v.currentTime - ac.in) / ac.speed);
      return elapsed;
    }
    function syncAudioTime() {
      if (!a) return;
      const target = computeAudioTime();
      // Only correct meaningful drift — assigning currentTime every frame
      // produces audible clicks in Chromium.
      if (Math.abs(a.currentTime - target) > 0.15) {
        a.currentTime = target;
      }
    }
    function onPlay() {
      if (!a) return;
      syncAudioTime();
      a.play().catch(() => {});
    }
    function onPause() { a?.pause(); }
    function onSeeked() { syncAudioTime(); }

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    // If the video happens to already be playing when audio activates, kick
    // off audio immediately rather than waiting for the next play event.
    if (!v.paused) {
      syncAudioTime();
      a.play().catch(() => {});
    } else {
      syncAudioTime();
    }
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
      a.pause();
    };
  }, [audioActive]);

  if (!project) return <span className="dim">Open a video to begin</span>;

  const sw = project.sourceVideo.width;
  const sh = project.sourceVideo.height;
  const dw = sw * fit;
  const dh = sh * fit;

  const isSetZoom = previewMode.kind === 'set-zoom';
  const isTrackMarker = previewMode.kind === 'track-marker';
  // While placing or tracking a focus marker we temporarily disable the zoom
  // transform so the user can interact with the full source frame.
  const suspendZoom = isSetZoom || isTrackMarker;

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
          style={{
            position: 'absolute', top: 0, left: 0,
            width: dw, height: dh,
            transformOrigin: '0 0',
            transform: zoomTransform,
            filter: cssBrightness !== 1 ? `brightness(${cssBrightness})` : undefined,
          }}
        />
        {/* Backing-track audio. src is set imperatively by the sync effect
            so React doesn't reload the element every time the clip changes
            (which would chop sequence-mode music at each boundary). */}
        <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
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
              const isOval = m.shape === 'oval';
              const outlineStyle: React.CSSProperties = isOval
                ? {
                  position: 'absolute',
                  left, top, width: w, height: h,
                  border: `3px solid ${m.color}`,
                  borderRadius: '50%',
                  boxSizing: 'border-box',
                }
                : {
                  position: 'absolute',
                  left, top, width: w, height: h,
                  borderTop: `1px solid ${m.color}`,
                  borderLeft: `1px solid ${m.color}`,
                  borderRight: `1px solid ${m.color}`,
                  borderBottom: `4px solid ${m.color}`,
                  boxSizing: 'border-box',
                };
              return (
                <React.Fragment key={m.id}>
                  <div style={outlineStyle} />
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
        {/* Click anywhere on the picture to play/pause. Stays under the
            transport bar (lower z-index) so transport buttons keep their own
            click handling. Hidden in set-zoom / track-marker so those modes
            keep the picture as a drawing surface. */}
        {!suspendZoom && (
          <div
            onClick={togglePlay}
            title="Click to play/pause"
            className="play-overlay"
          />
        )}
        {isZoomed && !suspendZoom && (
          <div className="zoom-indicator">
            {zoomFactor.toFixed(1)}× zoom
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
        {!suspendZoom && <TransportBar videoRef={videoRef} />}
      </div>
    </div>
  );
}
