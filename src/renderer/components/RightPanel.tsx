import React, { useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { ClipList } from './ClipList';
import { ClipDetail } from './ClipDetail';
import { BookmarkList } from './BookmarkList';

type Tab = 'clips' | 'bookmarks';

export function RightPanel({ onExport }: {
  onExport: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('clips');
  const clipCount = useProjectStore(s => s.project?.clips.length ?? 0);
  const bookmarkCount = useProjectStore(s => s.project?.bookmarks.length ?? 0);
  // The Clips tab drills down: list when nothing is selected, full-panel
  // editor when a clip is. Driven directly off selectedClipId so deleting
  // the selected clip (which clears selection) auto-returns to the list.
  const selectedClipId = useProjectStore(s => s.selectedClipId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
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
