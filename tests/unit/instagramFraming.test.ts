import type { Clip, SourceMeta } from '../../src/shared/types';
import { computeReelFraming } from '../../src/shared/instagramFraming';

const source: SourceMeta = { path: '/v.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };

function clip(extra: Partial<Clip>): Clip {
  return {
    id: 'c1', name: 'A', in: 0, out: 4, speed: 1,
    zoom: { x: 0, y: 0, width: 1920, height: 1080 },
    focusMarkers: [],
    ...extra,
  };
}

test('un-framed clip is a static centred square slice (full height)', () => {
  const { samples } = computeReelFraming(clip({}), source);
  expect(samples.length).toBe(2);
  // cropSide = min(1080,1920) = 1080; centred cx = 1920/2 = 960; cy = 540.
  for (const s of samples) {
    expect(s.w).toBe(1080);
    expect(s.h).toBe(1080);
    expect(s.cx).toBe(960);
    expect(s.cy).toBe(540);
  }
  expect(samples[0]!.t).toBe(0);
  expect(samples[samples.length - 1]!.t).toBe(4);
});

test('panPath drives horizontal centre, vertical stays centred, size stays square', () => {
  const c = clip({ reelFraming: { panPath: [{ t: 0, cx: 600 }, { t: 4, cx: 1300 }] } });
  const { samples } = computeReelFraming(c, source);
  expect(samples[0]!.cx).toBeCloseTo(600, 0);
  expect(samples[samples.length - 1]!.cx).toBeCloseTo(1300, 0);
  for (const s of samples) {
    expect(s.cy).toBe(540);
    expect(s.w).toBe(1080);
    expect(s.h).toBe(1080);
  }
});

test('cx is clamped so the square slice stays inside the source', () => {
  // cropSide=1080 → valid cx range is [540, 1380]. Out-of-range values clamp.
  const c = clip({ reelFraming: { panPath: [{ t: 0, cx: 0 }, { t: 4, cx: 99999 }] } });
  const { samples } = computeReelFraming(c, source);
  for (const s of samples) {
    expect(s.cx).toBeGreaterThanOrEqual(540);
    expect(s.cx).toBeLessThanOrEqual(1380);
  }
});
