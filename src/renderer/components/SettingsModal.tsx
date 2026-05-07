import React, { useEffect } from 'react';
import { useSettings } from '../state/settings';

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings();

  // Esc closes the modal. Capture phase + stopPropagation so the global app
  // shortcuts (B, arrows) don't fire while the modal is up.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--panel)',
        border: '1px solid var(--accent-glow)',
        borderRadius: 10,
        padding: 24,
        width: 460,
        maxWidth: '90vw',
        display: 'flex', flexDirection: 'column', gap: 18,
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Settings</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <Field
          label="Bookmark rewind"
          help="Seconds to rewind from a bookmark when you click it. The bookmark marks where the action ended; rewinding lets you watch up to it."
          value={settings.bookmarkRewindSeconds}
          min={0} max={120} step={1}
          unit="s"
          onChange={v => settings.update({ bookmarkRewindSeconds: v })}
        />
        <Field
          label="Arrow-key skip"
          help="Seconds the ← / → arrow keys (and the ± buttons on the preview and clip editor) skip the playhead by."
          value={settings.skipSeconds}
          min={1} max={60} step={1}
          unit="s"
          onChange={v => settings.update({ skipSeconds: v })}
        />
        <Field
          label="Tracking playback speed"
          help="Speed the video plays at when tracking a focus marker. Lower values make fast action easier to follow with the cursor."
          value={settings.trackingPlaybackRate}
          min={0.1} max={1} step={0.05}
          unit="×"
          onChange={v => settings.update({ trackingPlaybackRate: v })}
        />
      </div>
    </div>
  );
}

function Field({ label, help, value, min, max, step, unit, onChange }: {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, flex: 1 }}>{label}</span>
        <input
          type="number"
          value={value}
          min={min} max={max} step={step}
          onChange={e => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
          }}
          style={{
            width: 80, padding: '4px 6px',
            background: 'var(--panel-2)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 3,
          }}
        />
        <span className="dim" style={{ width: 16 }}>{unit}</span>
      </div>
      <span className="dim" style={{ fontSize: 11 }}>{help}</span>
    </label>
  );
}
