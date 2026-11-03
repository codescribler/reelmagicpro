import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportClip } from '../../src/main/ffmpeg/exporter';
import { probeVideo } from '../../src/main/ffmpeg/probe';
const ffmpeg = require('ffmpeg-static') as string;

jest.setTimeout(60000);

test.each([['standard', 1], ['standard', 0.5], ['instagram', 1]] as const)(
  '%s export follows camera zoom and pan at speed %s', async (format, speed) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-camera-'));
    const input = path.join(dir, 'input.mp4');
    const output = path.join(dir, 'output.mp4');
    try {
      // A white detail in the left half and a red detail in the right half.
      execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i',
        'color=c=black:s=320x240:r=30:d=3,drawbox=x=64:y=96:w=32:h=48:color=white:t=fill,drawbox=x=224:y=96:w=32:h=48:color=red:t=fill',
        '-pix_fmt', 'yuv420p', input]);
      const result = await exportClip({ runId: 'camera', format, outputPath: output,
        source: { path: input, width: 320, height: 240, fps: 30, duration: 3 },
        clip: { id: 'c', name: 'Test', in: 0.5, out: 2.5, speed,
          zoom: { x: 0, y: 0, width: 320, height: 240 }, focusMarkers: [],
          zoomPath: [
            { t: 0, cx: 160, cy: 120, zoom: 1 },
            { t: 0.5, cx: 80, cy: 120, zoom: 2 },
            { t: 1, cx: 80, cy: 120, zoom: 2 },
            { t: 1.25, cx: 240, cy: 120, zoom: 2 },
            { t: 1.65, cx: 240, cy: 120, zoom: 2 },
            { t: 1.9, cx: 160, cy: 120, zoom: 1 },
            { t: 2, cx: 160, cy: 120, zoom: 1 },
          ],
        },
      });
      expect(result).toMatchObject({ ok: true });
      const width = format === 'instagram' ? 1080 : 320;
      const height = format === 'instagram' ? 1920 : 240;
      const pixel = (t: number, offsetX = 0) => {
        const pixels = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(t / speed), '-i', output,
          '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: width * height * 4 });
        const x = width / 2 + offsetX;
        return [...pixels.subarray((height / 2 * width + x) * 3, (height / 2 * width + x) * 3 + 3)];
      };
      // Full-frame centre is black; zoomed left detail fills the centre and grows.
      expect(pixel(0)[0]).toBeLessThan(20);
      expect(pixel(0.75)[0]).toBeGreaterThan(220);
      expect(pixel(0.75, format === 'instagram' ? 100 : 24)[0]).toBeGreaterThan(220);
      const red = pixel(1.6);
      expect(red[0]).toBeGreaterThan(180);
      expect(red[1]).toBeLessThan(40);
      expect(pixel(1.95)[0]).toBeLessThan(20);
    } finally {
      for (const file of [input, output]) if (fs.existsSync(file)) fs.unlinkSync(file);
      fs.rmdirSync(dir);
    }
  },
);

test('camera export preserves variable-frame-rate duration', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-camera-vfr-'));
  const input = path.join(dir, 'input.mp4');
  const output = path.join(dir, 'output.mp4');
  try {
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=320x240:r=30:d=2',
      '-vf', "select='lt(t,1)+gte(t,1)*not(mod(n,2))'", '-fps_mode', 'vfr', input]);
    const source = await probeVideo(input);
    const result = await exportClip({ runId: 'vfr-camera', source, outputPath: output,
      clip: { id: 'c', name: 'VFR', in: 0, out: source.duration, speed: 1,
        zoom: { x: 0, y: 0, width: 320, height: 240 }, focusMarkers: [],
        zoomPath: [{ t: 0, cx: 160, cy: 120, zoom: 1 }, { t: 1.5, cx: 160, cy: 120, zoom: 2 }],
      },
    });
    expect(result.ok).toBe(true);
    const rendered = await probeVideo(output);
    expect(rendered.duration).toBeGreaterThan(source.duration - 0.1);
    expect(rendered.duration).toBeLessThan(source.duration + 0.1);
  } finally {
    for (const file of [input, output]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});
