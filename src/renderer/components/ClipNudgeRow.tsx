import React from 'react';
import { useProjectStore } from '../state/projectStore';
import type { Clip } from '../../shared/types';

const BIG_NUDGE_FRAMES = 10;

function fmtTimePrecise(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2);
  return `${m}:${sec.padStart(5, '0')}`;
}

// Precise in/out display + frame-accurate nudge buttons. Lives on the clip
// detail panel (below the clip name) so a power user can fine-tune the
// boundaries while looking at the clip they're editing — without going back
// out to a timeline. One-frame nudge on a normal click; ten-frame nudge with
// Shift held — discoverable via the tooltip.
//
// `fps` is the clip's own source framerate; the parent looks it up.
export function ClipNudgeRow({ clip, fps }: { clip: Clip; fps: number }) {
  const nudge = useProjectStore(s => s.nudgeClipBoundary);
  const frame = 1 / Math.max(1, fps);

  function nudgeBy(which: 'in' | 'out', direction: -1 | 1, big: boolean) {
    const frames = big ? BIG_NUDGE_FRAMES : 1;
    nudge(clip.id, which, direction * frames * frame);
  }
  function bigTip(label: string): string {
    return `${label} (Shift+click: ${BIG_NUDGE_FRAMES} frames)`;
  }

  const length = clip.out - clip.in;

  return (
    <div className="nudge-row clip-detail-nudge">
      <span className="nudge-group" title="Fine-tune the clip's start frame">
        <button
          className="nudge-btn"
          onClick={e => nudgeBy('in', -1, e.shiftKey)}
          title={bigTip('Nudge in back 1 frame')}>‹</button>
        <span className="nudge-label">in</span>
        <span className="nudge-time">{fmtTimePrecise(clip.in)}</span>
        <button
          className="nudge-btn"
          onClick={e => nudgeBy('in', 1, e.shiftKey)}
          title={bigTip('Nudge in forward 1 frame')}>›</button>
      </span>
      <span className="nudge-sep">·</span>
      <span className="nudge-group" title="Fine-tune the clip's end frame">
        <button
          className="nudge-btn"
          onClick={e => nudgeBy('out', -1, e.shiftKey)}
          title={bigTip('Nudge out back 1 frame')}>‹</button>
        <span className="nudge-label">out</span>
        <span className="nudge-time">{fmtTimePrecise(clip.out)}</span>
        <button
          className="nudge-btn"
          onClick={e => nudgeBy('out', 1, e.shiftKey)}
          title={bigTip('Nudge out forward 1 frame')}>›</button>
      </span>
      <span className="nudge-sep">·</span>
      <span className="dim">length {fmtTimePrecise(length)}</span>
    </div>
  );
}
