import type { BackingTrack } from '../../shared/types';
import { musicWindow } from '../../shared/musicTiming';

const fmt = (n: number) => String(Number(n.toFixed(6)));

/** Trim before fading, then delay and pad so a short song never truncates video. */
export function musicFilter(track: BackingTrack, duration: number): string {
  const w = musicWindow(track, duration);
  const filters = [`atrim=start=${fmt(Math.max(0, -w.offset))}`, 'asetpts=PTS-STARTPTS',
    `volume=${fmt(track.volume)}`];
  if (w.fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fmt(w.fadeIn)}:curve=hsin`);
  if (w.fadeOut > 0) filters.push(`afade=t=out:st=${fmt(w.length - w.fadeOut)}:d=${fmt(w.fadeOut)}:curve=hsin`);
  if (w.start > 0) filters.push(`adelay=${Math.round(w.start * 48000)}S:all=1`);
  // A fixed sample rate makes the delay independent of the source encoding.
  filters.unshift('aresample=48000');
  filters.push('apad', `atrim=duration=${fmt(duration)}`, 'asetpts=PTS-STARTPTS');
  return filters.join(',');
}
