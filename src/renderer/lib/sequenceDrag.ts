import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';

// The strip has N+1 insertion gaps. Removing the dragged entry shifts all
// later gaps left once, so convert the gap into the final array position.
export function sequenceDropIndex(from: number, gap: number, length: number): number | undefined {
  if (!Number.isInteger(from) || from < 0 || from >= length
    || !Number.isInteger(gap) || gap < 0 || gap > length) return undefined;
  return gap > from ? gap - 1 : gap;
}

export function useSequenceDrag(length: number, reorder: (from: number, to: number) => void,
  append: (clipId: string) => void) {
  const stripRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<number | null>(null);
  const mouseX = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [gap, setGap] = useState<number | null>(null);

  function gapAt(x: number): number {
    const tiles = stripRef.current?.querySelectorAll<HTMLElement>('[data-sequence-index]');
    if (tiles) for (const tile of tiles) {
      const bounds = tile.getBoundingClientRect();
      if (x < bounds.left + bounds.width / 2) return Number(tile.dataset.sequenceIndex);
    }
    return length;
  }

  function end() {
    fromRef.current = null;
    mouseX.current = null;
    setDragging(null);
    setGap(null);
  }

  function start(e: DragEvent<HTMLElement>, index: number) {
    if ((e.target as HTMLElement).closest('button')) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/seqIndex', String(index));
    fromRef.current = index;
    setDragging(index);
    setGap(index);
  }

  function over(e: DragEvent<HTMLDivElement>) {
    const types = Array.from(e.dataTransfer.types, type => type.toLowerCase());
    const internal = fromRef.current !== null || types.includes('text/seqindex');
    if (!internal && !types.includes('text/clipid')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy';
    if (internal) {
      mouseX.current = e.clientX;
      setGap(gapAt(e.clientX));
    }
  }

  function drop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData('text/seqIndex');
    const from = fromRef.current ?? (/^\d+$/.test(raw) ? Number(raw) : undefined);
    if (from !== undefined) {
      const to = sequenceDropIndex(from, gapAt(e.clientX), length);
      if (to !== undefined && to !== from) reorder(from, to);
    } else {
      const clipId = e.dataTransfer.getData('text/clipId');
      if (clipId) append(clipId);
    }
    end();
  }

  function leave(e: DragEvent<HTMLDivElement>) {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    mouseX.current = null;
    setGap(null);
  }

  // Keep long sequences usable while hovering near either edge of the strip.
  useEffect(() => {
    if (dragging === null) return;
    let frame = 0;
    const tick = () => {
      const strip = stripRef.current;
      if (strip && mouseX.current !== null) {
        const bounds = strip.getBoundingClientRect();
        const x = mouseX.current;
        if (x >= bounds.left && x <= bounds.right) {
          const delta = x < bounds.left + 32 ? -8 : x > bounds.right - 32 ? 8 : 0;
          if (delta) { strip.scrollLeft += delta; setGap(gapAt(x)); }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, length]);

  return { stripRef, dragging, gap, start, end, over, drop, leave };
}
