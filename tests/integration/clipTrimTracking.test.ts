import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportClip } from '../../src/main/ffmpeg/exporter';
import { updateClipTiming } from '../../src/shared/clipTiming';
import type { Clip } from '../../src/shared/types';
const ffmpeg = require('ffmpeg-static') as string;

jest.setTimeout(60000);

test.each([1, 0.5])('trimmed tracking stays on the recorded source frame in exported pixels at %sx', async speed => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-trim-track-'));
  const input = path.join(dir, 'black.mp4');
  const output = path.join(dir, 'output.mp4');
  try {
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i',
      'color=c=black:s=320x240:r=30:d=4', '-pix_fmt', 'yuv420p', input]);
    const source = { path: input, width: 320, height: 240, duration: 4, fps: 30 };
    const original: Clip = { id: 'c', name: 'Player', in: 0, out: 4, speed,
      zoom: { x: 0, y: 0, width: 320, height: 240 },
      focusMarkers: [{ id: 'm', in: 0, out: 4, x: 60, y: 60, width: 40, height: 40, color: 'white',
        path: [0, 1, 2, 3, 4].map(t => ({ t, cx: 80 + t * 40, cy: 80 })) }],
    };
    const clip = updateClipTiming(original, { in: 1, out: 3 });
    const result = await exportClip({ runId: 'trim', source, clip, outputPath: output });
    expect(result).toMatchObject({ ok: true });
    const pixels = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(1.1 / speed), '-i', output,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    // At source time 2.1 the stamp is centred at x=160; the old offset put it at x=120.
    expect(pixels[(98 * 320 + 160) * 3]).toBeGreaterThan(220);
    expect(pixels[(98 * 320 + 120) * 3]).toBeLessThan(20);

    fs.unlinkSync(output);
    const hidden = updateClipTiming({ ...original,
      focusMarkers: [{ ...original.focusMarkers[0]!, in: 0, out: 0.5 }] }, { in: 1, out: 3 });
    expect(await exportClip({ runId: 'hidden', source, clip: hidden, outputPath: output })).toMatchObject({ ok: true });
    const hiddenPixels = execFileSync(ffmpeg, ['-v', 'error', '-ss', '0', '-i', output,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    expect(hiddenPixels[(98 * 320 + 120) * 3]).toBeLessThan(20);
  } finally {
    for (const file of [input, output]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});
