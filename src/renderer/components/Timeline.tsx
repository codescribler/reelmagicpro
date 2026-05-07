import React, { useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { previewClock } from '../state/previewClock';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

function newId(): string {
  return 'clip_' + Math.random().toString(36).slice(2, 10);
}

export function Timeline() {
  const project = useProjectStore(s => s.project);
  const addClip = useProjectStore(s => s.addClip);
  const selectedClipId = useProjectStore(s => s.selectedClipId);
  const requestPause = useProjectStore(s => s.requestPause);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  if (!project) return <span className="dim" style={{ padding: 8, display: 'block' }}>Timeline</span>;
  const dur = project.sourceVideo.duration;
  const selectedClip = selectedClipId ? project.clips.find(c => c.id === selectedClipId) ?? null : null;

  function pixelToTime(clientX: number): number {
    const el = trackRef.current!;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return (x / rect.width) * dur;
  }

  function onMouseDown(e: React.MouseEvent) {
    const t = pixelToTime(e.clientX);
    setDrag({ start: t, end: t });
    const onMove = (ev: MouseEvent) => {
      const nt = pixelToTime(ev.clientX);
      setDrag(d => d ? { start: d.start, end: nt } : null);
      setHoverTime(nt);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onTrackHover(e: React.MouseEvent) {
    setHoverTime(pixelToTime(e.clientX));
  }
  function onTrackLeave() {
    if (!drag) setHoverTime(null);
  }

  function setInFromPreview() {
    const t = Math.max(0, Math.min(dur, previewClock.currentTime));
    setDrag(d => {
      if (!d) return { start: t, end: t };
      // If the user already has an out point greater than t, keep it; else snap.
      return { start: t, end: d.end > t ? d.end : t };
    });
  }
  function setOutFromPreview() {
    const t = Math.max(0, Math.min(dur, previewClock.currentTime));
    setDrag(d => {
      if (!d) return { start: t, end: t };
      return { start: d.start < t ? d.start : t, end: t };
    });
    // Pause so the playhead settles on the moment the user just marked,
    // rather than racing past it while they reach for the next button.
    requestPause();
  }

  function commit() {
    if (!drag || !project) return;
    const inT = Math.min(drag.start, drag.end);
    const outT = Math.max(drag.start, drag.end);
    if (outT - inT < 0.05) return;
    const sw = project.sourceVideo.width;
    const sh = project.sourceVideo.height;
    addClip({
      id: newId(),
      name: `Clip ${project.clips.length + 1}`,
      in: inT, out: outT, speed: 1,
      zoom: { x: 0, y: 0, width: sw, height: sh },
      focusMarkers: [],
    });
    setDrag(null);
  }

  const inT = drag ? Math.min(drag.start, drag.end) : 0;
  const outT = drag ? Math.max(drag.start, drag.end) : 0;
  const inPct = drag ? (inT / dur) * 100 : 0;
  const outPct = drag ? (outT / dur) * 100 : 0;
  const hoverPct = hoverTime != null ? (hoverTime / dur) * 100 : 0;

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, minHeight: 16 }}>
        {drag ? (
          <>
            <span><strong>Selecting…</strong></span>
            <span className="dim">
              in {fmtTime(inT)} &nbsp;·&nbsp; out {fmtTime(outT)} &nbsp;·&nbsp; length {fmtTime(outT - inT)}
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
          <span className="dim">Drag on the timeline to select a region, then click "Add Clip".</span>
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
        {drag && (
          <div style={{
            position: 'absolute', left: `${inPct}%`, width: `${outPct - inPct}%`,
            top: 0, bottom: 0, background: 'rgba(94,155,255,0.4)', border: '1px solid var(--accent)',
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
          {drag ? `in ${fmtTime(inT)}  out ${fmtTime(outT)}` : `${fmtTime(dur)}`}
        </span>
        <span className="dim">{fmtTime(dur)}</span>
      </div>
      <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={setInFromPreview} title="Use the preview's current playhead as the start of the selection">Set in (from preview)</button>
        <button onClick={setOutFromPreview} title="Use the preview's current playhead as the end of the selection">Set out (from preview)</button>
        <button disabled={!drag || (outT - inT) < 0.05} onClick={commit}>Add Clip</button>
        {drag && <button onClick={() => setDrag(null)}>Clear</button>}
      </div>
    </div>
  );
}
