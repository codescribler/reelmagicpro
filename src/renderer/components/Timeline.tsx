import React, { useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';

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
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);

  if (!project) return <span className="dim" style={{ padding: 8, display: 'block' }}>Timeline</span>;
  const dur = project.sourceVideo.duration;

  function pixelToTime(clientX: number): number {
    const el = trackRef.current!;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return (x / rect.width) * dur;
  }

  function onMouseDown(e: React.MouseEvent) {
    const t = pixelToTime(e.clientX);
    setDrag({ start: t, end: t });
    const onMove = (ev: MouseEvent) => setDrag(d => d ? { start: d.start, end: pixelToTime(ev.clientX) } : null);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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
    });
    setDrag(null);
  }

  const inT = drag ? Math.min(drag.start, drag.end) : 0;
  const outT = drag ? Math.max(drag.start, drag.end) : 0;
  const inPct = drag ? (inT / dur) * 100 : 0;
  const outPct = drag ? (outT / dur) * 100 : 0;

  return (
    <div style={{ padding: 8 }}>
      <div ref={trackRef}
        onMouseDown={onMouseDown}
        style={{ position: 'relative', height: 32, background: '#15171b', borderRadius: 4, cursor: 'crosshair' }}>
        {project.clips.map(c => {
          const l = (c.in / dur) * 100;
          const w = ((c.out - c.in) / dur) * 100;
          return <div key={c.id} style={{ position: 'absolute', left: `${l}%`, width: `${w}%`, top: 0, bottom: 0, background: '#3a3f47', opacity: 0.6 }} title={c.name} />;
        })}
        {drag && (
          <div style={{
            position: 'absolute', left: `${inPct}%`, width: `${outPct - inPct}%`,
            top: 0, bottom: 0, background: 'rgba(94,155,255,0.4)', border: '1px solid var(--accent)',
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
      <div style={{ marginTop: 6 }}>
        <button disabled={!drag || (outT - inT) < 0.05} onClick={commit}>Add Clip</button>
        {drag && <button onClick={() => setDrag(null)} style={{ marginLeft: 6 }}>Clear</button>}
      </div>
    </div>
  );
}
