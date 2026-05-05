// Clamp a playhead time `t` into the inclusive range `[lo, hi]`. If the range
// is inverted (`hi < lo`), returns `lo` — this happens transiently during clip
// edits and we'd rather hold at the start than jump past the end.
export function clampPlayhead(t: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, t));
}
