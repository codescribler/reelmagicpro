import React from 'react';
import { useProjectStore } from './state/projectStore';
import { Preview } from './components/Preview';
import { Timeline } from './components/Timeline';
import { ClipList } from './components/ClipList';
import { Sequence } from './components/Sequence';
import { MenuActions } from './components/MenuActions';

export function App() {
  const project = useProjectStore(s => s.project);
  const dirty = useProjectStore(s => s.dirty);
  const setSource = useProjectStore(s => s.setSource);

  async function handleOpen() {
    const r = await window.reelmagic.openSourceVideo();
    if (r.source) setSource(r.source);
    else if (r.error) alert(`Couldn't read this file: ${r.error}`);
  }

  return (
    <div className="app">
      <div className="menubar">
        <strong>ReelMagic</strong>
        <MenuActions />
        <button onClick={handleOpen}>Open video…</button>
        <span className="dim">{project ? project.sourceVideo.path : 'no source'}</span>
        {dirty && <span className="dim">●</span>}
      </div>
      <div className="main">
        <div className="preview-wrap">
          <Preview />
        </div>
        <div className="timeline-wrap">
          <Timeline />
        </div>
      </div>
      <div className="side">
        <ClipList />
      </div>
      <div className="seq">
        <Sequence />
      </div>
    </div>
  );
}
