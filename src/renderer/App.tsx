import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore } from './state/projectStore';
import { useSettings } from './state/settings';
import { previewClock } from './state/previewClock';
import { keyToNudgeDelta } from './state/playhead';
import { Preview } from './components/Preview';
import { Timeline } from './components/Timeline';
import { RightPanel } from './components/RightPanel';
import { Sequence } from './components/Sequence';
import { MenuActions } from './components/MenuActions';
import { ExportProgressModal } from './components/ExportProgressModal';
import { ExportOptionsModal, ExportOptionsContext, ExportOptionsResult } from './components/ExportOptionsModal';
import { SettingsModal } from './components/SettingsModal';
import type { ExportFormat } from '../shared/types';
import logoUrl from './assets/reelmagic.png';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

export function App() {
  const project = useProjectStore(s => s.project);
  const dirty = useProjectStore(s => s.dirty);
  const setSource = useProjectStore(s => s.setSource);
  const startRun = useProjectStore(s => s.startRun);
  const setExportResult = useProjectStore(s => s.setExportResult);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpts, setExportOpts] = useState<{
    context: ExportOptionsContext;
    initialFormat: ExportFormat;
    next: (r: ExportOptionsResult) => void;
  } | null>(null);

  // Mirror modal-open state into a ref so the keydown handler (attached once)
  // can read the latest value without re-attaching on every state change.
  const settingsOpenRef = useRef(false);
  settingsOpenRef.current = settingsOpen;

  useEffect(() => {
    const off = window.reelmagic.onExportProgress(p => useProjectStore.getState().setProgress(p));
    return () => off();
  }, []);

  // Global shortcuts:
  //   B            — add a bookmark at the preview's current time
  //   ← / →        — skip the playhead by the configured number of seconds
  //
  // Attached to `document` in the capture phase so a focused <video controls>
  // element can't swallow the event before it reaches us. (That was the
  // "press play, then B does nothing until you click off the video" bug.)
  // Skipped while typing in an input, while no project is open, while a modal
  // is up, and while in track-marker mode (where ±5s would derail the recorded
  // path).
  useEffect(() => {
    function isTyping(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (settingsOpenRef.current) return;
      if (isTyping()) return;
      const st = useProjectStore.getState();
      if (!st.project) return;
      if (st.previewMode.kind === 'track-marker') return;

      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        const t = previewClock.currentTime;
        st.addBookmark(t);
        setToast(`Bookmarked at ${fmtTime(t)}`);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        st.requestSkip(-useSettings.getState().skipSeconds);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        st.requestSkip(+useSettings.getState().skipSeconds);
        return;
      }
      // Frame / 1-second nudge via comma and period (with optional shift). The
      // existing modifier check above already rejects Ctrl/Alt/Meta combos, so
      // keyToNudgeDelta only sees plain or shifted comma/period.
      const nudgeDelta = keyToNudgeDelta(
        { code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey },
        st.project.sourceVideo.fps,
      );
      if (nudgeDelta !== null) {
        e.preventDefault();
        st.requestSkip(nudgeDelta);
        return;
      }
    }
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(id);
  }, [toast]);

  async function handleOpen() {
    const r = await window.reelmagic.openSourceVideo();
    if (r.source) setSource(r.source);
    else if (r.error) alert(`Couldn't read this file: ${r.error}`);
  }

  function openOptionsModal(
    context: ExportOptionsContext,
    initialFormat: ExportFormat,
  ): Promise<ExportOptionsResult> {
    return new Promise(resolve => {
      setExportOpts({
        context, initialFormat,
        next: r => { setExportOpts(null); resolve(r); },
      });
    });
  }

  async function runClipExport(clipId: string, presetFormat: ExportFormat = 'standard') {
    if (!project) return;
    const clip = project.clips.find(c => c.id === clipId);
    if (!clip) return;
    const opts = await openOptionsModal({ kind: 'clip', clip, source: project.sourceVideo }, presetFormat);
    if (!opts.ok || !opts.format) return;
    const suffix = opts.format === 'instagram' ? '_reel' : '';
    const out = await window.reelmagic.chooseExportPath(`${clip.name}${suffix}.mp4`);
    if (!out.ok || !out.path) return;
    const runId = 'r_' + Math.random().toString(36).slice(2, 10);
    startRun(runId);
    const r = await window.reelmagic.exportClip({
      runId, clip, source: project.sourceVideo, outputPath: out.path,
      format: opts.format,
      instagramOutroPath: useSettings.getState().instagramOutroPath,
    });
    setExportResult(r.ok ? { ok: true, outputPath: r.outputPath } : { ok: false, error: r.error });
  }

  async function runSequenceExport(presetFormat: ExportFormat = 'standard') {
    if (!project) return;
    if (project.sequence.length === 0) return;
    const firstClipId = project.sequence[0]!.clipId;
    const firstClip = project.clips.find(c => c.id === firstClipId);
    const opts = await openOptionsModal(
      { kind: 'sequence', firstClip, source: project.sourceVideo },
      presetFormat,
    );
    if (!opts.ok || !opts.format) return;
    const suffix = opts.format === 'instagram' ? '_reel' : '';
    const out = await window.reelmagic.chooseExportPath(`sequence${suffix}.mp4`);
    if (!out.ok || !out.path) return;
    const runId = 'r_' + Math.random().toString(36).slice(2, 10);
    startRun(runId);
    const r = await window.reelmagic.exportSequence({
      runId, clips: project.clips, sequence: project.sequence,
      source: project.sourceVideo, outputPath: out.path,
      format: opts.format,
      instagramOutroPath: useSettings.getState().instagramOutroPath,
    });
    setExportResult(r.ok ? { ok: true, outputPath: r.outputPath } : { ok: false, error: r.error });
  }

  return (
    <div className="app">
      <div className="menubar">
        <img
          src={logoUrl}
          alt="ReelMagic"
          style={{ height: 26, width: 'auto', display: 'block' }}
        />
        <MenuActions />
        <button onClick={handleOpen}>Open video…</button>
        <span className="dim">{project ? project.sourceVideo.path : 'no source'}</span>
        {dirty && <span className="dim">●</span>}
        <button onClick={() => setSettingsOpen(true)} style={{ marginLeft: 'auto' }} title="Settings">
          ⚙ Settings
        </button>
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
        <RightPanel
          onExport={(id) => runClipExport(id, 'standard')}
          onExportInstagram={(id) => runClipExport(id, 'instagram')}
        />
      </div>
      <div className="seq">
        <Sequence
          onExportSequence={() => runSequenceExport('standard')}
          onExportSequenceInstagram={() => runSequenceExport('instagram')}
        />
      </div>
      <ExportProgressModal />
      {exportOpts && (
        <ExportOptionsModal
          open
          initialFormat={exportOpts.initialFormat}
          context={exportOpts.context}
          onResolve={exportOpts.next}
        />
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {toast && (
        <div className="toast" style={{
          position: 'fixed',
          bottom: 110, right: 16,
          background: 'rgba(20,22,26,0.92)',
          color: 'var(--text)',
          padding: '8px 14px',
          borderRadius: 6,
          border: '1px solid var(--accent-glow)',
          fontSize: 13,
          zIndex: 1000,
          pointerEvents: 'none',
          boxShadow: '0 6px 16px rgba(0,0,0,0.45)',
        }}>{toast}</div>
      )}
    </div>
  );
}
