import { buildConcatListContents, buildConcatFfmpegArgs } from '../../src/main/ffmpeg/concatList';

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
