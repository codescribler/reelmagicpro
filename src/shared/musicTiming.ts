import type { BackingTrack } from './types';

export function musicWindow(track: BackingTrack, outputDuration: number) {
  const offset = track.offsetSec ?? 0;
  const start = Math.max(0, offset);
  const end = Math.max(start, Math.min(outputDuration, (track.durationSec ?? Infinity) + offset));
  const length = Math.max(0, end - start);
  return { offset, start, end, length,
    fadeIn: Math.min(track.fadeInSec ?? 0, length / 2),
    fadeOut: Math.min(0.5, length / 2) };
}

/** Half-cosine easing, identical to FFmpeg's hsin fade curve. */
export function musicGain(track: BackingTrack, time: number, outputDuration: number) {
  const w = musicWindow(track, outputDuration);
  if (time < w.start || time >= w.end || !w.length) return 0;
  const ease = (x: number) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, x)))) / 2;
  const fadeIn = w.fadeIn ? ease((time - w.start) / w.fadeIn) : 1;
  const fadeOut = w.fadeOut ? ease((w.end - time) / w.fadeOut) : 1;
  return track.volume * fadeIn * fadeOut;
}

export function mediaFileUrl(path: string) {
  return `file:///${path.replace(/\\/g, '/').split('/').map((p, i) => i === 0 && p.endsWith(':') ? p : encodeURIComponent(p)).join('/').replace(/^\//, '')}`;
}
