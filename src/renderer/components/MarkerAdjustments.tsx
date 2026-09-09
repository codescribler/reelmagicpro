import React from 'react';
import type { FocusMarker } from '../../shared/types';

export function MarkerAdjustments({ marker, onUpdate }: {
  marker: FocusMarker;
  onUpdate: (patch: Partial<FocusMarker>) => void;
}) {
  const x = marker.pitchOffsetX ?? 0;
  const y = marker.pitchOffsetY ?? 0;
  const step = Math.max(1, Math.round(marker.width * 0.025));
  function nudge(dx: number, dy: number, fine: boolean) {
    const amount = fine ? 1 : step;
    onUpdate({ pitchOffsetX: x + dx * amount, pitchOffsetY: y + dy * amount });
  }
  return (
    <div style={{ fontSize: 11, marginBottom: 8 }}>
      {marker.shape === 'pitch' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span className="dim">Circle position</span>
            <button aria-label="Move circle left" title="Move left (Shift for fine adjustment)" onClick={e => nudge(-1, 0, e.shiftKey)}>←</button>
            <button aria-label="Move circle up" title="Move up (Shift for fine adjustment)" onClick={e => nudge(0, -1, e.shiftKey)}>↑</button>
            <button aria-label="Move circle down" title="Move down (Shift for fine adjustment)" onClick={e => nudge(0, 1, e.shiftKey)}>↓</button>
            <button aria-label="Move circle right" title="Move right (Shift for fine adjustment)" onClick={e => nudge(1, 0, e.shiftKey)}>→</button>
            <button disabled={x === 0 && y === 0} onClick={() => onUpdate({ pitchOffsetX: 0, pitchOffsetY: 0 })}>Reset position</button>
          </div>
          <p className="dim" style={{ margin: '4px 0 8px' }}>
            Nudge the shaded area under the player's feet. Shift-click for finer adjustment.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span className="dim">Opacity</span>
            <input type="range" min={0} max={100} step={5}
              value={Math.round((marker.pitchOpacity ?? 0.15) * 100)}
              onChange={e => onUpdate({ pitchOpacity: Number(e.target.value) / 100 })} />
            <span>{Math.round((marker.pitchOpacity ?? 0.15) * 100)}%</span>
          </label>
        </>
      )}
      {!!marker.path?.length && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="dim">Smooth movement</span>
            <select value={marker.smoothing ?? 0} onChange={e => onUpdate({ smoothing: Number(e.target.value) })}
              style={{ background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3 }}>
              <option value={0}>Off</option>
              <option value={0.2}>Light</option>
              <option value={0.5}>Medium</option>
              <option value={1}>Strong</option>
            </select>
          </label>
          <p className="dim" style={{ margin: '4px 0' }}>Reduces jitters. Stronger smoothing can soften quick turns.</p>
        </>
      )}
    </div>
  );
}
