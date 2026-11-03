import type { CameraPoint, SourceMeta } from '../../shared/types';
import { normalizeZoomPath } from '../../shared/dynamicZoom';

const fmt = (n: number) => String(Number(n.toFixed(6)));

// A sum of clamped ramps interpolates the saved path without deeply nested
// conditionals. Constant segments cost nothing; endpoints hold indefinitely.
function expression(points: CameraPoint[], key: 'cx' | 'cy' | 'zoom'): string {
  let result = fmt(points[0]![key]);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const change = b[key] - a[key];
    if (Math.abs(change) < 0.000001) continue;
    result += `+(${fmt(change)})*clip((it-${fmt(a.t)})/${fmt(b.t - a.t)},0,1)`;
  }
  return result;
}

export function dynamicZoomFilter(path: CameraPoint[], source: SourceMeta, duration: number): string {
  const points = normalizeZoomPath(path, source, duration);
  const zoom = expression(points, 'zoom');
  const cx = expression(points, 'cx');
  const cy = expression(points, 'cy');
  // Regularize VFR input first: zoompan emits one output per input frame and
  // otherwise discards gaps in input timestamps, shortening VFR footage.
  // Camera timestamps remain in source seconds, before slow motion.
  return `setpts=PTS-STARTPTS,fps=${fmt(source.fps)},zoompan=z='${zoom}':x='(${cx})-iw/zoom/2'`
    + `:y='(${cy})-ih/zoom/2':d=1:s=${source.width}x${source.height}:fps=${fmt(source.fps)}`;
}
