import React, { useMemo } from 'react';
import { useProjectStore } from '../state/projectStore';
import { sourceColour } from '../lib/sourceColors';
import { resolveSourceForClip } from '../../shared/resolveSource';

function fmt(s: number) { return s.toFixed(2); }

// Full-height list of clips. Clicking a row selects the clip, which causes
// RightPanel to swap this list out for the ClipDetail editor (drill-down
// navigation). The header stays sticky so the count and "Back to source"
// action remain reachable when the list scrolls.
export function ClipList() {
  const project = useProjectStore(s => s.project);
  const activeSourceId = useProjectStore(s => s.activeSourceId);
  const selectedId = useProjectStore(s => s.selectedClipId);
  const previewMode = useProjectStore(s => s.previewMode);
  const select = useProjectStore(s => s.selectClip);
  const viewSource = useProjectStore(s => s.viewSource);
  const invalid = useProjectStore(s => s.invalidClipIds);

  // Filter to the active source's clips. A clip with no sourceId belongs to
  // the primary source — same resolution rule used everywhere else.
  const visibleClips = useMemo(() => {
    if (!project) return [];
    const primaryId = project.sources[0]?.id;
    return project.clips.filter(c =>
      (c.sourceId ?? primaryId) === activeSourceId
    );
  }, [project?.clips, project?.sources, activeSourceId]);
  const multiSource = (project?.sources.length ?? 0) > 1;

  // Map of clipId → 1-indexed sequence positions, so each row can show a
  // badge if (and where) it appears in the rendered sequence. A clip can be
  // added more than once; we keep all positions for the tooltip.
  const sequencePositions = useMemo(() => {
    const m = new Map<string, number[]>();
    if (!project) return m;
    project.sequence.forEach((entry, i) => {
      const arr = m.get(entry.clipId);
      if (arr) arr.push(i + 1);
      else m.set(entry.clipId, [i + 1]);
    });
    return m;
  }, [project?.sequence]);

  if (!project) return <div className="dim" style={{ padding: 12 }}>Open a video to begin</div>;

  const onSource = previewMode.kind === 'source';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        flex: '0 0 auto',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span className="dim">Clips ({visibleClips.length})</span>
        <button disabled={onSource} onClick={viewSource} title="Stop previewing the clip and return to the full source video">
          Back to source
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {visibleClips.map(c => {
            const isSel = c.id === selectedId;
            const isInv = invalid.has(c.id);
            const positions = sequencePositions.get(c.id);
            const clipSource = resolveSourceForClip(project, c);
            const stripeColour = sourceColour(project, c.sourceId);
            return (
              <div key={c.id}
                draggable
                onDragStart={e => { e.dataTransfer.setData('text/clipId', c.id); }}
                onClick={() => select(c.id)}
                style={{
                  position: 'relative',
                  padding: '6px 28px 6px 12px',
                  borderRadius: 5,
                  background: isSel ? 'var(--accent-2)' : 'var(--panel-2)',
                  border: isSel ? '1px solid var(--accent)' : '1px solid var(--border)',
                  cursor: 'pointer',
                  opacity: isInv ? 0.5 : 1,
                  transition: 'background-color 150ms ease, border-color 150ms ease',
                  overflow: 'hidden',
                }}>
                {multiSource && (
                  <span aria-hidden="true" style={{
                    position: 'absolute',
                    left: 0, top: 0, bottom: 0,
                    width: 4,
                    background: stripeColour,
                  }} />
                )}
                <div>{c.name} {isInv && <span style={{ color: 'var(--danger)' }}>(invalid)</span>}</div>
                <div className="dim" style={{ fontSize: 11 }}>
                  {fmt(c.in)}s → {fmt(c.out)}s · {c.speed}× {clipSource && c.zoom.width !== clipSource.width ? '· zoomed' : ''}
                </div>
                {positions && positions.length > 0 && (
                  <div
                    title={positions.length === 1
                      ? `In sequence at position ${positions[0]}`
                      : `In sequence at positions ${positions.join(', ')}`}
                    style={{
                      position: 'absolute',
                      top: 4, right: 4,
                      minWidth: 18, height: 18,
                      padding: '0 5px',
                      borderRadius: 9,
                      background: 'var(--accent)',
                      color: '#0b1018',
                      fontSize: 10,
                      fontWeight: 700,
                      lineHeight: '18px',
                      textAlign: 'center',
                      pointerEvents: 'none',
                    }}>
                    {positions[0]}{positions.length > 1 ? '+' : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
