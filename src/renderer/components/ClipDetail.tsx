import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useProjectStore } from '../state/projectStore';
import { ClipEditor } from './ClipEditor';

// Full-panel clip editor. Replaces the clip list when a clip is selected.
// The Back button clears the selection (and resets the preview to source),
// returning the panel to the list view.
export function ClipDetail({ onExport }: {
  onExport: (id: string) => void;
}) {
  const project = useProjectStore(s => s.project);
  const selectedId = useProjectStore(s => s.selectedClipId);
  const invalid = useProjectStore(s => s.invalidClipIds);
  const del = useProjectStore(s => s.deleteClip);
  const dup = useProjectStore(s => s.duplicateClip);
  const select = useProjectStore(s => s.selectClip);
  const viewSource = useProjectStore(s => s.viewSource);
  const updateClip = useProjectStore(s => s.updateClip);
  const appendToSequence = useProjectStore(s => s.appendToSequence);
  const replayClip = useProjectStore(s => s.replayClip);
  const clipCreatedToken = useProjectStore(s => s.clipCreatedToken);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLTextAreaElement>(null);

  // When the user has just created a clip, halo-pulse the Export button so
  // the eye lands on the next action. The panel itself flashes (App.tsx);
  // this directs attention to *what to click* once they're looking.
  useEffect(() => {
    if (clipCreatedToken === 0) return;
    const el = exportBtnRef.current;
    if (!el) return;
    el.classList.remove('btn-pulse');
    void el.offsetWidth;
    el.classList.add('btn-pulse');
    const id = setTimeout(() => el.classList.remove('btn-pulse'), 3200);
    return () => clearTimeout(id);
  }, [clipCreatedToken]);

  if (!project || !selectedId) return null;
  const clip = project.clips.find(c => c.id === selectedId);
  if (!clip) return null;
  const isInv = invalid.has(clip.id);
  const isUntitled = /^Untitled clip \d+$/.test(clip.name);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="clip-detail-header" style={{
        flex: '0 0 auto',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <button onClick={viewSource} title="Return to the clips list">← Back to clips</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        <ClipNameField
          ref={nameRef}
          value={clip.name}
          isUntitled={isUntitled}
          onChange={v => updateClip(clip.id, { name: v })}
          onClickToRename={() => {
            // Select-all on first focus when the name is still the auto-
            // generated "Untitled clip N", so the user can just start
            // typing to replace it.
            const el = nameRef.current;
            if (!el) return;
            if (isUntitled) el.select();
          }}
        />
        {isInv && (
          <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--danger)' }}>
            Clip is invalid (in / out outside source duration).
          </div>
        )}
        <div className="clip-controls">
          <button
            onClick={replayClip}
            title="Rewind to the start of this clip and play it back">
            ↻ Replay clip
          </button>
          <button
            ref={exportBtnRef}
            className="export-primary"
            disabled={isInv}
            onClick={() => onExport(clip.id)}>
            Export clip…
          </button>
          <button
            disabled={isInv}
            onClick={() => appendToSequence(clip.id)}
            title="Append this clip to the end of the sequence so it can be stitched with others into one reel">
            + Add to sequence
          </button>
          <span className="clip-controls-spacer" />
          <button onClick={() => { const newId = dup(clip.id); if (newId) select(newId); }}>Duplicate</button>
          <button onClick={() => del(clip.id)}>Delete</button>
        </div>
        <ClipEditor clipId={clip.id} />
      </div>
    </div>
  );
}

// Auto-growing rename field. Uses <textarea> so long names wrap to multiple
// lines instead of scrolling off the right of the panel. The wrapping div
// carries a pencil icon as a visible affordance so users don't have to
// hover to discover it's editable.
const ClipNameField = React.forwardRef<HTMLTextAreaElement, {
  value: string;
  isUntitled: boolean;
  onChange: (v: string) => void;
  onClickToRename: () => void;
}>(function ClipNameField({ value, isUntitled, onChange, onClickToRename }, ref) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  // Forward ref so the parent can imperatively select() the field.
  React.useImperativeHandle(ref, () => localRef.current as HTMLTextAreaElement);

  // Auto-resize: shrink to single-row, then expand to fit scrollHeight.
  // useLayoutEffect so the height is correct before the browser paints —
  // avoids a flicker on every keystroke.
  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [value]);

  return (
    <div className={`clip-name-wrap${isUntitled ? ' untitled' : ''}`}>
      <textarea
        ref={localRef}
        className="clip-name-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={onClickToRename}
        rows={1}
        spellCheck={false}
        placeholder="Name this clip"
        title="Click to rename this clip"
      />
    </div>
  );
});
