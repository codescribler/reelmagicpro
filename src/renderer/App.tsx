import React from 'react';
import { useProjectStore } from './state/projectStore';

export function App() {
  const project = useProjectStore(s => s.project);
  return (
    <div className="app">
      <div className="menubar">
        <strong>ReelMagic</strong>
        <span className="dim">{project ? '—' : 'no source'}</span>
      </div>
      <div className="main">
        <div className="preview-wrap">
          <span className="dim">Preview</span>
        </div>
        <div className="timeline-wrap">
          <span className="dim" style={{ padding: 8, display: 'block' }}>Timeline</span>
        </div>
      </div>
      <div className="side">
        <div style={{ padding: 12 }}>
          <div className="dim">Clip list</div>
        </div>
      </div>
      <div className="seq">
        <span className="dim">Sequence</span>
      </div>
    </div>
  );
}
