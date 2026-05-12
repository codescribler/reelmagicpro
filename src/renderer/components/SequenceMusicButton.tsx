import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import type { BackingTrack } from '../../shared/types';

const DEFAULT_VOLUME = 0.6;

// Sequence-wide music control. Sits on the sequence bar at the bottom of the
// app. Empty state shows a "+ Music" pill that opens a popover; once a track
// is chosen the pill shows the file name and active styling so the user can
// see at a glance that sequence-level music is on.
//
// The popover is anchored to the button, opens upward (above the sequence
// bar, which lives at the bottom of the window), and dismisses on outside
// click or Escape. Volume / mute-source live in the popover so they can be
// adjusted while the sequence previews — the live store updates flow into
// the <audio> element in Preview.tsx without re-opening anything.
export function SequenceMusicButton() {
  const project = useProjectStore(s => s.project);
  const setTrack = useProjectStore(s => s.setSequenceBackingTrack);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const bg = project?.sequenceBackingTrack ?? null;

  // Outside-click + Escape dismissal. Registered while the popover is open so
  // we don't burn handlers on every render when it's closed.
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

  async function chooseTrack() {
    const r = await window.reelmagic.chooseBackingTrack();
    if (!r.ok || !r.path) return;
    const next: BackingTrack = {
      path: r.path,
      volume: bg?.volume ?? DEFAULT_VOLUME,
      muteSource: bg?.muteSource ?? true,
    };
    setTrack(next);
    setOpen(true);
  }
  function removeTrack() {
    setTrack(undefined);
  }
  function patch(p: Partial<BackingTrack>) {
    if (!bg) return;
    setTrack({ ...bg, ...p });
  }

  const fileName = bg ? (bg.path.split(/[\\/]/).pop() ?? bg.path) : null;
  const volPct = bg ? Math.round(bg.volume * 100) : 0;

  return (
    <div ref={wrapRef} className="seq-music-wrap">
      <button
        className={`seq-music-btn${bg ? ' active' : ''}`}
        onClick={() => (bg ? setOpen(o => !o) : chooseTrack())}
        title={bg ? `Sequence music: ${fileName}` : 'Add a song that plays over the whole sequence'}>
        <span className="seq-music-icon" aria-hidden="true">♪</span>
        <span className="seq-music-label">
          {bg ? fileName : '+ Music'}
        </span>
      </button>

      {open && bg && (
        <div className="seq-music-popover" role="dialog" aria-label="Sequence music options">
          <div className="seq-music-popover-title">Sequence music</div>
          <div className="seq-music-file" title={bg.path}>
            <span className="sound-file-icon" aria-hidden="true">♪</span>
            <span className="sound-file-name">{fileName}</span>
          </div>
          <div className="seq-music-actions">
            <button onClick={chooseTrack} title="Pick a different audio file">Change…</button>
            <button onClick={removeTrack} title="Remove the sequence backing track">Remove</button>
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

          <label className="sound-row sound-toggle">
            <input
              type="checkbox"
              checked={bg.muteSource}
              onChange={e => patch({ muteSource: e.target.checked })}
            />
            <span>Mute source video sound</span>
          </label>
          <div className="dim" style={{ fontSize: 11 }}>
            Plays across all clips. Per-clip music is ignored when a sequence
            track is set. Fades out in the last half-second of the export.
          </div>
        </div>
      )}
    </div>
  );
}
