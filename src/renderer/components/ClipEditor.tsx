import React from 'react';
import { useProjectStore } from '../state/projectStore';
import { ClipFocusMarkers } from './ClipFocusMarkers';

// Common slow-mo / speed-up landmarks. The slider is still there for in-
// between values, but the chip row covers ~all the cases a parent making a
// highlight reel actually wants.
const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2];

export function ClipEditor({ clipId }: { clipId: string }) {
  const project = useProjectStore(s => s.project);
  const update = useProjectStore(s => s.updateClip);
  const setMode = useProjectStore(s => s.setPreviewMode);
  const replayClip = useProjectStore(s => s.replayClip);

  const clip = project?.clips.find(c => c.id === clipId);
  if (!project || !clip) return null;

  const sw = project.sourceVideo.width;
  const sh = project.sourceVideo.height;
  const isFullFrame = clip.zoom.x === 0 && clip.zoom.y === 0 && clip.zoom.width === sw && clip.zoom.height === sh;

  return (
    <div className="clip-steps">
      <section className="step">
        <h3 className="step-title">1. Track your kid</h3>
        <ClipFocusMarkers clip={clip} />
      </section>

      <section className="step">
        <h3 className="step-title">2. Zoom in <span className="step-optional">(optional)</span></h3>
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
          <button onClick={replayClip} title="Rewind to the clip's in-point and play from the start">
            Replay clip
          </button>
        </div>
      </section>

      <section className="step">
        <h3 className="step-title">3. Speed <span className="step-optional">(optional)</span></h3>
        <div className="speed-presets">
          {SPEED_PRESETS.map(s => (
            <button
              key={s}
              className={Math.abs(clip.speed - s) < 0.001 ? 'speed-chip active' : 'speed-chip'}
              onClick={() => update(clipId, { speed: s })}
              title={s < 1 ? `Slow motion ${s}×` : s > 1 ? `Fast forward ${s}×` : 'Normal speed'}>
              {s}×
            </button>
          ))}
        </div>
        <input
          type="range" min={0.25} max={4} step={0.05}
          value={clip.speed}
          onChange={e => update(clipId, { speed: parseFloat(e.target.value) })}
          style={{ width: '100%', marginTop: 8 }}
        />
        <div className="dim" style={{ fontSize: 11, textAlign: 'right' }}>
          Current: {clip.speed.toFixed(2)}×{clip.speed !== 1 ? ' (audio muted)' : ''}
        </div>
      </section>
    </div>
  );
}
