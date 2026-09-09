import React from 'react';

/** A wide hit target around a thin marker; keyboard ownership follows focus. */
export function MomentMarker({ label, time, position, duration, onChange }: {
  label: string;
  time: number;
  position: number;
  duration: number;
  onChange: (time: number | undefined) => void;
}) {
  return <button type="button" className="moment-marker" data-moment-marker
    style={{ left: `${Math.max(0, Math.min(100, position))}%` }}
    aria-label={`${label}, ${time.toFixed(2)} seconds`}
    title={`${label}: ${time.toFixed(2)}s. Left/Right: 0.01s; Shift: 0.1s; Delete: remove.`}
    onClick={e => { e.stopPropagation(); e.currentTarget.focus(); }}
    onKeyDown={e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!['ArrowLeft', 'ArrowRight', 'Delete', 'Backspace', 'Escape'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { e.currentTarget.blur(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { onChange(undefined); return; }
      const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01);
      onChange(Math.max(0, Math.min(duration, Math.round((time + delta) * 1e6) / 1e6)));
    }} />;
}
