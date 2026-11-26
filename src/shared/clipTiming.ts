import type { BackingTrack, Clip, FocusMarker } from './types';
import { trimZoomPath } from './dynamicZoom';

// Interpolate at a cut, rather than clamping discarded samples onto the same
// timestamp. Extensions hold the nearest recorded position.
function trimSpatialPath<T extends { t: number; cx: number; cy?: number }>(
  path: T[], offset: number, duration: number,
): T[] {
  if (!path.length) return path;
  function at(t: number): T {
    const first = path[0]!, last = path[path.length - 1]!;
    if (t <= first.t) return { ...first, t: t - offset };
    if (t >= last.t) return { ...last, t: t - offset };
    const index = path.findIndex(p => p.t > t);
    const a = path[index - 1]!, b = path[index]!;
    const f = (t - a.t) / (b.t - a.t);
    const point = { ...a, t: t - offset, cx: a.cx + (b.cx - a.cx) * f };
    if (a.cy !== undefined && b.cy !== undefined) point.cy = a.cy + (b.cy - a.cy) * f;
    return point;
  }
  return [at(offset),
    ...path.filter(p => p.t > offset && p.t < offset + duration).map(p => ({ ...p, t: p.t - offset })),
    at(offset + duration)];
}

export function shiftMusicTiming(track: BackingTrack, delta: number, moment: number | undefined): BackingTrack {
  const next = { ...track };
  if (delta !== 0) next.offsetSec = (track.offsetSec ?? 0) + delta;
  if (moment === undefined) delete next.videoMomentSec;
  else next.videoMomentSec = moment;
  return next;
}

export function updateMarkerTiming(marker: FocusMarker, patch: Partial<FocusMarker>, clipIn: number): FocusMarker {
  const next = { ...marker, ...patch };
  if (marker.timingSource) {
    next.timingSource = { ...marker.timingSource };
    if ('in' in patch) next.timingSource.in = next.in;
    if ('out' in patch) next.timingSource.out = next.out;
    if ('path' in patch) {
      next.timingSource.clipIn = clipIn;
      next.timingSource.path = next.path;
    }
  }
  return next;
}

// Paths use source seconds relative to clip.in. Marker visibility uses absolute
// source seconds; music uses output seconds. Keep each on its own clock.
export function updateClipTiming(clip: Clip, patch: Partial<Clip>): Clip {
  const next = { ...clip, ...patch };
  const timing = { ...clip.timingSource };
  // Explicit replacements are recorded against the current edit's clock.
  if ('zoomPath' in patch) delete timing.zoom;
  if ('reelFraming' in patch) delete timing.reel;
  if ('backingTrack' in patch) {
    const track = patch.backingTrack, old = clip.backingTrack;
    if (timing.music && track && old && track.path === old.path
      && track.offsetSec === old.offsetSec && track.videoMomentSec === old.videoMomentSec
      && track.musicMomentSec === old.musicMomentSec) {
      timing.music = { ...timing.music, track: { ...track,
        offsetSec: timing.music.track.offsetSec, videoMomentSec: timing.music.track.videoMomentSec } };
    } else delete timing.music;
  }
  if ('speed' in patch) delete timing.music;
  if ('focusMarkers' in patch) next.focusMarkers = next.focusMarkers.map(({ timingSource: _, ...m }) => m);
  if (clip.timingSource) next.timingSource = timing;
  if (next.in === clip.in && next.out === clip.out) return next;
  const duration = Math.max(0, next.out - next.in);
  if (!('zoomPath' in patch) && clip.zoomPath) {
    timing.zoom ??= { in: clip.in, path: clip.zoomPath };
    next.zoomPath = trimZoomPath(timing.zoom.path, next.in - timing.zoom.in, duration);
  }
  if (!('focusMarkers' in patch)) next.focusMarkers = clip.focusMarkers.map(marker => {
    const source = marker.timingSource ?? { clipIn: clip.in, in: marker.in, out: marker.out, path: marker.path };
    const clamp = (v: number) => Math.max(next.in, Math.min(next.out, v));
    return { ...marker, timingSource: source, in: clamp(source.in), out: clamp(source.out),
      ...(source.path ? { path: trimSpatialPath(source.path, next.in - source.clipIn, duration) } : {}) };
  });
  if (!('reelFraming' in patch) && clip.reelFraming) {
    timing.reel ??= { in: clip.in, framing: clip.reelFraming };
    next.reelFraming = { ...clip.reelFraming,
      panPath: trimSpatialPath(timing.reel.framing.panPath, next.in - timing.reel.in, duration) };
  }
  if (!('backingTrack' in patch) && clip.backingTrack) {
    timing.music ??= { in: clip.in, speed: clip.speed, track: clip.backingTrack };
    const { track, in: originalIn, speed } = timing.music;
    const sourceMoment = track.videoMomentSec === undefined ? undefined : originalIn + track.videoMomentSec * speed;
    const moment = sourceMoment !== undefined && sourceMoment >= next.in && sourceMoment <= next.out
      ? (sourceMoment - next.in) / next.speed : undefined;
    next.backingTrack = shiftMusicTiming(track, -(next.in - originalIn) / next.speed, moment);
  }
  if (Object.keys(timing).length) next.timingSource = timing;
  return next;
}
