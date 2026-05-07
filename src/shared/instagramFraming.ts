import type { Clip, FocusMarker, SourceMeta } from './types';

export interface IgFramingOpts {
  paddingFactor?: number;       // crop height = marker.height × paddingFactor (default 2.5)
  minHeightFraction?: number;   // crop height ≥ source.height × this (default 0.30)
  smoothingSigmaSeconds?: number; // Gaussian σ on the smoothing pass (default 0.5)
  defaultZoomFraction?: number; // crop height when no marker (default 0.70 of source.height)
  targetAspect?: number;        // crop width / height (default 9/16)
}

export interface IgFramingSample {
  t: number;   // clip-relative seconds (0 = clip.in)
  cx: number;  // centre x in SOURCE pixels (same coord space as marker.x/y)
  cy: number;  // centre y in source pixels
  w: number;   // crop width in source pixels
  h: number;   // crop height in source pixels
}

const DEFAULTS: Required<IgFramingOpts> = {
  paddingFactor: 2.5,
  minHeightFraction: 0.30,
  smoothingSigmaSeconds: 0.5,
  defaultZoomFraction: 0.70,
  targetAspect: 9 / 16,
};

function withDefaults(opts: IgFramingOpts | undefined): Required<IgFramingOpts> {
  return { ...DEFAULTS, ...(opts ?? {}) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Pick the marker that drives Instagram framing. Explicit primary wins; if
// none flagged, fall back to the first marker. Returns null when the clip has
// no markers — callers fall back to the focus-box centre in that case.
export function pickDrivingMarker(clip: Clip): FocusMarker | null {
  if (clip.focusMarkers.length === 0) return null;
  const explicit = clip.focusMarkers.find(m => m.primary === true);
  return explicit ?? clip.focusMarkers[0]!;
}

// Build the raw (unsmoothed, unclamped) framing series from the clip's
// driving marker. When no marker is available, returns a constant series
// centred on the clip's focus box. The return is sampled at the path's
// existing time points (or at clip start/end for static cases), ready to
// feed into the smoothing pass.
export function buildRawSeries(
  clip: Clip,
  source: SourceMeta,
  opts?: IgFramingOpts,
): IgFramingSample[] {
  const o = withDefaults(opts);
  const driver = pickDrivingMarker(clip);
  const duration = Math.max(0, clip.out - clip.in);

  const minH = source.height * o.minHeightFraction;
  const maxH = source.height;

  if (!driver) {
    const cx = clip.zoom.x + clip.zoom.width / 2;
    const cy = clip.zoom.y + clip.zoom.height / 2;
    const h = clamp(source.height * o.defaultZoomFraction, minH, maxH);
    const w = Math.min(h * o.targetAspect, source.width);
    return [
      { t: 0, cx, cy, w, h },
      { t: duration, cx, cy, w, h },
    ];
  }

  // Marker height drives crop size (padded). The same value is applied at
  // every sample for static markers; for tracked markers we still use the
  // marker box dims (path samples carry only centres). If you want size to
  // vary along the path, that would need keyframed marker dims — out of
  // scope for v1.
  const rawH = driver.height * o.paddingFactor;
  const h = clamp(rawH, minH, maxH);
  const w = Math.min(h * o.targetAspect, source.width);

  if (!driver.path || driver.path.length === 0) {
    const cx = driver.x + driver.width / 2;
    const cy = driver.y + driver.height / 2;
    return [
      { t: 0, cx, cy, w, h },
      { t: duration, cx, cy, w, h },
    ];
  }

  return driver.path.map(p => ({ t: p.t, cx: p.cx, cy: p.cy, w, h }));
}

// Symmetric Gaussian smoothing of a time series. We're operating offline on
// a known full path, so we can look ahead and behind. Endpoints are NOT held
// fixed — they get blended too — so a constant prefix/suffix of the input
// pulls them toward the constant value (which is what we want when the input
// itself starts at a stable position).
//
// O(N²) — paths in this app top out at a few hundred samples, no FFT needed.
export function gaussianSmoothSeries(
  samples: IgFramingSample[],
  sigmaSeconds: number,
): IgFramingSample[] {
  if (samples.length === 0) return [];
  if (sigmaSeconds <= 0 || samples.length === 1) {
    return samples.map(s => ({ ...s }));
  }
  const twoSigmaSq = 2 * sigmaSeconds * sigmaSeconds;
  return samples.map(centre => {
    let sumW = 0, cxSum = 0, cySum = 0, wSum = 0, hSum = 0;
    for (const other of samples) {
      const dt = other.t - centre.t;
      const weight = Math.exp(-(dt * dt) / twoSigmaSq);
      sumW += weight;
      cxSum += weight * other.cx;
      cySum += weight * other.cy;
      wSum  += weight * other.w;
      hSum  += weight * other.h;
    }
    return {
      t: centre.t,
      cx: cxSum / sumW,
      cy: cySum / sumW,
      w: wSum / sumW,
      h: hSum / sumW,
    };
  });
}

// Clamp each sample so the crop rect fits inside the source. Two stages:
//   1. If h > source.height or w > source.width, shrink both axes by the
//      tighter limiting factor (preserves the aspect chosen earlier).
//   2. Clamp cx/cy so [cx ± w/2, cy ± h/2] sits inside [0, source.{w,h}].
export function clampSeriesToSource(
  samples: IgFramingSample[],
  source: SourceMeta,
): IgFramingSample[] {
  return samples.map(s => {
    let { w, h } = s;
    const fitW = w > source.width ? source.width / w : 1;
    const fitH = h > source.height ? source.height / h : 1;
    const fit = Math.min(fitW, fitH);
    if (fit < 1) {
      w = w * fit;
      h = h * fit;
    }
    const halfW = w / 2;
    const halfH = h / 2;
    const cx = clamp(s.cx, halfW, source.width - halfW);
    const cy = clamp(s.cy, halfH, source.height - halfH);
    return { t: s.t, cx, cy, w, h };
  });
}
