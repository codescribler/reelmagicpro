// Clamp a playhead time `t` into the inclusive range `[lo, hi]`. If the range
// is inverted (`hi < lo`), returns `lo` — this happens transiently during clip
// edits and we'd rather hold at the start than jump past the end.
export function clampPlayhead(t: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, t));
}

// Seconds per source frame at the given fps. Used to size the ±frame nudge.
export function frameStepSeconds(fps: number): number {
  return 1 / fps;
}

// Snap a playhead time to the nearest source-frame boundary. Avoids the
// playhead drifting off-grid after several nudges due to floating-point drift.
export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

// Subset of KeyboardEvent we actually look at. Lets us unit-test the function
// without constructing a full DOM event.
export interface NudgeKeyEvent {
  code: string;       // KeyboardEvent.code (physical key, e.g. 'Comma')
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

// Returns the nudge delta in seconds for the new fine-grained shortcuts
// (`,` / `.` with optional Shift), or null if the event doesn't match. Existing
// arrow shortcuts (±skipSeconds) keep their current handling in App.tsx — this
// function intentionally returns null for ArrowLeft/ArrowRight so callers can
// fall through.
export function keyToNudgeDelta(e: NudgeKeyEvent, fps: number): number | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  switch (e.code) {
    case 'Comma':
      return e.shiftKey ? -1 : -frameStepSeconds(fps);
    case 'Period':
      return e.shiftKey ? +1 : +frameStepSeconds(fps);
    default:
      return null;
  }
}
