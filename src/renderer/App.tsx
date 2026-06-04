import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore } from './state/projectStore';
import { useSettings } from './state/settings';
import { previewClock } from './state/previewClock';
import { keyToNudgeDelta } from './state/playhead';
import { Preview } from './components/Preview';
import { RightPanel } from './components/RightPanel';
import { SourceTabs } from './components/SourceTabs';
import { Sequence } from './components/Sequence';
import { MenuActions } from './components/MenuActions';
import { ExportProgressModal } from './components/ExportProgressModal';
import { ExportOptionsModal, ExportOptionsContext, ExportOptionsResult } from './components/ExportOptionsModal';
import { SettingsModal } from './components/SettingsModal';
import { EmptyState } from './components/EmptyState';
import { LicenceGate } from './components/LicenceGate';
import { useLicenceStore, useLicenceSubscription } from './state/licence';
import { loadProjectInteractive } from './state/loadProject';
import logoUrl from './assets/reelmagic.png';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

export function App() {
  useLicenceSubscription();
  const licence = useLicenceStore(s => s.state);
  if (licence.kind !== 'unlocked') return <LicenceGate state={licence} />;
  return <Editor pastDue={licence.status === 'past_due'} />;
}

function Editor({ pastDue }: { pastDue: boolean }) {
  const project = useProjectStore(s => s.project);
  const dirty = useProjectStore(s => s.dirty);
  const setSource = useProjectStore(s => s.setSource);
  const startRun = useProjectStore(s => s.startRun);
  const setExportResult = useProjectStore(s => s.setExportResult);
  const clipCreatedToken = useProjectStore(s => s.clipCreatedToken);
  const sequenceAppendToken = useProjectStore(s => s.sequenceAppendToken);
  const activeSourceId = useProjectStore(s => s.activeSourceId);
  const sideRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Pending export awaiting a format choice. Set when the user hits Export;
  // cleared when the options dialog resolves. The chosen format (Standard or
  // Instagram/reel) is threaded into the actual export call.
  const [exportOptions, setExportOptions] = useState<ExportOptionsContext | null>(null);

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
      // Clip-marking shortcuts. [ starts a mark at the playhead, ] ends and
      // commits, Escape cancels an in-progress mark. State lives on the
      // store so the TransportBar's Start/End buttons share it. previewMode
      // gates these: editing modes (set-zoom / track-marker) and the source-
      // less idle state opt out.
      if (st.previewMode.kind === 'set-zoom') return;
      if (e.key === '[') {
        e.preventDefault();
        st.startMarking(previewClock.currentTime);
        return;
      }
      if (e.key === ']') {
        e.preventDefault();
        if (!st.marking) return;
        st.endMarking(previewClock.currentTime);
        st.requestPause();
        return;
      }
      if (e.key === 'Escape' && st.marking) {
        e.preventDefault();
        st.cancelMarking();
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
      // keyToNudgeDelta only sees plain or shifted comma/period. The fps used
      // is the ACTIVE source's — switching tabs in a multi-source project
      // updates this without remounting.
      const activeFps = (
        st.project.sources.find(src => src.id === st.activeSourceId)
        ?? st.project.sources[0]
        ?? st.project.sourceVideo
      ).fps;
      const nudgeDelta = keyToNudgeDelta(
        { code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey },
        activeFps,
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
    if (r.source) {
      // First video → setSource (creates the project). Subsequent picks of
      // "Open Video" / "+ Add video" → addSource (appends to existing
      // project's sources array and switches preview to the new one).
      const cur = useProjectStore.getState().project;
      if (cur) {
        useProjectStore.getState().addSource(r.source);
      } else {
        setSource(r.source);
      }
    } else if (r.error) alert(`Couldn't read this file: ${r.error}`);
  }

  // Export buttons open the format dialog first (Standard vs Instagram/reel).
  // The actual render happens in handleExportResolve once a format is picked.
  function runClipExport(clipId: string) {
    if (!project) return;
    const clip = project.clips.find(c => c.id === clipId);
    if (!clip) return;
    // Resolve the clip's own source — for multi-source projects the clip
    // might come from any of the imported videos. Falls back to the project
    // primary if sourceId is undefined (legacy single-source clip).
    const clipSource = project.sources.find(s => s.id === clip.sourceId)
      ?? project.sources[0]
      ?? project.sourceVideo;
    setExportOptions({ kind: 'clip', clip, source: clipSource });
  }

  function runSequenceExport() {
    if (!project) return;
    if (project.sequence.length === 0) return;
    const firstEntry = project.sequence[0];
    const firstClip = firstEntry
      ? project.clips.find(c => c.id === firstEntry.clipId)
      : undefined;
    const source = project.sources[0] ?? project.sourceVideo;
    setExportOptions({ kind: 'sequence', firstClip, source });
  }

  // Resolve the export-options dialog: on Continue, pick an output path and run
  // the export in the chosen format; on Cancel, just close the dialog.
  async function handleExportResolve(result: ExportOptionsResult) {
    const ctx = exportOptions;
    setExportOptions(null);
    if (!ctx || !result.ok || !result.format || !project) return;
    const format = result.format;
    const runId = 'r_' + Math.random().toString(36).slice(2, 10);
    if (ctx.kind === 'clip') {
      const out = await window.reelmagic.chooseExportPath(`${ctx.clip.name}.mp4`);
      if (!out.ok || !out.path) return;
      startRun(runId);
      const r = await window.reelmagic.exportClip({
        runId, clip: ctx.clip, source: ctx.source, outputPath: out.path, format,
      });
      setExportResult(r.ok ? { ok: true, outputPath: r.outputPath } : { ok: false, error: r.error });
    } else {
      const out = await window.reelmagic.chooseExportPath(`sequence.mp4`);
      if (!out.ok || !out.path) return;
      startRun(runId);
      const r = await window.reelmagic.exportSequence({
        runId, clips: project.clips, sequence: project.sequence,
        sources: project.sources, outputPath: out.path, format,
        sequenceBackingTrack: project.sequenceBackingTrack,
        sequenceBrightness: project.sequenceBrightness,
      });
      setExportResult(r.ok ? { ok: true, outputPath: r.outputPath } : { ok: false, error: r.error });
    }
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
        <span className="dim">{
          project
            ? (project.sources.find(s => s.id === activeSourceId)
                ?? project.sources[0] ?? project.sourceVideo).path
            : 'no source'
        }</span>
        {dirty && <span className="dim">●</span>}
        {pastDue && (
          <button
            onClick={() => window.reelmagic.licence.openAccountPage()}
            style={{ marginLeft: 'auto', borderColor: '#d97706', color: '#fde68a' }}
            title="Your last payment failed — update your card to keep your subscription active"
          >
            ⚠ Update payment
          </button>
        )}
        <button
          onClick={() => setSettingsOpen(true)}
          style={pastDue ? undefined : { marginLeft: 'auto' }}
          title="Settings"
        >
          ⚙ Settings
        </button>
      </div>
      <div className="main">
        <SourceTabs onAddVideo={handleOpen} />
        <div className="preview-wrap">
          <Preview />
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
      {exportOptions && (
        <ExportOptionsModal
          open
          context={exportOptions}
          onResolve={handleExportResolve}
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
