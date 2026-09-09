import { spawnSync } from 'child_process';
import ffmpeg from 'ffmpeg-static';
import { musicFilter } from '../../src/main/ffmpeg/musicFilter';
import { musicGain } from '../../src/shared/musicTiming';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildClipFfmpegArgs } from '../../src/main/ffmpeg/command';
import { buildFilterConcatFfmpegArgs } from '../../src/main/ffmpeg/concatList';
import { probeVideo } from '../../src/main/ffmpeg/probe';

test('short delayed music preserves the complete clip and concatenated sequence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-music-'));
  const run = (args: string[]) => {
    const result = spawnSync(ffmpeg!, ['-v', 'error', ...args], { encoding: 'utf8', timeout: 20000 });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  };
  try {
    const video = path.join(dir, 'source.mp4');
    const music = path.join(dir, 'song.wav');
    run(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=3', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
    run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', music]);
    const source = await probeVideo(video);
    const backingTrack = { path: music, volume: 0.6, muteSource: true, offsetSec: 1, durationSec: 1, fadeInSec: 0.5 };
    const clipOutput = path.join(dir, 'clip.mp4');
    run(buildClipFfmpegArgs({ id: 'a', name: 'A', in: 0, out: 3, speed: 1,
      zoom: { x: 0, y: 0, width: 320, height: 180 }, focusMarkers: [], backingTrack }, source, clipOutput));
    expect((await probeVideo(clipOutput)).duration).toBeCloseTo(3, 1);
    for (const muteSource of [true, false]) {
      const output = path.join(dir, `sequence-${muteSource}.mp4`);
      run(buildFilterConcatFfmpegArgs([video, video], output, source,
        { backingTrack: { ...backingTrack, muteSource }, totalDurationSec: 6 }));
      expect((await probeVideo(output)).duration).toBeCloseTo(6, 1);
    }
  } finally {
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file));
    fs.rmdirSync(dir);
  }
}, 60000);

test.each([-1, 1, 8, -8])('rendered audio matches preview gain and keeps full duration, offset %s', offsetSec => {
  const track = { path: '', volume: 0.6, muteSource: true, durationSec: 3, offsetSec, fadeInSec: 1 };
  const output = spawnSync(ffmpeg!, ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=1:s=48000:d=3',
    '-af', musicFilter(track, 5), '-ac', '1', '-f', 'f32le', 'pipe:1'], { maxBuffer: 2_000_000 });
  expect(output.stderr.toString()).toBe('');
  expect(output.status).toBe(0);
  expect(output.stdout.length / 4 / 48000).toBeCloseTo(5, 3);
  for (const time of [0.1, 0.5, 1, 1.5, 2, 2.75, 3.5, 4.5]) {
    expect(output.stdout.readFloatLE(Math.round(time * 48000) * 4)).toBeCloseTo(musicGain(track, time, 5), 3);
  }
});
