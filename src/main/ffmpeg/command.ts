import type { Clip, SourceMeta } from '../../shared/types';

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(6)));
}

export function buildClipFfmpegArgs(
  clip: Clip,
  source: SourceMeta,
  outputPath: string,
): string[] {
  const { x, y, width, height } = clip.zoom;
  const setpts = clip.speed === 1 ? 'PTS' : `PTS/${fmt(clip.speed)}`;
  const filter = `[0:v]crop=${fmt(width)}:${fmt(height)}:${fmt(x)}:${fmt(y)},scale=${source.width}:${source.height},setpts=${setpts}[v]`;

  const head = ['-y', '-ss', fmt(clip.in), '-to', fmt(clip.out), '-i', source.path];
  const audioInput = clip.speed === 1 ? [] : ['-f', 'lavfi', '-i', 'anullsrc=cl=stereo:r=48000'];
  const fc = ['-filter_complex', filter];
  const map = clip.speed === 1
    ? ['-map', '[v]', '-map', '0:a?']
    : ['-map', '[v]', '-map', '1:a', '-shortest'];
  const enc = [
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
  ];

  return [...head, ...audioInput, ...fc, ...map, ...enc, outputPath];
}
