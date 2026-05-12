import path from 'path';
import fs from 'fs';
import os from 'os';
import { exportSequence } from '../../src/main/ffmpeg/exporter';
import { probeVideo } from '../../src/main/ffmpeg/probe';

jest.setTimeout(60000);

// Two synthetic fixtures at different dimensions so the test exercises the
// concat-stage scale-and-setsar normalisation that kicks in when clip parts
// come out at different sizes.
const FIXTURE_A = path.join(__dirname, '..', 'fixtures', 'test-pattern.mp4');
const FIXTURE_B = path.join(__dirname, '..', 'fixtures', 'test-pattern-b.mp4');

test('exports a sequence with clips drawn from two different source videos', async () => {
  const sourceA = await probeVideo(FIXTURE_A);
  const sourceB = await probeVideo(FIXTURE_B);
  const out = path.join(os.tmpdir(), `rm-seq-multi-${Date.now()}.mp4`);

  const clips = [
    // Clip from source A — no sourceId set ⇒ implicit primary.
    {
      id: 'c1', name: 'from A', in: 0, out: 1, speed: 1,
      zoom: { x: 0, y: 0, width: sourceA.width, height: sourceA.height },
      focusMarkers: [],
    },
    // Clip from source B — explicit sourceId.
    {
      id: 'c2', name: 'from B', in: 0, out: 1, speed: 1,
      zoom: { x: 0, y: 0, width: sourceB.width, height: sourceB.height },
      focusMarkers: [],
      sourceId: 'src_b',
    },
  ];

  const r = await exportSequence({
    runId: 'mseq1',
    clips,
    sequence: [{ clipId: 'c1' }, { clipId: 'c2' }],
    sources: [
      { id: 'src_a', ...sourceA },
      { id: 'src_b', ...sourceB },
    ],
    outputPath: out,
  });
  expect(r.ok).toBe(true);
  expect(fs.existsSync(out)).toBe(true);
  const probed = await probeVideo(out);
  // 1s + 1s = ~2s total.
  expect(probed.duration).toBeGreaterThan(1.5);
  expect(probed.duration).toBeLessThan(3);
  // Concat normalises to sources[0]'s dimensions (the primary), regardless
  // of which source each part came from.
  expect(probed.width).toBe(sourceA.width);
  expect(probed.height).toBe(sourceA.height);
  fs.unlinkSync(out);
});
