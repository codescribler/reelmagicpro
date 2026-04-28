import React from 'react';
import { useProjectStore } from '../state/projectStore';

export function ClipEditor({ clipId }: { clipId: string }) {
  const project = useProjectStore(s => s.project);
  const update = useProjectStore(s => s.updateClip);
  const setMode = useProjectStore(s => s.setPreviewMode);

  const clip = project?.clips.find(c => c.id === clipId);
  if (!project || !clip) return null;

  const sw = project.sourceVideo.width;
  const sh = project.sourceVideo.height;
  const isFullFrame = clip.zoom.x === 0 && clip.zoom.y === 0 && clip.zoom.width === sw && clip.zoom.height === sh;

  return (
    <div style={{ marginTop: 12, padding: 8, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4 }}>
      <label style={{ display: 'block', marginBottom: 6 }}>
        <div className="dim" style={{ fontSize: 11 }}>Name</div>
        <input
          value={clip.name}
          onChange={e => update(clipId, { name: e.target.value })}
          style={{ width: '100%', padding: 4, background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3 }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: 6 }}>
        <div className="dim" style={{ fontSize: 11 }}>Speed: {clip.speed.toFixed(2)}×</div>
        <input type="range" min={0.25} max={4} step={0.05}
          value={clip.speed}
          onChange={e => update(clipId, { speed: parseFloat(e.target.value) })}
          style={{ width: '100%' }}
        />
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setMode({ kind: 'set-zoom', clipId })}>Set zoom region</button>
        <button
          disabled={isFullFrame}
          onClick={() => update(clipId, { zoom: { x: 0, y: 0, width: sw, height: sh } })}>
          Reset zoom
        </button>
      </div>
    </div>
  );
}
