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

test('filter concat with sequence backing track + muteSource: parts video only, bg alone', () => {
  // Two clip parts totalling 10s. Backing track muted source — concat the
  // video only, ignore the parts' audio entirely, play the music at the
  // chosen volume, trim to 10s, fade out in the last 0.5s.
  const args = buildFilterConcatFfmpegArgs(
    ['C:/tmp/part-0.mp4', 'C:/tmp/part-1.mp4'],
    '/out/final.mp4',
    source,
    {
      backingTrack: { path: '/music.mp3', volume: 0.7, muteSource: true },
      totalDurationSec: 10,
    },
  );
  // 3 inputs: 2 parts + 1 backing track.
  expect(args.filter(a => a === '-i')).toHaveLength(3);
  expect(args).toContain('/music.mp3');
  const fcIdx = args.indexOf('-filter_complex');
  expect(args[fcIdx + 1]).toBe(
    '[0:v]scale=1920:1080,setsar=1[v0n];'
    + '[1:v]scale=1920:1080,setsar=1[v1n];'
    + '[v0n][v1n]concat=n=2:v=1:a=0[v];'
    + '[2:a]volume=0.7,atrim=duration=10,asetpts=PTS-STARTPTS,afade=t=out:st=9.5:d=0.5[aout]'
  );
  expect(args).toContain('[aout]');
  // No raw [a] map — sequence track takes over the audio stream.
  expect(args.indexOf('[a]')).toBe(-1);
});

test('filter concat with sequence backing track + keepSource: parts audio mixed with bg', () => {
  // Two clip parts totalling 8s. Backing track keeps source — concat parts'
  // audio, mix bg over the top, trim + fade.
  const args = buildFilterConcatFfmpegArgs(
    ['C:/tmp/part-0.mp4', 'C:/tmp/part-1.mp4'],
    '/out/final.mp4',
    source,
    {
      backingTrack: { path: '/music.mp3', volume: 0.5, muteSource: false },
      totalDurationSec: 8,
    },
  );
  const fcIdx = args.indexOf('-filter_complex');
  expect(args[fcIdx + 1]).toBe(
    '[0:v]scale=1920:1080,setsar=1[v0n];'
    + '[1:v]scale=1920:1080,setsar=1[v1n];'
    + '[v0n][0:a][v1n][1:a]concat=n=2:v=1:a=1[v][srcA];'
    + '[2:a]volume=0.5[bg];'
    + '[srcA][bg]amix=inputs=2:duration=first:normalize=0[mix];'
    + '[mix]anull,atrim=duration=8,asetpts=PTS-STARTPTS,afade=t=out:st=7.5:d=0.5[aout]'
  );
});

test('filter concat with sequence brightness only: eq tail appended after concat', () => {
  // No backing track, just a brightness offset. The concat node's [v] is
  // renamed to [vc] and an eq stage produces the final [v].
  const args = buildFilterConcatFfmpegArgs(
    ['C:/tmp/part-0.mp4', 'C:/tmp/part-1.mp4'],
    '/out/final.mp4',
    source,
    { brightness: -0.2 },
  );
  const fcIdx = args.indexOf('-filter_complex');
  expect(args[fcIdx + 1]).toBe(
    '[0:v]scale=1920:1080,setsar=1[v0n];'
    + '[1:v]scale=1920:1080,setsar=1[v1n];'
    + '[v0n][0:a][v1n][1:a]concat=n=2:v=1:a=1[vc][a]'
    + ';[vc]eq=brightness=-0.2[v]'
  );
  // Audio stream still mapped from the concat's [a].
  expect(args.indexOf('[a]')).toBeGreaterThan(0);
});

test('filter concat with both backing track and sequence brightness: bg path + eq tail', () => {
  const args = buildFilterConcatFfmpegArgs(
    ['C:/tmp/part-0.mp4', 'C:/tmp/part-1.mp4'],
    '/out/final.mp4',
    source,
    {
      backingTrack: { path: '/music.mp3', volume: 0.5, muteSource: true },
      totalDurationSec: 8,
      brightness: 0.15,
    },
  );
  const fcIdx = args.indexOf('-filter_complex');
  // muteSource path emits concat=...a=0[v] originally; the brightness pass
  // renames that to [vc] and adds the eq stage at the end.
  expect(args[fcIdx + 1]).toBe(
    '[0:v]scale=1920:1080,setsar=1[v0n];'
    + '[1:v]scale=1920:1080,setsar=1[v1n];'
    + '[v0n][v1n]concat=n=2:v=1:a=0[vc];'
    + '[2:a]volume=0.5,atrim=duration=8,asetpts=PTS-STARTPTS,afade=t=out:st=7.5:d=0.5[aout]'
    + ';[vc]eq=brightness=0.15[v]'
  );
});

test('filter concat without sequence backing track is byte-identical to the legacy path', () => {
  // Regression guard: opts={} should produce the exact same filter as the
  // no-opts call — otherwise existing sequence exports would silently
  // re-encode through a different chain.
  const a = buildFilterConcatFfmpegArgs(
    ['C:/tmp/part-0.mp4', 'C:/tmp/part-1.mp4'],
    '/out/final.mp4',
    source,
  );
  const b = buildFilterConcatFfmpegArgs(
    ['C:/tmp/part-0.mp4', 'C:/tmp/part-1.mp4'],
    '/out/final.mp4',
    source,
    {},
  );
  expect(b).toEqual(a);
});
