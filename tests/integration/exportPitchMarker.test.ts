import path from 'path';
import fs from 'fs';
import os from 'os';
import { exportClip } from '../../src/main/ffmpeg/exporter';
import { probeVideo } from '../../src/main/ffmpeg/probe';

jest.setTimeout(60000);

test.each([
  ['standard', false], ['standard', true], ['instagram', false], ['instagram', true],
] as const)('exports a pitch marker with a label (%s, tracked: %s)', async (format, tracked) => {
  const source = await probeVideo(path.join(__dirname, '..', 'fixtures', 'test-pattern.mp4'));
  const out = path.join(os.tmpdir(), `rm-pitch-${Date.now()}-${tracked}.mp4`);
  try {
    const result = await exportClip({
      runId: 'pitch-test', source, outputPath: out, format,
      clip: {
        id: 'c', name: 'Pitch', in: 1, out: 2, speed: 1,
        zoom: { x: 0, y: 0, width: source.width, height: source.height },
        focusMarkers: [{
          id: 'm', x: 40, y: 40, width: 80, height: 80,
          in: 1, out: 2, color: 'cyan', shape: 'pitch', label: 'Player 7',
          pitchOffsetX: -5, pitchOffsetY: 12, smoothing: 0.5, pitchOpacity: 0.25,
          path: tracked ? [{ t: 0, cx: 80, cy: 80 }, { t: 0.25, cx: 95, cy: 110 }, { t: 0.5, cx: 100, cy: 90 }] : undefined,
        }],
      },
    });
    expect(result.ok).toBe(true);
    const metadata = await probeVideo(out);
    expect(metadata.duration).toBeGreaterThan(0.8);
    expect(metadata.width).toBe(format === 'instagram' ? 1080 : source.width);
    expect(metadata.height).toBe(format === 'instagram' ? 1920 : source.height);
  } finally {
    if (fs.existsSync(out)) fs.unlinkSync(out);
  }
});
