import type { CameraPoint, CameraView, Clip, SourceMeta, ZoomRect } from './types';

type Size = Pick<SourceMeta, 'width' | 'height'>;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function wheelZoom(zoom: number, delta: number, mode: number): number {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? 600 : 1);
  return clamp(zoom * Math.exp(-pixels * 0.002), 1, 6);
}

export function cameraCrop(view: CameraView, source: Size): ZoomRect {
  const zoom = clamp(view.zoom, 1, 6);
  const width = source.width / zoom;
  const height = source.height / zoom;
  return {
    x: clamp(view.cx - width / 2, 0, source.width - width),
    y: clamp(view.cy - height / 2, 0, source.height - height),
    width, height,
  };
}

export function pointerTarget(view: CameraView, x: number, y: number, source: Size) {
  const crop = cameraCrop(view, source);
  return { cx: crop.x + clamp(x, 0, 1) * crop.width, cy: crop.y + clamp(y, 0, 1) * crop.height };
}

// Exponential easing has the same response at any recording frame rate.
// Save its output, so playback/export do not introduce another smoothing lag.
export function easeCamera(view: CameraView, target: CameraView, dt: number, source: Size): CameraView {
  const alpha = 1 - Math.exp(-Math.max(0, dt) / 0.18);
  const next = {
    cx: view.cx + (target.cx - view.cx) * alpha,
    cy: view.cy + (target.cy - view.cy) * alpha,
    zoom: view.zoom + (target.zoom - view.zoom) * alpha,
  };
  const crop = cameraCrop(next, source);
  return { cx: crop.x + crop.width / 2, cy: crop.y + crop.height / 2, zoom: clamp(next.zoom, 1, 6) };
}

export function cameraAt(path: CameraPoint[], t: number): CameraView | undefined {
  if (!path.length) return undefined;
  if (t <= path[0]!.t) return path[0];
  let lo = 0, hi = path.length - 1;
  if (t >= path[hi]!.t) return path[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (path[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo]!, b = path[hi]!;
  const f = (t - a.t) / (b.t - a.t);
  return { cx: a.cx + (b.cx - a.cx) * f, cy: a.cy + (b.cy - a.cy) * f, zoom: a.zoom + (b.zoom - a.zoom) * f };
}

export function clipCropAt(clip: Clip, source: Size, t: number): ZoomRect {
  const view = cameraAt(clip.zoomPath ?? [], t);
  return view ? cameraCrop(view, source) : clip.zoom;
}

export function trimZoomPath(path: CameraPoint[] | undefined, offset: number, duration: number): CameraPoint[] | undefined {
  if (!path?.length) return path;
  return [
    { ...cameraAt(path, offset)!, t: 0 },
    ...path.filter(p => p.t > offset && p.t < offset + duration).map(p => ({ ...p, t: p.t - offset })),
    { ...cameraAt(path, offset + duration)!, t: Math.max(0, duration) },
  ];
}

export function normalizeZoomPath(path: CameraPoint[], source: Size, duration: number): CameraPoint[] {
  const points = new Map<number, CameraPoint>();
  for (const p of [...path].sort((a, b) => a.t - b.t)) {
    if (![p.t, p.cx, p.cy, p.zoom].every(Number.isFinite)) continue;
    const t = clamp(p.t, 0, Math.max(0, duration));
    const zoom = clamp(p.zoom, 1, 6);
    const crop = cameraCrop({ ...p, zoom }, source);
    points.set(t, { t, cx: crop.x + crop.width / 2, cy: crop.y + crop.height / 2, zoom });
  }
  return [...points.values()];
}
