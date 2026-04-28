import React from 'react';
import { useProjectStore } from './state/projectStore';
import { Preview } from './components/Preview';

export function App() {
  const project = useProjectStore(s => s.project);
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
        <button onClick={handleOpen}>Open video…</button>
        <span className="dim">{project ? project.sourceVideo.path : 'no source'}</span>
      </div>
      <div className="main">
        <div className="preview-wrap">
          <Preview />
        </div>
        <div className="timeline-wrap">
          <span className="dim" style={{ padding: 8, display: 'block' }}>Timeline</span>
        </div>
      </div>
      <div className="side">
        <div style={{ padding: 12 }}><div className="dim">Clip list</div></div>
      </div>
      <div className="seq"><span className="dim">Sequence</span></div>
    </div>
  );
}
