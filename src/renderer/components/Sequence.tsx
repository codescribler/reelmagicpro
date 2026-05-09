import React from 'react';
import { useProjectStore } from '../state/projectStore';

export function Sequence({ onExportSequence }: {
  onExportSequence: () => void;
}) {
  const project = useProjectStore(s => s.project);
  const append = useProjectStore(s => s.appendToSequence);
  const reorder = useProjectStore(s => s.reorderSequence);
  const remove = useProjectStore(s => s.removeFromSequence);
  const clear = useProjectStore(s => s.clearSequence);
  const setMode = useProjectStore(s => s.setPreviewMode);
  const invalid = useProjectStore(s => s.invalidClipIds);

  function onClear() {
    if (!project || project.sequence.length === 0) return;
    const ok = window.confirm(
      `Clear all ${project.sequence.length} clip${project.sequence.length === 1 ? '' : 's'} from the sequence? Your clips themselves will not be deleted.`,
    );
    if (ok) clear();
  }

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
              onClick={() => !isInvalid && setMode({ kind: 'sequence', index: i })}
              title="Click to play from here · drag to reorder"
              style={{
                padding: '6px 6px 6px 10px',
                background: isInvalid ? 'var(--danger)' : 'var(--accent-2)',
                border: isInvalid ? '1px solid var(--border)' : '1px solid var(--accent)',
                borderRadius: 5,
                cursor: isInvalid ? 'default' : 'grab',
                whiteSpace: 'nowrap',
                opacity: isInvalid ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'background-color 150ms ease, border-color 150ms ease, transform 120ms ease',
                color: isInvalid ? 'var(--text)' : '#d8f9b3',
              }}
              onMouseEnter={e => !isInvalid && (e.currentTarget.style.transform = 'translateY(-1px)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}>
              <span className="dim" style={{ fontSize: 11 }}>{i + 1}.</span>
              <span>{clip?.name ?? '???'}</span>
              <button
                draggable={false}
                onDragStart={e => e.preventDefault()}
                onClick={e => { e.stopPropagation(); remove(i); }}
                title="Remove from sequence"
                style={{
                  padding: '0 6px', minWidth: 20,
                  background: 'rgba(0,0,0,0.25)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  borderRadius: 3,
                  fontSize: 12, lineHeight: 1.4,
                }}>
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button
        disabled={project.sequence.length === 0}
        onClick={() => setMode({ kind: 'sequence', index: 0 })}>
        Play sequence
      </button>
      <button
        disabled={project.sequence.length === 0}
        onClick={onExportSequence}>
        Export sequence
      </button>
      <button
        disabled={project.sequence.length === 0}
        onClick={onClear}
        title="Remove all clips from the sequence (clips themselves are kept)">
        Clear
      </button>
    </div>
  );
}
