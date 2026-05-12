import React, { useMemo, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { ClipList } from './ClipList';
import { ClipDetail } from './ClipDetail';
import { BookmarkList } from './BookmarkList';
import { SourceTabs } from './SourceTabs';

type Tab = 'clips' | 'bookmarks';

export function RightPanel({ onExport, onAddVideo }: {
  onExport: (id: string) => void;
  onAddVideo: () => void;
}) {
  const [tab, setTab] = useState<Tab>('clips');
  const project = useProjectStore(s => s.project);
  const activeSourceId = useProjectStore(s => s.activeSourceId);

  // Counts are scoped to the active source — the clip list and bookmark
  // list below also filter to it, so the tab badges have to agree.
  const { clipCount, bookmarkCount } = useMemo(() => {
    if (!project || !activeSourceId) return { clipCount: 0, bookmarkCount: 0 };
    const primaryId = project.sources[0]?.id;
    const clipCount = project.clips.filter(c =>
      (c.sourceId ?? primaryId) === activeSourceId
    ).length;
    const bookmarkCount = project.bookmarks.filter(b =>
      (b.sourceId ?? primaryId) === activeSourceId
    ).length;
    return { clipCount, bookmarkCount };
  }, [project?.clips, project?.bookmarks, project?.sources, activeSourceId]);

  // The Clips tab drills down: list when nothing is selected, full-panel
  // editor when a clip is. Driven directly off selectedClipId so deleting
  // the selected clip (which clears selection) auto-returns to the list.
  const selectedClipId = useProjectStore(s => s.selectedClipId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SourceTabs onAddVideo={onAddVideo} />
      <div style={{
        display: 'flex',
        flex: '0 0 auto',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel-2)',
      }}>
        <TabButton active={tab === 'clips'} onClick={() => setTab('clips')}>
          Clips ({clipCount})
        </TabButton>
        <TabButton active={tab === 'bookmarks'} onClick={() => setTab('bookmarks')}>
          Bookmarks ({bookmarkCount})
        </TabButton>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'clips'
          ? (selectedClipId ? <ClipDetail onExport={onExport} /> : <ClipList />)
          : <BookmarkList />}
      </div>
    </div>
  );
}

function TabButton(
  { active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }
) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? 'var(--panel)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--muted)',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        borderRadius: 0,
        padding: '8px 12px',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}
