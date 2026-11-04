import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportSequence } from '../../src/main/ffmpeg/exporter';
import { probeVideo } from '../../src/main/ffmpeg/probe';
import type { Clip } from '../../src/shared/types';

const ffmpeg = require('ffmpeg-static') as string;
const ffprobe = require('ffprobe-static').path as string;
jest.setTimeout(60000);

test('fractional-rate sequences keep video timing across recorded and static zoom joins', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-sequence-timing-'));
  const input = path.join(dir, 'input.mp4');
  const output = path.join(dir, 'output.mp4');
  try {
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i',
      "color=c=red:s=320x240:r=30000/1001:d=4,drawbox=color=blue:t=fill:enable='gte(t,2)'",
      '-f', 'lavfi', '-i', 'anullsrc=cl=stereo:r=48000', '-shortest',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
    const source = await probeVideo(input);
    const base = { speed: 1, zoom: { x: 0, y: 0, width: 320, height: 240 }, focusMarkers: [] };
    const clips: Clip[] = [
      { ...base, id: 'camera', name: 'Recorded zoom', in: 0, out: 2,
        zoomPath: [{ t: 0, cx: 160, cy: 120, zoom: 1 }, { t: 2, cx: 160, cy: 120, zoom: 2 }] },
      { ...base, id: 'static', name: 'Static zoom', in: 2, out: 4 },
    ];
    const result = await exportSequence({
      runId: `timing-${path.basename(dir)}`, clips,
      sequence: ['camera', 'static', 'camera', 'static'].map(clipId => ({ clipId })),
      sources: [{ id: 'source', ...source }], outputPath: output,
    });
    expect(result).toMatchObject({ ok: true });
    const metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams',
      '-of', 'json', output], { encoding: 'utf8' }));
    const video = metadata.streams.find((s: any) => s.codec_type === 'video');
    const audio = metadata.streams.find((s: any) => s.codec_type === 'audio');
    expect(Number(video.duration)).toBeCloseTo(8, 0);
    expect(Math.abs(Number(video.duration) - Number(audio.duration))).toBeLessThan(0.15);

    const frames = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0',
      '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', output],
    { encoding: 'utf8' })).frames;
    const times = frames.map((frame: any) => Number(frame.best_effort_timestamp_time));
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThan(0.03);
      expect(times[i] - times[i - 1]).toBeLessThan(0.04);
    }
    // Every segment must remain seekable, with the expected picture after each join.
    for (const time of [1, 3, 5, 7]) {
      const rgb = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', output,
        '-frames:v', '1', '-vf', 'crop=2:2:160:120', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      const channel = time === 1 || time === 5 ? 0 : 2;
      expect(rgb[channel]).toBeGreaterThan(200);
      expect(rgb[channel === 0 ? 2 : 0]).toBeLessThan(30);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
