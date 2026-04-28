import { buildClipFfmpegArgs } from '../../src/main/ffmpeg/command';
import type { Clip, SourceMeta } from '../../src/shared/types';

const source: SourceMeta = { path: '/in.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };
const baseClip: Clip = {
  id: 'c1', name: 'A', in: 10, out: 20, speed: 1,
  zoom: { x: 0, y: 0, width: 1920, height: 1080 },
};

test('builds args for full-frame, 1x speed', () => {
  const args = buildClipFfmpegArgs(baseClip, source, '/out.mp4');
  expect(args).toEqual([
    '-y',
    '-ss', '10', '-to', '20', '-i', '/in.mp4',
    '-filter_complex', '[0:v]crop=1920:1080:0:0,scale=1920:1080,setpts=PTS[v]',
    '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
    '/out.mp4',
  ]);
});

test('uses silent audio and PTS/s when speed != 1', () => {
  const clip: Clip = { ...baseClip, speed: 0.5 };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  expect(args).toContain('-f');
  expect(args).toContain('lavfi');
  expect(args).toContain('anullsrc=cl=stereo:r=48000');
  const fcIndex = args.indexOf('-filter_complex');
  expect(args[fcIndex + 1]).toBe('[0:v]crop=1920:1080:0:0,scale=1920:1080,setpts=PTS/0.5[v]');
  expect(args).toContain('-shortest');
  expect(args).toContain('1:a');
});

test('uses zoom rect in crop and rescales to source size', () => {
  const clip: Clip = { ...baseClip, zoom: { x: 100, y: 50, width: 640, height: 360 } };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIndex = args.indexOf('-filter_complex');
  expect(args[fcIndex + 1]).toBe('[0:v]crop=640:360:100:50,scale=1920:1080,setpts=PTS[v]');
});

test('formats fractional seconds without exponent', () => {
  const clip: Clip = { ...baseClip, in: 12.4, out: 18.75 };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const ssIdx = args.indexOf('-ss');
  expect(args[ssIdx + 1]).toBe('12.4');
  const toIdx = args.indexOf('-to');
  expect(args[toIdx + 1]).toBe('18.75');
});
