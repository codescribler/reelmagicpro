import React, { useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';

export function ZoomRegionOverlay({ clipId, sourceWidth, sourceHeight, displayWidth, displayHeight }: {
  clipId: string;
  sourceWidth: number;
  sourceHeight: number;
  displayWidth: number;
  displayHeight: number;
}) {
  const update = useProjectStore(s => s.updateClip);
  const setMode = useProjectStore(s => s.setPreviewMode);
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  function localXY(e: { clientX: number; clientY: number }) {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(displayWidth, e.clientX - r.left)),
      y: Math.max(0, Math.min(displayHeight, e.clientY - r.top)),
    };
  }

  function onDown(e: React.MouseEvent) {
    const p = localXY(e);
    setDrag({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    const onMove = (ev: MouseEvent) => {
      const q = localXY(ev);
      setDrag(d => d ? { ...d, x2: q.x, y2: q.y } : null);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function confirm() {
    if (!drag) return;
    const x1 = Math.min(drag.x1, drag.x2);
    const y1 = Math.min(drag.y1, drag.y2);
    const x2 = Math.max(drag.x1, drag.x2);
    const y2 = Math.max(drag.y1, drag.y2);
    if (x2 - x1 < 4 || y2 - y1 < 4) return;
    const sx = sourceWidth / displayWidth;
    const sy = sourceHeight / displayHeight;
    update(clipId, {
      zoom: {
        x: Math.round(x1 * sx),
        y: Math.round(y1 * sy),
        width: Math.round((x2 - x1) * sx),
        height: Math.round((y2 - y1) * sy),
      },
    });
    setMode({ kind: 'clip', clipId });
  }

  function cancel() { setMode({ kind: 'clip', clipId }); }

  return (
    <div ref={ref}
      onMouseDown={onDown}
      style={{
        position: 'absolute', inset: 0, cursor: 'crosshair',
        background: 'rgba(0,0,0,0.35)',
      }}>
      {drag && (() => {
        const x = Math.min(drag.x1, drag.x2);
        const y = Math.min(drag.y1, drag.y2);
        const w = Math.abs(drag.x2 - drag.x1);
        const h = Math.abs(drag.y2 - drag.y1);
        return <div style={{
          position: 'absolute', left: x, top: y, width: w, height: h,
          border: '2px solid var(--accent)', background: 'rgba(94,155,255,0.15)',
        }} />;
      })()}
      <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', gap: 6 }}>
        <button onClick={cancel}>Cancel</button>
        <button className="primary" disabled={!drag} onClick={confirm}>Confirm zoom</button>
      </div>
    </div>
  );
}
