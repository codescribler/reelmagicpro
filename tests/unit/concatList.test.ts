import {
  buildConcatListContents, buildConcatFfmpegArgs, buildFilterConcatFfmpegArgs,
} from '../../src/main/ffmpeg/concatList';
import type { SourceMeta } from '../../src/shared/types';

const source: SourceMeta = { path: '/in.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };

test('builds list.txt contents with single-quoted absolute paths', () => {
  const out = buildConcatListContents([
    'C:/tmp/part-0.mp4',
    'C:/tmp/part-1.mp4',
  ]);
  expect(out).toBe(`file 'C:/tmp/part-0.mp4'\nfile 'C:/tmp/part-1.mp4'\n`);
});

test('escapes single quotes in path', () => {
  const out = buildConcatListContents(["C:/foo's/part.mp4"]);
  expect(out).toBe(`file 'C:/foo'\\''s/part.mp4'\n`);
});

test('builds concat ffmpeg args', () => {
  const args = buildConcatFfmpegArgs('/tmp/list.txt', '/out/final.mp4');
  expect(args).toEqual([
    '-y',
    '-f', 'concat', '-safe', '0',
    '-i', '/tmp/list.txt',
    '-c', 'copy',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
    '/out/final.mp4',
  ]);
});

test('filter concat: per-input scale+setsar normalisation feeds the concat node', () => {
  const args = buildFilterConcatFfmpegArgs(
    ['C:/tmp/part-0.mp4', 'C:/tmp/part-1.mp4', 'C:/tmp/outro.mp4'],
    '/out/final.mp4',
    source,
  );
  // 3 inputs, 3 -i flags.
  expect(args.filter(a => a === '-i')).toHaveLength(3);
  // Each input is scaled to source dimensions and forced to SAR=1 BEFORE the
  // concat node — so any per-input SAR drift can't crash the filter. The
  // concat then references the normalised video labels and the raw audio
  // streams.
  const fcIdx = args.indexOf('-filter_complex');
  expect(args[fcIdx + 1]).toBe(
    '[0:v]scale=1920:1080,setsar=1[v0n];'
    + '[1:v]scale=1920:1080,setsar=1[v1n];'
    + '[2:v]scale=1920:1080,setsar=1[v2n];'
    + '[v0n][0:a][v1n][1:a][v2n][2:a]concat=n=3:v=1:a=1[v][a]'
  );
  expect(args).toContain('-map');
  expect(args).toContain('[v]');
  expect(args).toContain('[a]');
  // preset=fast halves CPU vs medium on the concat pass with negligible
  // visual cost on already-encoded input.
  const presetIdx = args.indexOf('-preset');
  expect(args[presetIdx + 1]).toBe('fast');
  expect(args).toContain('libx264');
  expect(args).toContain('aac');
  // -aspect forces libx264 to encode SAR=1 into the SPS instead of
  // sometimes choosing odd ratios like 2025:2024 to express DAR exactly.
  const aspIdx = args.indexOf('-aspect');
  expect(args[aspIdx + 1]).toBe('1920:1080');
});

test('filter concat: rejects empty input list', () => {
  expect(() => buildFilterConcatFfmpegArgs([], '/out/x.mp4', source)).toThrow();
});
