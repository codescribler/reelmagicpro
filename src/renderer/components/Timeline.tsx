import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { previewClock } from '../state/previewClock';
import type { Project } from '../../shared/types';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

function newId(): string {
  return 'clip_' + Math.random().toString(36).slice(2, 10);
}

// Selection model. `out: null` = "Start clip" pressed, waiting for End — the
// highlight grows live with the playhead. `out: number` = full range, either
// because the user dragged on the track or because End was just pressed (we
// auto-commit before this state is rendered).
type Selection = { in: number; out: number | null };

function commitClip(proj: Project, inT: number, outT: number) {
  if (outT - inT < 0.05) return;
  const sw = proj.sourceVideo.width;
  const sh = proj.sourceVideo.height;
  const id = newId();
  const st = useProjectStore.getState();
  st.addClip({
    id,
    // "Untitled clip N" rather than "Clip N" — the word "Untitled" tells
    // the user this is a placeholder they should replace, without needing
    // any extra UI hint.
    name: `Untitled clip ${proj.clips.length + 1}`,
    in: inT, out: outT, speed: 1,
    zoom: { x: 0, y: 0, width: sw, height: sh },
    focusMarkers: [],
  });
  // Drill straight into the clip detail view so the user lands on the export
  // buttons instead of having to spot the new row in the list.
  st.selectClip(id);
}

export function Timeline() {
  // All hooks live above any early return so the call order is identical on
  // every render — React's rules-of-hooks invariant.
  const project = useProjectStore(s => s.project);
  const selectedClipId = useProjectStore(s => s.selectedClipId);
  const trackRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  // Forces a re-render on each animation frame while marking is live so the
  // highlight grows visibly as the video plays.
  const [, setTickTime] = useState(0);

  // Refs so the global keydown listener (attached once) reads the latest
  // selection without needing to re-attach on every state change.
  const selRef = useRef<Selection | null>(null);
  selRef.current = sel;

  const isMarking = sel !== null && sel.out === null;

  // [/]/Esc shortcuts. `[` marks the start of a clip at the current playhead;
  // `]` marks the end and commits. Esc cancels an in-progress mark.
  // Capture phase so a focused control inside the native video shadow DOM
  // can't swallow the event before it reaches us — same trick used for B and
  // arrow keys in App.tsx.
  useEffect(() => {
    function isTyping(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping()) return;
      const st = useProjectStore.getState();
      const proj = st.project;
      if (!proj) return;
      if (st.previewMode.kind === 'track-marker') return;
      if (st.previewMode.kind === 'set-zoom') return;
      if (e.key === '[') {
        e.preventDefault();
        const t = Math.max(0, Math.min(proj.sourceVideo.duration, previewClock.currentTime));
        setSel({ in: t, out: null });
      } else if (e.key === ']') {
        e.preventDefault();
        const cur = selRef.current;
        if (!cur || cur.out !== null) return;
        const t = Math.max(0, Math.min(proj.sourceVideo.duration, previewClock.currentTime));
        const inT = Math.min(cur.in, t);
        const outT = Math.max(cur.in, t);
        if (outT - inT < 0.05) return;
        commitClip(proj, inT, outT);
        setSel(null);
        // Pause so the playhead settles on the moment the user just marked.
        useProjectStore.getState().requestPause();
      } else if (e.key === 'Escape' && selRef.current) {
        e.preventDefault();
        setSel(null);
      }
    }
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, []);

  // Tick the highlight at the rAF rate while a clip is being marked. We don't
  // store the time — just bump tickTime so React re-renders and reads the
  // current value of previewClock.currentTime in the JSX below.
  useEffect(() => {
    if (!isMarking) return;
    let raf = 0;
    const tick = () => {
      setTickTime(previewClock.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isMarking]);

  if (!project) return <span className="dim" style={{ padding: 8, display: 'block' }}>Timeline</span>;
  const dur = project.sourceVideo.duration;
  const selectedClip = selectedClipId ? project.clips.find(c => c.id === selectedClipId) ?? null : null;

  function pixelToTime(clientX: number): number {
    const el = trackRef.current!;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return (x / rect.width) * dur;
  }

  function startClip() {
    const t = Math.max(0, Math.min(dur, previewClock.currentTime));
    setSel({ in: t, out: null });
  }

  function endClip() {
    const cur = selRef.current;
    if (!cur || cur.out !== null) return;
    const t = Math.max(0, Math.min(dur, previewClock.currentTime));
    const inT = Math.min(cur.in, t);
    const outT = Math.max(cur.in, t);
    if (outT - inT < 0.05) return;
    if (project) commitClip(project, inT, outT);
    setSel(null);
    useProjectStore.getState().requestPause();
  }

  function cancelMarking() {
    setSel(null);
  }

  function onMouseDown(e: React.MouseEvent) {
    const t = pixelToTime(e.clientX);
    let curEnd = t;
    setSel({ in: t, out: t });
    const onMove = (ev: MouseEvent) => {
      const nt = pixelToTime(ev.clientX);
      curEnd = nt;
      setSel({ in: t, out: nt });
      setHoverTime(nt);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const inT = Math.min(t, curEnd);
      const outT = Math.max(t, curEnd);
      // Tiny taps don't make a clip — match the original 0.05s threshold.
      if (outT - inT >= 0.05) {
        const proj = useProjectStore.getState().project;
        if (proj) commitClip(proj, inT, outT);
      }
      setSel(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onTrackHover(e: React.MouseEvent) {
    setHoverTime(pixelToTime(e.clientX));
  }
  function onTrackLeave() {
    if (!sel || sel.out !== null) setHoverTime(null);
  }

  // Resolve the visible highlight range. While marking (out === null), the
  // end of the highlight follows the live playhead so the user can see how
  // long their clip is going to be.
  const highlightOut = sel
    ? (sel.out !== null ? sel.out : Math.min(dur, previewClock.currentTime))
    : null;
  const showHighlight = sel !== null && highlightOut !== null;
  const inT = sel ? Math.min(sel.in, highlightOut!) : 0;
  const outT = sel ? Math.max(sel.in, highlightOut!) : 0;
  const inPct = showHighlight ? (inT / dur) * 100 : 0;
  const outPct = showHighlight ? (outT / dur) * 100 : 0;
  const hoverPct = hoverTime != null ? (hoverTime / dur) * 100 : 0;

  return (
    <div style={{ padding: 8 }}>
      <div className="timeline-actions">
        <button
          className="primary"
          onClick={startClip}
          title="Mark the start of a clip at the current playhead (shortcut: [)">
          [ Start clip
        </button>
        <button
          className={isMarking ? 'primary' : ''}
          disabled={!isMarking}
          onClick={endClip}
          title="Mark the end of the clip and save it (shortcut: ])">
          End clip ]
        </button>
        {isMarking && (
          <button onClick={cancelMarking} title="Discard the in-progress clip (Esc)">
            Cancel
          </button>
        )}
        {isMarking && (
          <span className="marking-status">● Marking clip…</span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, minHeight: 16 }}>
        {sel ? (
          <>
            <span><strong>{isMarking ? 'Marking clip…' : 'Selecting…'}</strong></span>
            <span className="dim">
              in {fmtTime(inT)} &nbsp;·&nbsp; {sel.out !== null ? 'out' : 'now'} {fmtTime(outT)} &nbsp;·&nbsp; length {fmtTime(outT - inT)}
            </span>
          </>
        ) : selectedClip ? (
          <>
            <span><strong>{selectedClip.name}</strong></span>
            <span className="dim">
              in {fmtTime(selectedClip.in)} &nbsp;·&nbsp; out {fmtTime(selectedClip.out)} &nbsp;·&nbsp; length {fmtTime(selectedClip.out - selectedClip.in)}
            </span>
          </>
        ) : (
          <span className="dim">Press <kbd>[</kbd> to start a clip, then <kbd>]</kbd> to end it. Or drag on the timeline below.</span>
        )}
      </div>
      <div style={{ position: 'relative', height: 14, marginBottom: 2 }}>
        {hoverTime != null && (
          <span style={{
            position: 'absolute',
            left: `${hoverPct}%`,
            transform: 'translateX(-50%)',
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            padding: '0 4px',
            fontSize: 11,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}>
            {fmtTime(hoverTime)}
          </span>
        )}
      </div>
      <div ref={trackRef}
        onMouseDown={onMouseDown}
        onMouseMove={onTrackHover}
        onMouseLeave={onTrackLeave}
        style={{ position: 'relative', height: 32, background: '#15171b', borderRadius: 4, cursor: 'crosshair' }}>
        {project.clips.map(c => {
          const l = (c.in / dur) * 100;
          const w = ((c.out - c.in) / dur) * 100;
          const isSel = c.id === selectedClipId;
          return <div key={c.id} style={{
            position: 'absolute', left: `${l}%`, width: `${w}%`, top: 0, bottom: 0,
            background: isSel ? 'var(--accent-2)' : '#3a3f47',
            border: isSel ? '1px solid var(--accent)' : 'none',
            opacity: isSel ? 0.85 : 0.6,
          }} title={c.name} />;
        })}
        {showHighlight && (
          <div style={{
            position: 'absolute', left: `${inPct}%`, width: `${outPct - inPct}%`,
            top: 0, bottom: 0,
            background: isMarking ? 'rgba(109,209,13,0.35)' : 'rgba(94,155,255,0.4)',
            border: '1px solid var(--accent)',
          }} />
        )}
        {hoverTime != null && (
          <div style={{
            position: 'absolute', left: `${hoverPct}%`, top: 0, bottom: 0,
            width: 1, background: 'var(--accent)', pointerEvents: 'none', opacity: 0.8,
          }} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span className="dim">0:00.0</span>
        <span className="dim">
          {sel ? `in ${fmtTime(inT)}  ${sel.out !== null ? 'out' : 'now'} ${fmtTime(outT)}` : `${fmtTime(dur)}`}
        </span>
        <span className="dim">{fmtTime(dur)}</span>
      </div>
    </div>
  );
}
