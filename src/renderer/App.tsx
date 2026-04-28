import React, { useEffect } from 'react';
import { useProjectStore } from './state/projectStore';
import { Preview } from './components/Preview';
import { Timeline } from './components/Timeline';
import { ClipList } from './components/ClipList';
import { Sequence } from './components/Sequence';
import { MenuActions } from './components/MenuActions';
import { ExportProgressModal } from './components/ExportProgressModal';

export function App() {
  const project = useProjectStore(s => s.project);
  const dirty = useProjectStore(s => s.dirty);
  const setSource = useProjectStore(s => s.setSource);
  const startRun = useProjectStore(s => s.startRun);
  const setExportResult = useProjectStore(s => s.setExportResult);

  useEffect(() => {
    const off = window.reelmagic.onExportProgress(p => useProjectStore.getState().setProgress(p));
    return () => off();
  }, []);

  async function handleOpen() {
    const r = await window.reelmagic.openSourceVideo();
    if (r.source) setSource(r.source);
    else if (r.error) alert(`Couldn't read this file: ${r.error}`);
  }

  async function runClipExport(clipId: string) {
    if (!project) return;
    const clip = project.clips.find(c => c.id === clipId);
    if (!clip) return;
    const out = await window.reelmagic.chooseExportPath(`${clip.name}.mp4`);
    if (!out.ok || !out.path) return;
    const runId = 'r_' + Math.random().toString(36).slice(2, 10);
    startRun(runId);
    const r = await window.reelmagic.exportClip({
      runId, clip, source: project.sourceVideo, outputPath: out.path,
    });
    setExportResult(r.ok ? { ok: true, outputPath: r.outputPath } : { ok: false, error: r.error });
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
        <ClipList onExport={runClipExport} />
      </div>
      <div className="seq">
        <Sequence />
      </div>
      <ExportProgressModal />
    </div>
  );
}
