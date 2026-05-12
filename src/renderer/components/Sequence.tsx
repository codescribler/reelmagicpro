import React from 'react';
import { useProjectStore } from '../state/projectStore';
import { SequenceMusicButton } from './SequenceMusicButton';
import { SequenceAdvancedButton } from './SequenceAdvancedButton';
import type { Project } from '../../shared/types';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

// Output (wall-clock) duration of the whole sequence in seconds. Each clip
// contributes its source range stretched by speed (slow-mo at 0.5× doubles
// the clip's contribution). The outro / sequence backing track aren't
// included — this is the headline "how long is my reel" number.
function totalSequenceDurationSec(project: Project): number {
  let total = 0;
  for (const entry of project.sequence) {
    const c = project.clips.find(cl => cl.id === entry.clipId);
    if (c) total += (c.out - c.in) / Math.max(0.01, c.speed);
  }
  return total;
}

export function Sequence({ onExportSequence }: {
  onExportSequence: () => void;
}) {
  const project = useProjectStore(s => s.project);
  const append = useProjectStore(s => s.appendToSequence);
  const reorder = useProjectStore(s => s.reorderSequence);
  const remove = useProjectStore(s => s.removeFromSequence);
  const clear = useProjectStore(s => s.clearSequence);
  const setMode = useProjectStore(s => s.setPreviewMode);
  const previewMode = useProjectStore(s => s.previewMode);
  const invalid = useProjectStore(s => s.invalidClipIds);

  // Index of the clip currently playing in sequence preview — used to apply
  // the "shine" highlight below. -1 when we're not previewing a sequence.
  const playingIndex = previewMode.kind === 'sequence' ? previewMode.index : -1;

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
          const isPlaying = i === playingIndex;
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
              className={`seq-chip${isPlaying ? ' seq-chip-playing' : ''}`}
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
                position: 'relative',
              }}
              onMouseEnter={e => !isInvalid && !isPlaying && (e.currentTarget.style.transform = 'translateY(-1px)')}
              onMouseLeave={e => !isPlaying && (e.currentTarget.style.transform = 'translateY(0)')}>
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
      {project.sequence.length > 0 && (
        <span className="seq-info" title="Total playback duration of the sequence">
          {playingIndex >= 0 && (
            <span className="seq-info-playing">
              ▶ Clip {playingIndex + 1} / {project.sequence.length}
            </span>
          )}
          <span className="seq-info-length">
            {fmtTime(totalSequenceDurationSec(project))} total
          </span>
        </span>
      )}
      <SequenceMusicButton />
      <SequenceAdvancedButton />
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
