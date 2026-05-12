import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { useSettings } from '../state/settings';
import { previewClock } from '../state/previewClock';
import { sourceColour } from '../lib/sourceColors';

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

function findClosestId(list: { id: string; time: number }[], t: number): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const item of list) {
    const d = Math.abs(item.time - t);
    if (d < bestDist) { bestId = item.id; bestDist = d; }
  }
  return bestId;
}

export function BookmarkList() {
  const project = useProjectStore(s => s.project);
  const activeSourceId = useProjectStore(s => s.activeSourceId);
  const addBookmark = useProjectStore(s => s.addBookmark);
  const updateBookmark = useProjectStore(s => s.updateBookmark);
  const deleteBookmark = useProjectStore(s => s.deleteBookmark);
  const requestSeek = useProjectStore(s => s.requestSeek);
  const rewindSeconds = useSettings(s => s.bookmarkRewindSeconds);

  // Sort by time AND filter to the active source. Bookmarks reference a
  // specific source's timeline, so showing another source's bookmarks
  // beside the active source's timeline would be misleading.
  const sorted = useMemo(() => {
    if (!project) return [];
    const primaryId = project.sources[0]?.id;
    return [...project.bookmarks]
      .filter(b => (b.sourceId ?? primaryId) === activeSourceId)
      .sort((a, b) => a.time - b.time || a.createdAt - b.createdAt);
  }, [project?.bookmarks, project?.sources, activeSourceId]);
  const multiSource = (project?.sources.length ?? 0) > 1;

  // Held in a ref so the rAF loop reads the latest list without restarting on
  // every bookmark change.
  const sortedRef = useRef(sorted);
  sortedRef.current = sorted;

  const [currentId, setCurrentId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Poll the (non-React) preview clock every animation frame and highlight
  // whichever bookmark is closest to the current playhead time. setState only
  // re-renders when the closest id actually changes, so this is cheap when
  // the playhead is between bookmarks or paused.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const id = findClosestId(sortedRef.current, previewClock.currentTime);
      setCurrentId(prev => prev === id ? prev : id);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keep the highlighted bookmark visible as the playhead moves through them.
  // Only fires when the highlight changes, so manually scrolling between
  // transitions doesn't get yanked back.
  useEffect(() => {
    if (!currentId) return;
    const el = rowRefs.current.get(currentId);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentId]);

  if (!project) return <div className="dim" style={{ padding: 12 }}>Open a video to begin</div>;

  function onAdd() {
    addBookmark(previewClock.currentTime);
  }

  function onSeek(time: number) {
    requestSeek(Math.max(0, time - rewindSeconds));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        flex: '0 0 auto',
        padding: '12px 12px 8px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="dim">Bookmarks ({sorted.length})</span>
          <button
            onClick={onAdd}
            title={`Add a bookmark at the preview's current time (shortcut: B). Clicking a bookmark jumps ${rewindSeconds}s before it.`}>
            + Bookmark
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        {sorted.length === 0 ? (
          <div className="dim" style={{ fontSize: 12 }}>
            No bookmarks yet. Press <strong>B</strong> while watching, or click <strong>+ Bookmark</strong>, to mark a moment.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sorted.map(b => {
              const isCurrent = b.id === currentId;
              const stripeColour = sourceColour(project, b.sourceId);
              return (
                <div key={b.id}
                  ref={el => {
                    if (el) rowRefs.current.set(b.id, el);
                    else rowRefs.current.delete(b.id);
                  }}
                  style={{
                    position: 'relative',
                    padding: '6px 8px 6px 12px',
                    borderRadius: 5,
                    background: isCurrent ? 'var(--accent-2)' : 'var(--panel-2)',
                    border: isCurrent ? '1px solid var(--accent)' : '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 6,
                    transition: 'background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease',
                    boxShadow: isCurrent ? '0 0 0 1px rgba(109,209,13,0.25)' : 'none',
                    overflow: 'hidden',
                  }}>
                  {multiSource && (
                    <span aria-hidden="true" style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      width: 4, background: stripeColour,
                    }} />
                  )}
                  <button
                    onClick={() => onSeek(b.time)}
                    title={`Jump to ${fmt(Math.max(0, b.time - rewindSeconds))} (${rewindSeconds}s before bookmark)`}
                    style={{ flex: '0 0 auto' }}>
                    ▶
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <input
                      type="text"
                      value={b.label ?? ''}
                      placeholder="(no label)"
                      onChange={e => updateBookmark(b.id, { label: e.target.value })}
                      style={{
                        width: '100%', background: 'transparent', color: 'var(--text)',
                        border: 'none', padding: 0, fontSize: 13,
                      }}
                    />
                    <div className="dim" style={{ fontSize: 11 }}>{fmt(b.time)}</div>
                  </div>
                  <button onClick={() => deleteBookmark(b.id)} title="Delete bookmark">×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
