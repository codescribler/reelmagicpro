import React from 'react';
import { useProjectStore } from '../state/projectStore';
import { ClipEditor } from './ClipEditor';

// Full-panel clip editor. Replaces the clip list when a clip is selected.
// The Back button clears the selection (and resets the preview to source),
// returning the panel to the list view.
export function ClipDetail({ onExport, onExportInstagram }: {
  onExport: (id: string) => void;
  onExportInstagram: (id: string) => void;
}) {
  const project = useProjectStore(s => s.project);
  const selectedId = useProjectStore(s => s.selectedClipId);
  const invalid = useProjectStore(s => s.invalidClipIds);
  const del = useProjectStore(s => s.deleteClip);
  const dup = useProjectStore(s => s.duplicateClip);
  const select = useProjectStore(s => s.selectClip);
  const viewSource = useProjectStore(s => s.viewSource);

  if (!project || !selectedId) return null;
  const clip = project.clips.find(c => c.id === selectedId);
  if (!clip) return null;
  const isInv = invalid.has(clip.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        flex: '0 0 auto',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <button onClick={viewSource} title="Return to the clips list">← Back to clips</button>
        <span className="dim" style={{
          fontSize: 11, flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {clip.name}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        {isInv && (
          <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--danger)' }}>
            Clip is invalid (in / out outside source duration).
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <button onClick={() => { const newId = dup(clip.id); if (newId) select(newId); }}>Duplicate</button>
          <button onClick={() => del(clip.id)}>Delete</button>
          <button disabled={isInv} onClick={() => onExport(clip.id)}>Export clip…</button>
          <button disabled={isInv} onClick={() => onExportInstagram(clip.id)} title="Export 9:16 Instagram Reel with auto-tracking on the primary marker">
            📸 Reel…
          </button>
        </div>
        <ClipEditor clipId={clip.id} />
      </div>
    </div>
  );
}
