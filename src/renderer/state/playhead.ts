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
