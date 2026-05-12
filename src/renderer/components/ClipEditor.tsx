import React, { useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { ClipFocusMarkers } from './ClipFocusMarkers';
import type { Clip, BackingTrack } from '../../shared/types';
import { resolveSourceForClip } from '../../shared/resolveSource';

// Slow-mo landmarks only. Faster-than-1× is gone because the editor's job is
// to slow a moment down so a parent can watch their kid do the thing — there's
// no reel use-case for speeding football footage up.
const SLOWMO_PRESETS = [0.25, 0.5, 1];

// Sensible default for a fresh backing track. 60% volume sits below "loud"
// without being inaudible; user can tug the slider from there.
const DEFAULT_BACKING_VOLUME = 0.6;

type StepKey = 'track' | 'zoom' | 'slowmo' | 'sound';

export function ClipEditor({ clipId }: { clipId: string }) {
  const project = useProjectStore(s => s.project);
  const update = useProjectStore(s => s.updateClip);
  const setMode = useProjectStore(s => s.setPreviewMode);

  const trackRef = useRef<HTMLElement>(null);
  const zoomRef = useRef<HTMLElement>(null);
  const slowmoRef = useRef<HTMLElement>(null);
  const soundRef = useRef<HTMLElement>(null);

  const clip = project?.clips.find(c => c.id === clipId);
  if (!project || !clip) return null;

  // Read dimensions from the clip's OWN source — a clip cut from match 2
  // lives in match 2's pixel grid, not the project's primary. Falls back to
  // the primary for legacy single-source clips with no sourceId.
  const clipSource = resolveSourceForClip(project, clip) ?? project.sourceVideo;
  const sw = clipSource.width;
  const sh = clipSource.height;
  const isFullFrame = clip.zoom.x === 0 && clip.zoom.y === 0 && clip.zoom.width === sw && clip.zoom.height === sh;

  // What counts as "done" for each step. Track is the foundation — zoom and
  // slow-mo follow from a tagged player. Zoom is done once the user has drawn
  // any focus box (i.e. it's no longer the full source frame). Slow-mo is done
  // once the speed has been pulled below 1×. Sound is done once a backing
  // track has been chosen.
  const trackDone = clip.focusMarkers.length > 0;
  const zoomDone = !isFullFrame;
  const slowmoDone = clip.speed < 1;
  const soundDone = !!clip.backingTrack;

  const stepRefs: Record<StepKey, React.RefObject<HTMLElement>> = {
    track: trackRef, zoom: zoomRef, slowmo: slowmoRef, sound: soundRef,
  };
  function jumpTo(step: StepKey) {
    stepRefs[step].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="clip-steps">
      <StepProgress
        steps={[
          { key: 'track', label: 'Track', done: trackDone, required: true },
          { key: 'zoom', label: 'Zoom', done: zoomDone, required: false },
          { key: 'slowmo', label: 'Slow-mo', done: slowmoDone, required: false },
          { key: 'sound', label: 'Sound', done: soundDone, required: false },
        ]}
        onJump={jumpTo}
      />

      <section className="step" ref={trackRef}>
        <h3 className="step-title">
          <span className="step-num">1.</span> Track player(s)
        </h3>
        <ClipFocusMarkers clip={clip} />
      </section>

      <section className="step" ref={zoomRef}>
        <h3 className="step-title">
          <span className="step-num">2.</span> Zoom in <span className="step-optional">(optional)</span>
        </h3>
        <p className="step-hint">
          Draw a focus box and only that area will be in the export. The box follows the primary player you tagged above.
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setMode({ kind: 'set-zoom', clipId })}
            title="Draw a rectangle on the video; only that area shows in the export">
            {isFullFrame ? 'Set focus box' : 'Re-draw focus box'}
          </button>
          <button
            disabled={isFullFrame}
            onClick={() => update(clipId, { zoom: { x: 0, y: 0, width: sw, height: sh } })}
            title="Show the full source frame again">
            Reset focus box
          </button>
        </div>
      </section>

      <section className="step" ref={slowmoRef}>
        <h3 className="step-title">
          <span className="step-num">3.</span> Slow-mo <span className="step-optional">(optional)</span>
        </h3>
        <p className="step-hint">
          Slow the moment down so it lands. Audio mutes below 1×.
        </p>
        <div className="speed-presets">
          {SLOWMO_PRESETS.map(s => (
            <button
              key={s}
              className={Math.abs(clip.speed - s) < 0.001 ? 'speed-chip active' : 'speed-chip'}
              onClick={() => update(clipId, { speed: s })}
              title={s < 1 ? `Slow motion ${s}×` : 'Normal speed'}>
              {s === 1 ? 'Normal' : `${s}×`}
            </button>
          ))}
        </div>
        <input
          type="range" min={0.25} max={1} step={0.05}
          value={clip.speed}
          onChange={e => update(clipId, { speed: parseFloat(e.target.value) })}
          style={{ width: '100%', marginTop: 8 }}
        />
        <div className="dim" style={{ fontSize: 11, textAlign: 'right' }}>
          Current: {clip.speed.toFixed(2)}×{clip.speed !== 1 ? ' (audio muted)' : ''}
        </div>
      </section>

      <section className="step" ref={soundRef}>
        <h3 className="step-title">
          <span className="step-num">4.</span> Sound <span className="step-optional">(optional)</span>
        </h3>
        <SoundSection clip={clip} />
      </section>

      <AdvancedSection clip={clip} />
    </div>
  );
}

// Power-user adjustments tucked behind a disclosure at the bottom of the
// clip editor. Stays out of the headline Track → Zoom → Slow-mo → Sound
// flow that a first-run parent works through, but is one click away when a
// shot needs colour-correction. Currently houses just brightness; designed
// so further "fine tune" knobs (contrast, saturation) could slot in here
// without further reshuffling.
function AdvancedSection({ clip }: { clip: Clip }) {
  const update = useProjectStore(s => s.updateClip);
  const [open, setOpen] = useState((clip.brightness ?? 0) !== 0);

  const brightness = clip.brightness ?? 0;
  const brightnessPct = Math.round(brightness * 100);
  const isDefault = Math.abs(brightness) < 0.001;

  return (
    <section className={`step advanced-step${open ? ' is-open' : ''}`}>
      <button
        className="advanced-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title="Power-user adjustments — brightness etc.">
        <span className="advanced-toggle-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        Advanced
        {!isDefault && (
          <span className="advanced-toggle-badge">brightness {brightnessPct > 0 ? '+' : ''}{brightnessPct}%</span>
        )}
      </button>
      {open && (
        <div className="advanced-body">
          <label className="sound-row">
            <span className="sound-row-label">Brightness</span>
            <input
              type="range" min={-0.5} max={0.5} step={0.01}
              value={brightness}
              onChange={e => update(clip.id, { brightness: parseFloat(e.target.value) })}
            />
            <span className="sound-row-value">
              {brightnessPct > 0 ? '+' : ''}{brightnessPct}%
            </span>
          </label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              disabled={isDefault}
              onClick={() => update(clip.id, { brightness: undefined })}
              title="Reset brightness to default">
              Reset
            </button>
            <span className="dim" style={{ fontSize: 11 }}>
              Applies to the preview and the exported clip.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

// Backing-track picker + per-clip mix controls. Sits after Slow-mo so the
// timeline of decisions reads picture → motion → music. At slow-mo speeds the
// source audio is silenced upstream (see buildClipFfmpegArgs), so the
// "Keep source video sound" toggle is shown disabled in that case to match
// what the export will actually do.
function SoundSection({ clip }: { clip: Clip }) {
  const update = useProjectStore(s => s.updateClip);
  const bg = clip.backingTrack;
  const sourceSilencedBySlowmo = clip.speed !== 1;

  async function chooseTrack() {
    const r = await window.reelmagic.chooseBackingTrack();
    if (!r.ok || !r.path) return;
    const next: BackingTrack = {
      path: r.path,
      volume: bg?.volume ?? DEFAULT_BACKING_VOLUME,
      muteSource: bg?.muteSource ?? true,
    };
    update(clip.id, { backingTrack: next });
  }
  function clearTrack() {
    update(clip.id, { backingTrack: undefined });
  }
  function patch(p: Partial<BackingTrack>) {
    if (!bg) return;
    update(clip.id, { backingTrack: { ...bg, ...p } });
  }

  if (!bg) {
    return (
      <>
        <p className="step-hint">
          Drop a song over this clip. Source audio can stay underneath or be
          hidden, and the music fades out at the end of the export.
        </p>
        <button onClick={chooseTrack} title="Pick an MP3 or other audio file">
          + Choose music…
        </button>
      </>
    );
  }

  const fileName = bg.path.split(/[\\/]/).pop() ?? bg.path;
  const volPct = Math.round(bg.volume * 100);

  return (
    <div className="sound-controls">
      <div className="sound-file" title={bg.path}>
        <span className="sound-file-icon" aria-hidden="true">♪</span>
        <span className="sound-file-name">{fileName}</span>
        <button onClick={chooseTrack} title="Pick a different audio file">Change…</button>
        <button onClick={clearTrack} title="Remove the backing track">Remove</button>
      </div>

      <label className="sound-row">
        <span className="sound-row-label">Volume</span>
        <input
          type="range" min={0} max={1} step={0.01}
          value={bg.volume}
          onChange={e => patch({ volume: parseFloat(e.target.value) })}
        />
        <span className="sound-row-value">{volPct}%</span>
      </label>

      <label className={`sound-row sound-toggle${sourceSilencedBySlowmo ? ' is-disabled' : ''}`}>
        <input
          type="checkbox"
          checked={bg.muteSource || sourceSilencedBySlowmo}
          disabled={sourceSilencedBySlowmo}
          onChange={e => patch({ muteSource: e.target.checked })}
        />
        <span>Mute source video sound</span>
      </label>
      {sourceSilencedBySlowmo && (
        <div className="dim" style={{ fontSize: 11 }}>
          Source audio is silenced at slow-mo speeds — only the backing track plays.
        </div>
      )}
      <div className="dim" style={{ fontSize: 11 }}>
        The track fades out in the last half-second of the export.
      </div>
    </div>
  );
}

// Track → Zoom → Slow-mo → Sound progress strip. The arrows imply order; the
// green fill + tick imply progress. Clicking a step scrolls its section into
// view so the strip doubles as table-of-contents on a small panel.
function StepProgress({ steps, onJump }: {
  steps: { key: StepKey; label: string; done: boolean; required: boolean }[];
  onJump: (key: StepKey) => void;
}) {
  return (
    <div className="step-progress" role="list" aria-label="Clip-editing steps">
      <div className="step-progress-intro">
        Tag a player, crop in, slow it down, add music. Each step builds on the last.
      </div>
      <div className="step-progress-row">
        {steps.map((s, i) => (
          <React.Fragment key={s.key}>
            <button
              role="listitem"
              className={`step-progress-item${s.done ? ' done' : ''}`}
              onClick={() => onJump(s.key)}
              title={s.done ? `${s.label} — done. Click to revisit.` : `Jump to ${s.label}`}>
              <span className="step-progress-mark" aria-hidden="true">
                {s.done ? '✓' : i + 1}
              </span>
              <span className="step-progress-label">{s.label}</span>
              {!s.required && <span className="step-progress-optional">optional</span>}
            </button>
            {i < steps.length - 1 && <span className="step-progress-arrow" aria-hidden="true">→</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
