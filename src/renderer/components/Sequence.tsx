import React from 'react';
import { useProjectStore } from '../state/projectStore';
import { SequenceMusicButton } from './SequenceMusicButton';
import { SequenceAdvancedButton } from './SequenceAdvancedButton';
import { sourceColour } from '../lib/sourceColors';
import type { Project } from '../../shared/types';
import { useSequenceDrag } from '../lib/sequenceDrag';
import '../styles/sequenceDrag.css';
import { SequenceLibrary } from './SequenceLibrary';

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
  const drag = useSequenceDrag(project?.sequence.length ?? 0, reorder, clipId => {
    if (project?.clips.some(clip => clip.id === clipId)) append(clipId);
  });

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

  return (
    <div className="sequence-editor">
    <SequenceLibrary />
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0 }}>
      <div ref={drag.stripRef} className="sequence-strip" aria-label="Sequence clips"
        title="Drag clips to reorder; drop between clips"
        onDragEnter={drag.over} onDragOver={drag.over} onDrop={drag.drop} onDragLeave={drag.leave}>
        {project.sequence.length === 0 && <span className="dim">Drag clips here to build a sequence</span>}
        {project.sequence.map((entry, i) => {
          const clip = project.clips.find(c => c.id === entry.clipId);
          const isInvalid = !clip || invalid.has(entry.clipId);
          const isPlaying = i === playingIndex;
          const multiSource = project.sources.length > 1;
          const stripeColour = clip ? sourceColour(project, clip.sourceId) : 'var(--border)';
          return (
            <div key={i}
              data-sequence-index={i}
              draggable
              onDragStart={e => drag.start(e, i)}
              onDragEnd={drag.end}
              onClick={() => !isInvalid && setMode({ kind: 'sequence', index: i })}
              title="Click to play from here · drag to reorder"
              className={`seq-chip${isPlaying ? ' seq-chip-playing' : ''}${drag.gap === i ? ' seq-drop-before' : ''}${drag.gap === project.sequence.length && i === project.sequence.length - 1 ? ' seq-drop-after' : ''}`}
              style={{
                padding: '6px 6px 6px 10px',
                background: isInvalid ? 'var(--danger)' : 'var(--accent-2)',
                border: isInvalid ? '1px solid var(--border)' : '1px solid var(--accent)',
                borderLeft: multiSource && !isInvalid ? `4px solid ${stripeColour}` : undefined,
                borderRadius: 5,
                cursor: isInvalid ? 'default' : 'grab',
                whiteSpace: 'nowrap',
                opacity: drag.dragging === i ? 0.45 : isInvalid ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'background-color 150ms ease, border-color 150ms ease, transform 120ms ease',
                color: isInvalid ? 'var(--text)' : '#d8f9b3',
                position: 'relative',
              }}
              onMouseEnter={e => !isInvalid && !isPlaying && (e.currentTarget.style.transform = 'translateY(-1px)')}
              onMouseLeave={e => !isPlaying && (e.currentTarget.style.transform = 'translateY(0)')}>
              <span className="sequence-drag-handle" aria-hidden="true">⋮⋮</span>
              <span className="dim" style={{ fontSize: 11 }}>{i + 1}.</span>
              <span>{clip?.name ?? '???'}</span>
              {clip && !clip.reelFraming?.panPath.length && (
                <span className="sequence-framing-warning" role="img"
                  aria-label="Reel framing not set"
                  title="Reel framing not set. Use Frame reel to keep the action in view for Instagram.">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true" focusable="false">
                    <path d="M12 3 2 21h20L12 3Z" />
                    <path d="M12 9v5m0 3h.01" />
                  </svg>
                </span>
              )}
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
    </div>
  );
}
