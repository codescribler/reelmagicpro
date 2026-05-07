import type { FocusMarker, FocusMarkerPathPoint } from '../../shared/types';

// Drop every Nth point from a path while keeping the first and last samples
// exact. Used after smoothing to shrink the saved path: rAF sampling at ~60Hz
// over even a few seconds blows up the ffmpeg drawbox expression past the OS
// argv length limit. ~15Hz (every 4th point) is plenty for smooth linear
// interpolation between samples.
export function decimatePath(
  path: FocusMarkerPathPoint[],
  keepEvery = 4,
): FocusMarkerPathPoint[] {
  if (path.length <= 2 || keepEvery <= 1) return path.slice();
  const out: FocusMarkerPathPoint[] = [path[0]!];
  for (let i = 1; i < path.length - 1; i++) {
    if (i % keepEvery === 0) out.push(path[i]!);
  }
  out.push(path[path.length - 1]!);
  return out;
}

// Smooth a recorded motion path with a centred moving average over cx and cy.
// Endpoints are preserved exactly (they correspond to the user's click moments).
// Time values are untouched. The default window size of 9 samples removes most
// hand tremor at frame-rate sampling without flattening real motion.
export function smoothPath(
  path: FocusMarkerPathPoint[],
  windowSize = 9,
): FocusMarkerPathPoint[] {
  if (path.length <= 2) return path.slice();
  const half = Math.floor(windowSize / 2);
  const out: FocusMarkerPathPoint[] = [];
  for (let i = 0; i < path.length; i++) {
    if (i === 0 || i === path.length - 1) {
      out.push(path[i]!);
      continue;
    }
    let sumCx = 0;
    let sumCy = 0;
    let count = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(path.length - 1, i + half);
    for (let j = lo; j <= hi; j++) {
      sumCx += path[j]!.cx;
      sumCy += path[j]!.cy;
      count++;
    }
    out.push({ t: path[i]!.t, cx: sumCx / count, cy: sumCy / count });
  }
  return out;
}

// Compute the marker's centre at a given clip-relative time. If the marker has
// a recorded path, interpolate linearly between adjacent points; before the
// first point and after the last, clamp to the nearest endpoint. Without a
// path the centre is just (x + width/2, y + height/2).
export function markerCentreAt(m: FocusMarker, clipRelT: number): { cx: number; cy: number } {
  const path = m.path;
  if (!path || path.length === 0) {
    return { cx: m.x + m.width / 2, cy: m.y + m.height / 2 };
  }
  if (clipRelT <= path[0]!.t) return { cx: path[0]!.cx, cy: path[0]!.cy };
  const last = path[path.length - 1]!;
  if (clipRelT >= last.t) return { cx: last.cx, cy: last.cy };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    if (clipRelT >= a.t && clipRelT <= b.t) {
      const span = b.t - a.t;
      const f = span === 0 ? 0 : (clipRelT - a.t) / span;
      return { cx: a.cx + f * (b.cx - a.cx), cy: a.cy + f * (b.cy - a.cy) };
    }
  }
  return { cx: last.cx, cy: last.cy };
}
