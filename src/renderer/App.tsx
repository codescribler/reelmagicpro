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
import { SettingsModal } from './components/SettingsModal';
import { EmptyState } from './components/EmptyState';
import { loadProjectInteractive } from './state/loadProject';
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
  const clipCreatedToken = useProjectStore(s => s.clipCreatedToken);
  const sequenceAppendToken = useProjectStore(s => s.sequenceAppendToken);
  const sideRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // Flash the right panel border whenever a clip is added — so the just-
  // created clip (which auto-selects into the side panel) doesn't appear
  // silently in the periphery. Imperative classList toggle with a forced
  // reflow restarts the CSS animation even when bumps land back-to-back.
  useEffect(() => {
    if (clipCreatedToken === 0) return;
    const el = sideRef.current;
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    const id = setTimeout(() => el.classList.remove('flash'), 1400);
    return () => clearTimeout(id);
  }, [clipCreatedToken]);

  // Same trick for the sequence bar — the user clicks "+ Add to sequence"
  // up in the clip detail and would otherwise have no idea the clip just
  // landed at the bottom of the screen. rAF defers the flash one frame so
  // it lands after the bar has rendered (it transitions from hidden / hint
  // to full when the sequence becomes non-empty).
  useEffect(() => {
    if (sequenceAppendToken === 0) return;
    const raf = requestAnimationFrame(() => {
      const el = seqRef.current;
      if (!el) return;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1400);
    });
    return () => cancelAnimationFrame(raf);
  }, [sequenceAppendToken]);

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

  async function runSequenceExport() {
    if (!project) return;
    if (project.sequence.length === 0) return;
    const out = await window.reelmagic.chooseExportPath(`sequence.mp4`);
    if (!out.ok || !out.path) return;
    const runId = 'r_' + Math.random().toString(36).slice(2, 10);
    startRun(runId);
    const r = await window.reelmagic.exportSequence({
      runId, clips: project.clips, sequence: project.sequence,
      source: project.sourceVideo, outputPath: out.path,
    });
    setExportResult(r.ok ? { ok: true, outputPath: r.outputPath } : { ok: false, error: r.error });
  }

  if (!project) {
    return (
      <>
        <EmptyState
          onOpenVideo={handleOpen}
          onOpenProject={loadProjectInteractive}
        />
        {/* Settings is still reachable in case the user wants to tweak prefs
            before loading a video, but kept off-screen until invoked via
            keyboard or a future affordance. */}
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </>
    );
  }

  // Sequence is a power feature: stitching multiple clips into one render.
  // Hide it on first run (0–1 clips, no existing sequence) so the bottom bar
  // doesn't burn 96px on something the user can't yet do anything with. Show
  // a thin discovery stripe at exactly 1 clip so a returning user knows the
  // feature exists.
  const seqMode: 'full' | 'hint' | 'none' =
    project.sequence.length > 0 || project.clips.length >= 2 ? 'full'
      : project.clips.length === 1 ? 'hint'
      : 'none';

  return (
    <div className="app" data-seq={seqMode}>
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
      <div className="side" ref={sideRef}>
        <RightPanel onExport={runClipExport} />
      </div>
      {seqMode === 'full' && (
        <div className="seq" ref={seqRef}>
          <Sequence onExportSequence={runSequenceExport} />
        </div>
      )}
      {seqMode === 'hint' && (
        <div className="seq-stripe" title="Make a 2nd clip and you can stitch them into one reel">
          <span>✂ Make a 2nd clip to stitch them into one reel</span>
        </div>
      )}
      <ExportProgressModal />
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
