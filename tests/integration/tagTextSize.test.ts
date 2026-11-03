import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportClip } from '../../src/main/ffmpeg/exporter';
const ffmpeg = require('ffmpeg-static') as string;

jest.setTimeout(60000);

test.each([false, true])('smaller tag text renders fewer pixels (dynamic zoom=%s)', async dynamic => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-tag-text-'));
  const input = path.join(dir, 'input.mp4');
  const outputs = [path.join(dir, 'full.mp4'), path.join(dir, 'small.mp4')];
  try {
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=1', input]);
    const counts: number[] = [];
    for (const [index, labelScale] of [1, 0.25].entries()) {
      const result = await exportClip({ runId: 'tag-text', outputPath: outputs[index]!,
        source: { path: input, width: 320, height: 240, duration: 1, fps: 30 },
        clip: { id: 'c', name: 'Text size', in: 0, out: 1, speed: 1,
          zoom: { x: 0, y: 0, width: 320, height: 240 },
          zoomPath: dynamic ? [{ t: 0, cx: 160, cy: 110, zoom: 4 }] : undefined,
          focusMarkers: [{ id: 'm', x: 150, y: 90, width: 20, height: 20,
            in: 0, out: 1, color: 'white', label: 'PLAYER 7', labelScale }],
        },
      });
      expect(result).toMatchObject({ ok: true });
      const pixels = execFileSync(ffmpeg, ['-v', 'error', '-ss', '0.4', '-i', outputs[index]!,
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      let count = 0;
      // Only the caption area: exclude the marker and the brand watermark.
      for (let y = dynamic ? 124 : 111; y < 240; y++) {
        // Tiny antialiased glyphs contain grey pixels rather than pure white.
        for (let x = 0; x < 320; x++) if (pixels[(y * 320 + x) * 3]! > 80) count++;
      }
      counts.push(count);
    }
    expect(counts[1]).toBeGreaterThan(0);
    expect(counts[1]!).toBeLessThan(counts[0]! * 0.4);
  } finally {
    for (const file of [input, ...outputs]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});
