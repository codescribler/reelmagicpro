import path from 'path';
import fs from 'fs';
import os from 'os';
import { exportClip } from '../../src/main/ffmpeg/exporter';
import { probeVideo } from '../../src/main/ffmpeg/probe';
import { INSTAGRAM_REEL_WIDTH, INSTAGRAM_REEL_HEIGHT } from '../../src/shared/instagramFormat';

jest.setTimeout(120000);

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'test-pattern.mp4');

test('exportClip in instagram format produces a 1080x1920 file', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-ig-${Date.now()}.mp4`);
  const r = await exportClip({
    runId: 'tig1',
    clip: {
      id: 'c1', name: 'A', in: 1, out: 3, speed: 1,
      zoom: { x: 0, y: 0, width: source.width, height: source.height },
      focusMarkers: [{
        id: 'm1', x: 40, y: 40, width: 80, height: 80,
        in: 1, out: 3, color: 'yellow',
        path: [
          { t: 0, cx: source.width * 0.3, cy: source.height * 0.5 },
          { t: 2, cx: source.width * 0.7, cy: source.height * 0.5 },
        ],
      }],
    },
    source,
    outputPath: out,
    format: 'instagram',
  });
  expect(r.ok).toBe(true);
  expect(fs.existsSync(out)).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(INSTAGRAM_REEL_WIDTH);
  expect(probed.height).toBe(INSTAGRAM_REEL_HEIGHT);
  expect(probed.duration).toBeGreaterThan(1.5);
  expect(probed.duration).toBeLessThan(2.5);
  fs.unlinkSync(out);
});

test('exportClip in instagram format with no reelFraming uses centred fallback', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-ig-fb-${Date.now()}.mp4`);
  const r = await exportClip({
    runId: 'tig2',
    clip: {
      id: 'c1', name: 'A', in: 1, out: 3, speed: 1,
      zoom: { x: 0, y: 0, width: source.width, height: source.height },
      focusMarkers: [],
    },
    source,
    outputPath: out,
    format: 'instagram',
  });
  expect(r.ok).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(INSTAGRAM_REEL_WIDTH);
  expect(probed.height).toBe(INSTAGRAM_REEL_HEIGHT);
  fs.unlinkSync(out);
});

test('exportClip in instagram format with a reelFraming pan path produces 1080x1920', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-ig-pan-${Date.now()}.mp4`);
  const side = Math.min(source.width, source.height);
  const r = await exportClip({
    runId: 'tig-pan',
    clip: {
      id: 'c1', name: 'A', in: 1, out: 3, speed: 1,
      zoom: { x: 0, y: 0, width: source.width, height: source.height },
      focusMarkers: [],
      reelFraming: { panPath: [
        { t: 0, cx: side / 2 },
        { t: 2, cx: source.width - side / 2 },
      ] },
    },
    source,
    outputPath: out,
    format: 'instagram',
  });
  expect(r.ok).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(INSTAGRAM_REEL_WIDTH);
  expect(probed.height).toBe(INSTAGRAM_REEL_HEIGHT);
  fs.unlinkSync(out);
});

test('exportClip in instagram format falls back to standard outro letterboxed when IG outro file is missing', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-ig-missingoutro-${Date.now()}.mp4`);
  const r = await exportClip({
    runId: 'tig3',
    clip: {
      id: 'c1', name: 'A', in: 1, out: 2, speed: 1,
      zoom: { x: 0, y: 0, width: source.width, height: source.height },
      focusMarkers: [],
    },
    source,
    outputPath: out,
    format: 'instagram',
    outro: { path: FIXTURE },
    instagramOutroPath: '/path/that/does/not/exist.mp4',
  });
  expect(r.ok).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(INSTAGRAM_REEL_WIDTH);
  expect(probed.height).toBe(INSTAGRAM_REEL_HEIGHT);
  // 1s clip + ~5s fixture used as outro.
  expect(probed.duration).toBeGreaterThan(1);
  fs.unlinkSync(out);
});
