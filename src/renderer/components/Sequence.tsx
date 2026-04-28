import React from 'react';
import { useProjectStore } from '../state/projectStore';

export function Sequence() {
  const project = useProjectStore(s => s.project);
  const append = useProjectStore(s => s.appendToSequence);
  const reorder = useProjectStore(s => s.reorderSequence);
  const remove = useProjectStore(s => s.removeFromSequence);
  const setMode = useProjectStore(s => s.setPreviewMode);
  const invalid = useProjectStore(s => s.invalidClipIds);

  if (!project) return <span className="dim">Sequence</span>;

  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const clipId = e.dataTransfer.getData('text/clipId');
    const fromIdxRaw = e.dataTransfer.getData('text/seqIndex');
    if (fromIdxRaw) {
      // ignore here; reorder handled per-tile
    } else if (clipId) {
      append(clipId);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}
      onDragOver={onDragOver} onDrop={onDrop}>
      <div style={{ display: 'flex', gap: 6, flex: 1, minHeight: 64, alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto' }}>
        {project.sequence.length === 0 && <span className="dim">Drag clips here to build a sequence</span>}
        {project.sequence.map((entry, i) => {
          const clip = project.clips.find(c => c.id === entry.clipId);
          const isInvalid = !clip || invalid.has(entry.clipId);
          return (
            <div key={i}
              draggable
              onDragStart={e => e.dataTransfer.setData('text/seqIndex', String(i))}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                e.stopPropagation();
                const fromIdxRaw = e.dataTransfer.getData('text/seqIndex');
                if (fromIdxRaw !== '') {
                  const from = parseInt(fromIdxRaw, 10);
                  if (!Number.isNaN(from) && from !== i) reorder(from, i);
                  return;
                }
                const clipId = e.dataTransfer.getData('text/clipId');
                if (clipId) append(clipId);
              }}
              onClick={() => remove(i)}
              title="Click to remove"
              style={{
                padding: '6px 10px',
                background: isInvalid ? 'var(--danger)' : 'var(--accent-2)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                cursor: 'grab',
                whiteSpace: 'nowrap',
                opacity: isInvalid ? 0.6 : 1,
              }}>
              {clip?.name ?? '???'}
            </div>
          );
        })}
      </div>
      <button
        disabled={project.sequence.length === 0}
        onClick={() => setMode({ kind: 'sequence', index: 0 })}>
        Play sequence
      </button>
    </div>
  );
}
