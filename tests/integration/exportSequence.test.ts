import path from 'path';
import fs from 'fs';
import os from 'os';
import { exportSequence } from '../../src/main/ffmpeg/exporter';
import { probeVideo } from '../../src/main/ffmpeg/probe';

jest.setTimeout(60000);

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'test-pattern.mp4');

test('exports a sequence concatenating two clips', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-seq-${Date.now()}.mp4`);
  const clips = [
    { id: 'c1', name: 'A', in: 0, out: 2, speed: 1, zoom: { x: 0, y: 0, width: source.width, height: source.height }, focusMarkers: [] },
    { id: 'c2', name: 'B', in: 2, out: 4, speed: 0.5, zoom: { x: 0, y: 0, width: source.width, height: source.height }, focusMarkers: [] },
  ];
  const r = await exportSequence({
    runId: 's1',
    clips,
    sequence: [{ clipId: 'c1' }, { clipId: 'c2' }],
    sources: [{ id: 'src_a', ...source }],
    outputPath: out,
  });
  expect(r.ok).toBe(true);
  const probed = await probeVideo(out);
  // c1 is 2s, c2 at 0.5x is 4s, total ~6s
  expect(probed.duration).toBeGreaterThan(5);
  expect(probed.duration).toBeLessThan(7);
  expect(probed.width).toBe(source.width);
  fs.unlinkSync(out);
});
