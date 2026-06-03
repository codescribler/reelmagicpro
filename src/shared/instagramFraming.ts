import type { Clip, SourceMeta } from './types';

export interface ReelFramingOpts {
  smoothingSigmaSeconds?: number; // Gaussian σ on the smoothing pass (default 0.5)
}

export interface ReelFramingSample {
  t: number;   // clip-relative seconds (0 = clip.in)
  cx: number;  // crop centre x in SOURCE pixels
  cy: number;  // crop centre y in source pixels (always source centre)
  w: number;   // crop width in source pixels  (square: = cropSide)
  h: number;   // crop height in source pixels (square: = cropSide)
}

const DEFAULTS: Required<ReelFramingOpts> = {
  smoothingSigmaSeconds: 0.5,
};

function withDefaults(opts: ReelFramingOpts | undefined): Required<ReelFramingOpts> {
  return { ...DEFAULTS, ...(opts ?? {}) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// The reel crop is a full-height square slice of the source. For landscape
// footage cropSide = source.height; for the rare portrait case it clamps to
// source.width so the slice still fits.
export function reelCropSide(source: SourceMeta): number {
  return Math.min(source.height, source.width);
}

// Build the raw (unsmoothed) framing series. With a pan path we map each point
// to a full square slice at that horizontal centre; without one we return a
// constant centred series.
export function buildRawSeries(
  clip: Clip,
  source: SourceMeta,
): ReelFramingSample[] {
  const side = reelCropSide(source);
  const cy = source.height / 2;
  const duration = Math.max(0, clip.out - clip.in);
  const path = clip.reelFraming?.panPath;

  if (!path || path.length === 0) {
    const cx = source.width / 2;
    return [
      { t: 0, cx, cy, w: side, h: side },
      { t: duration, cx, cy, w: side, h: side },
    ];
  }
  return path.map(p => ({ t: p.t, cx: p.cx, cy, w: side, h: side }));
}

// Symmetric Gaussian smoothing of a time series (operates offline on the full
// path). Endpoints are blended too — a constant prefix/suffix pulls them toward
// the constant value. O(N²); paths top out at a few hundred samples.
export function gaussianSmoothSeries(
  samples: ReelFramingSample[],
  sigmaSeconds: number,
): ReelFramingSample[] {
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
    return { t: centre.t, cx: cxSum / sumW, cy: cySum / sumW, w: wSum / sumW, h: hSum / sumW };
  });
}

// Clamp each sample so the crop rect fits inside the source. Shrinks w/h if
// they exceed the source, then clamps cx/cy so the rect sits inside bounds.
export function clampSeriesToSource(
  samples: ReelFramingSample[],
  source: SourceMeta,
): ReelFramingSample[] {
  return samples.map(s => {
    let { w, h } = s;
    const fitW = w > source.width ? source.width / w : 1;
    const fitH = h > source.height ? source.height / h : 1;
    const fit = Math.min(fitW, fitH);
    if (fit < 1) { w = w * fit; h = h * fit; }
    const halfW = w / 2;
    const halfH = h / 2;
    const cx = clamp(s.cx, halfW, source.width - halfW);
    const cy = clamp(s.cy, halfH, source.height - halfH);
    return { t: s.t, cx, cy, w, h };
  });
}

const MAX_SEGMENTS = 40;

// Thin a series to at most maxSegments segments, keeping first and last and
// picking ~evenly spaced points between. Mirrors thinPathForExport in
// command.ts so the IG ffmpeg expression stays compact.
function thinSeries(samples: ReelFramingSample[], maxSegments: number): ReelFramingSample[] {
  if (samples.length <= maxSegments + 1) return samples;
  const factor = Math.ceil((samples.length - 1) / maxSegments);
  const out: ReelFramingSample[] = [samples[0]!];
  for (let i = factor; i < samples.length - 1; i += factor) out.push(samples[i]!);
  out.push(samples[samples.length - 1]!);
  return out;
}

// Public entry point. Pipeline: build raw series → Gaussian-smooth → clamp to
// source bounds → thin for compact downstream expressions.
export function computeReelFraming(
  clip: Clip,
  source: SourceMeta,
  opts?: ReelFramingOpts,
): { samples: ReelFramingSample[] } {
  const o = withDefaults(opts);
  const raw = buildRawSeries(clip, source);
  const smoothed = gaussianSmoothSeries(raw, o.smoothingSigmaSeconds);
  const clamped = clampSeriesToSource(smoothed, source);
  const thinned = thinSeries(clamped, MAX_SEGMENTS);
  return { samples: thinned };
}
