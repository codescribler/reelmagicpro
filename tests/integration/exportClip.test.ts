import path from 'path';
import fs from 'fs';
import os from 'os';
import { exportClip } from '../../src/main/ffmpeg/exporter';
import { probeVideo } from '../../src/main/ffmpeg/probe';

jest.setTimeout(60000);

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'test-pattern.mp4');

test('exports a clip at full frame, 1x speed', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-${Date.now()}.mp4`);
  const r = await exportClip({
    runId: 't1',
    clip: { id: 'c1', name: 'A', in: 1, out: 3, speed: 1, zoom: { x: 0, y: 0, width: source.width, height: source.height }, focusMarkers: [] },
    source,
    outputPath: out,
  });
  expect(r.ok).toBe(true);
  expect(fs.existsSync(out)).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(source.width);
  expect(probed.height).toBe(source.height);
  expect(probed.duration).toBeGreaterThan(1.5);
  expect(probed.duration).toBeLessThan(2.5);
  fs.unlinkSync(out);
});

test('exports a half-speed clip with doubled duration', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-slow-${Date.now()}.mp4`);
  const r = await exportClip({
    runId: 't2',
    clip: { id: 'c1', name: 'A', in: 1, out: 3, speed: 0.5, zoom: { x: 0, y: 0, width: source.width, height: source.height }, focusMarkers: [] },
    source,
    outputPath: out,
  });
  expect(r.ok).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.duration).toBeGreaterThan(3.5);
  expect(probed.duration).toBeLessThan(4.5);
  fs.unlinkSync(out);
});

test('exports a zoomed clip at source resolution', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-zoom-${Date.now()}.mp4`);
  const r = await exportClip({
    runId: 't3',
    clip: { id: 'c1', name: 'A', in: 1, out: 2, speed: 1, zoom: { x: 40, y: 30, width: 160, height: 120 }, focusMarkers: [] },
    source,
    outputPath: out,
  });
  expect(r.ok).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(source.width);
  expect(probed.height).toBe(source.height);
  fs.unlinkSync(out);
});

test('exports a clip with a focus marker drawbox burned in', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-marker-${Date.now()}.mp4`);
  const r = await exportClip({
    runId: 't4',
    clip: {
      id: 'c1', name: 'A', in: 1, out: 3, speed: 1,
      zoom: { x: 0, y: 0, width: source.width, height: source.height },
      focusMarkers: [
        { id: 'm1', x: 40, y: 40, width: 80, height: 80, in: 1, out: 3, color: 'yellow' },
      ],
    },
    source,
    outputPath: out,
  });
  expect(r.ok).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(source.width);
  expect(probed.height).toBe(source.height);
  fs.unlinkSync(out);
});
