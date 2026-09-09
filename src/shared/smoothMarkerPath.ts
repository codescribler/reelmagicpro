import type { FocusMarkerPathPoint } from './types';

// Average evenly spaced times, rather than samples, so pauses and uneven
// mouse sampling do not change the smoothing strength. Preserve click endpoints.
export function smoothMarkerPath(path: FocusMarkerPathPoint[], seconds: number): FocusMarkerPathPoint[] {
  if (seconds <= 0 || path.length < 3) return path;
  const radius = Math.min(seconds, 1) / 2;
  function at(t: number) {
    if (t <= path[0]!.t) return path[0]!;
    let low = 0;
    let high = path.length - 1;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (path[mid]!.t <= t) low = mid;
      else high = mid;
    }
    const a = path[low]!;
    const b = path[high]!;
    const f = b.t === a.t ? 0 : Math.min(1, (t - a.t) / (b.t - a.t));
    return { cx: a.cx + f * (b.cx - a.cx), cy: a.cy + f * (b.cy - a.cy) };
  }
  return path.map((point, index) => {
    if (index === 0 || index === path.length - 1) return point;
    const span = Math.min(radius, point.t - path[0]!.t, path[path.length - 1]!.t - point.t);
    let cx = 0, cy = 0, total = 0;
    for (let i = -4; i <= 4; i++) {
      const sample = at(point.t + span * i / 4);
      const weight = 5 - Math.abs(i);
      cx += sample.cx * weight;
      cy += sample.cy * weight;
      total += weight;
    }
    return { t: point.t, cx: cx / total, cy: cy / total };
  });
}
