import path from 'path';
import fs from 'fs';
import os from 'os';
import { exportSequence } from '../../src/main/ffmpeg/exporter';
import { probeVideo } from '../../src/main/ffmpeg/probe';
import { INSTAGRAM_REEL_WIDTH, INSTAGRAM_REEL_HEIGHT } from '../../src/shared/instagramFormat';

jest.setTimeout(180000);

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'test-pattern.mp4');

test('exportSequence in instagram format concatenates a tracked clip and an untracked clip', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-igseq-${Date.now()}.mp4`);
  const r = await exportSequence({
    runId: 'tigs1',
    clips: [
      {
        id: 'c1', name: 'tracked', in: 1, out: 2, speed: 1,
        zoom: { x: 0, y: 0, width: source.width, height: source.height },
        focusMarkers: [{
          id: 'm1', x: 40, y: 40, width: 80, height: 80, in: 1, out: 2, color: 'yellow',
          path: [
            { t: 0, cx: source.width * 0.4, cy: source.height * 0.5 },
            { t: 1, cx: source.width * 0.6, cy: source.height * 0.5 },
          ],
        }],
      },
      {
        id: 'c2', name: 'untracked', in: 1, out: 2, speed: 1,
        zoom: { x: 0, y: 0, width: source.width, height: source.height },
        focusMarkers: [],
      },
    ],
    sequence: [{ clipId: 'c1' }, { clipId: 'c2' }],
    source,
    outputPath: out,
    format: 'instagram',
  });
  expect(r.ok).toBe(true);
  expect(fs.existsSync(out)).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(INSTAGRAM_REEL_WIDTH);
  expect(probed.height).toBe(INSTAGRAM_REEL_HEIGHT);
  // ~2s total (1s + 1s).
  expect(probed.duration).toBeGreaterThan(1.5);
  expect(probed.duration).toBeLessThan(3);
  fs.unlinkSync(out);
});
