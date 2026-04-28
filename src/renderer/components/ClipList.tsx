import React from 'react';
import { useProjectStore } from '../state/projectStore';
import { ClipEditor } from './ClipEditor';

function fmt(s: number) { return s.toFixed(2); }

export function ClipList() {
  const project = useProjectStore(s => s.project);
  const selectedId = useProjectStore(s => s.selectedClipId);
  const select = useProjectStore(s => s.selectClip);
  const del = useProjectStore(s => s.deleteClip);
  const dup = useProjectStore(s => s.duplicateClip);
  const invalid = useProjectStore(s => s.invalidClipIds);

  if (!project) return <div className="dim" style={{ padding: 12 }}>Open a video to begin</div>;

  return (
    <div style={{ padding: 12 }}>
      <div className="dim" style={{ marginBottom: 8 }}>Clips ({project.clips.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {project.clips.map(c => {
          const isSel = c.id === selectedId;
          const isInv = invalid.has(c.id);
          return (
            <div key={c.id}
              draggable
              onDragStart={e => { e.dataTransfer.setData('text/clipId', c.id); }}
              onClick={() => select(c.id)}
              style={{
                padding: '6px 8px',
                borderRadius: 4,
                background: isSel ? 'var(--accent-2)' : 'var(--panel-2)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                opacity: isInv ? 0.5 : 1,
              }}>
              <div>{c.name} {isInv && <span style={{ color: 'var(--danger)' }}>(invalid)</span>}</div>
              <div className="dim" style={{ fontSize: 11 }}>
                {fmt(c.in)}s → {fmt(c.out)}s · {c.speed}× {c.zoom.width !== project.sourceVideo.width ? '· zoomed' : ''}
              </div>
            </div>
          );
        })}
      </div>
      {selectedId && (
        <>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <button onClick={() => { const newId = dup(selectedId); if (newId) select(newId); }}>Duplicate</button>
            <button onClick={() => del(selectedId)}>Delete</button>
          </div>
          <ClipEditor clipId={selectedId} />
        </>
      )}
    </div>
  );
}
