import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportClip } from '../../src/main/ffmpeg/exporter';
const ffmpeg = require('ffmpeg-static') as string;

jest.setTimeout(60000);

test.each(['standard', 'instagram'] as const)('%s burns a feathered white pitch area at 15%%', async format => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-pixels-'));
  const input = path.join(dir, 'green.mp4');
  const output = path.join(dir, 'export.mp4');
  try {
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x206020:s=320x240:r=30:d=1', '-pix_fmt', 'yuv420p', input]);
    const result = await exportClip({ runId: 'pixels', format, outputPath: output,
      source: { path: input, width: 320, height: 240, fps: 30, duration: 1 },
      clip: { id: 'c', name: 'Test', in: 0, out: 1, speed: 1,
        zoom: { x: 0, y: 0, width: 320, height: 240 },
        focusMarkers: [{ id: 'm', x: 120, y: 60, width: 80, height: 80,
          in: 0, out: 1, color: 'white', shape: 'pitch' }],
      },
    });
    expect(result.ok).toBe(true);
    const width = format === 'instagram' ? 1080 : 320;
    const height = format === 'instagram' ? 1920 : 240;
    const pixels = execFileSync(ffmpeg, ['-v', 'error', '-ss', '0.4', '-i', output,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: width * height * 4 });
    const red = (x: number, y: number) => {
      const px = format === 'instagram' ? Math.round((x - 40) * 4.5) : x;
      const py = format === 'instagram' ? Math.round(420 + y * 4.5) : y;
      return pixels[(py * width + px) * 3]!;
    };
    const outside = red(210, 140);
    const centre = red(160, 140);
    const edge = red(194, 140);
    // White at 15% over green adds about 33 red levels, not an opaque ring.
    expect(centre - outside).toBeGreaterThan(23);
    expect(centre - outside).toBeLessThan(43);
    expect(edge).toBeGreaterThan(outside + 3);
    expect(edge).toBeLessThan(centre - 3);
    expect(Math.abs(red(160, 110) - outside)).toBeLessThan(5);
  } finally {
    for (const file of [input, output]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});
