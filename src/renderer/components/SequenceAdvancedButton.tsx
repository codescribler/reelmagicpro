import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';

// Sequence-wide "advanced" tweaks. Mirrors SequenceMusicButton's popover
// pattern (gear button → dropdown → controls) so the two power-user surfaces
// behave the same. Currently holds the brightness slider; structured so we
// can drop in further knobs (contrast, saturation, fade-in) later without
// reshuffling the sequence bar.
//
// The button shows a subtle "on" badge when brightness is non-zero so the
// user can see at a glance that the sequence has an adjustment applied.
export function SequenceAdvancedButton() {
  const project = useProjectStore(s => s.project);
  const setBrightness = useProjectStore(s => s.setSequenceBrightness);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const brightness = project?.sequenceBrightness ?? 0;
  const isDefault = Math.abs(brightness) < 0.001;
  const brightnessPct = Math.round(brightness * 100);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="seq-music-wrap">
      <button
        className={`seq-adv-btn${!isDefault ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={isDefault
          ? 'Sequence-wide adjustments (brightness)'
          : `Sequence brightness ${brightnessPct > 0 ? '+' : ''}${brightnessPct}%`}>
        <span aria-hidden="true">⚙</span>
        {!isDefault && (
          <span className="seq-adv-badge">{brightnessPct > 0 ? '+' : ''}{brightnessPct}%</span>
        )}
      </button>

      {open && (
        <div className="seq-music-popover" role="dialog" aria-label="Sequence adjustments">
          <div className="seq-music-popover-title">Sequence adjustments</div>
          <label className="sound-row">
            <span className="sound-row-label">Brightness</span>
            <input
              type="range" min={-0.5} max={0.5} step={0.01}
              value={brightness}
              onChange={e => setBrightness(parseFloat(e.target.value))}
            />
            <span className="sound-row-value">
              {brightnessPct > 0 ? '+' : ''}{brightnessPct}%
            </span>
          </label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              disabled={isDefault}
              onClick={() => setBrightness(undefined)}
              title="Reset sequence brightness to default">
              Reset
            </button>
            <span className="dim" style={{ fontSize: 11 }}>
              Stacks on top of any per-clip brightness.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
