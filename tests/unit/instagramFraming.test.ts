import { pickDrivingMarker, buildRawSeries, gaussianSmoothSeries, clampSeriesToSource } from '../../src/shared/instagramFraming';
import type { IgFramingSample } from '../../src/shared/instagramFraming';
import type { Clip, FocusMarker, SourceMeta } from '../../src/shared/types';

const SRC: SourceMeta = { path: '/in.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };
const FRAMING_OPTS = { defaultZoomFraction: 0.7, paddingFactor: 2.5, minHeightFraction: 0.30, smoothingSigmaSeconds: 0.5, targetAspect: 9 / 16 };

function clipWith(markers: FocusMarker[]): Clip {
  return {
    id: 'c1', name: 'A', in: 0, out: 5, speed: 1,
    zoom: { x: 0, y: 0, width: 1920, height: 1080 },
    focusMarkers: markers,
  };
}

const m = (id: string, primary?: boolean): FocusMarker => ({
  id, x: 0, y: 0, width: 80, height: 80, in: 0, out: 5, color: 'yellow',
  ...(primary ? { primary: true } : {}),
});

test('pickDrivingMarker returns null when no markers', () => {
  expect(pickDrivingMarker(clipWith([]))).toBeNull();
});

test('pickDrivingMarker returns the explicit primary marker when one is flagged', () => {
  const driver = pickDrivingMarker(clipWith([m('m1'), m('m2', true), m('m3')]));
  expect(driver?.id).toBe('m2');
});

test('pickDrivingMarker falls back to the first marker when none are primary', () => {
  const driver = pickDrivingMarker(clipWith([m('m1'), m('m2')]));
  expect(driver?.id).toBe('m1');
});

test('pickDrivingMarker takes the first primary if multiple are flagged', () => {
  const driver = pickDrivingMarker(clipWith([m('m1', true), m('m2', true)]));
  expect(driver?.id).toBe('m1');
});

test('buildRawSeries with no markers uses focus-box centre and default zoom', () => {
  const clip = clipWith([]);
  const samples = buildRawSeries(clip, SRC, FRAMING_OPTS);
  expect(samples).toHaveLength(2);
  expect(samples[0]!.cx).toBeCloseTo(960);
  expect(samples[0]!.cy).toBeCloseTo(540);
  expect(samples[0]!.h).toBeCloseTo(756);
  expect(samples[0]!.w).toBeCloseTo(425.25, 1);
  expect(samples[1]!.t).toBeCloseTo(5);
});

test('buildRawSeries with static marker uses marker centre and padded size', () => {
  const marker: FocusMarker = {
    id: 'm1', x: 800, y: 400, width: 200, height: 200, in: 0, out: 5, color: 'yellow',
  };
  const samples = buildRawSeries(clipWith([marker]), SRC, FRAMING_OPTS);
  expect(samples).toHaveLength(2);
  expect(samples[0]!.cx).toBeCloseTo(900);
  expect(samples[0]!.cy).toBeCloseTo(500);
  expect(samples[0]!.h).toBeCloseTo(500);
  expect(samples[0]!.w).toBeCloseTo(500 * 9 / 16, 1);
});

test('buildRawSeries with tracked marker samples the path', () => {
  const marker: FocusMarker = {
    id: 'm1', x: 0, y: 0, width: 100, height: 100, in: 0, out: 5, color: 'yellow',
    path: [
      { t: 0, cx: 200, cy: 200 },
      { t: 5, cx: 800, cy: 600 },
    ],
  };
  const samples = buildRawSeries(clipWith([marker]), SRC, FRAMING_OPTS);
  expect(samples.length).toBeGreaterThanOrEqual(2);
  expect(samples[0]!.cx).toBeCloseTo(200);
  expect(samples[0]!.cy).toBeCloseTo(200);
  expect(samples[samples.length - 1]!.cx).toBeCloseTo(800);
  expect(samples[samples.length - 1]!.cy).toBeCloseTo(600);
});

test('buildRawSeries clamps tiny markers up to minHeightFraction', () => {
  const marker: FocusMarker = {
    id: 'm1', x: 800, y: 400, width: 30, height: 30, in: 0, out: 5, color: 'yellow',
  };
  const samples = buildRawSeries(clipWith([marker]), SRC, FRAMING_OPTS);
  expect(samples[0]!.h).toBeCloseTo(324);
});

test('buildRawSeries clamps oversized markers down to source height', () => {
  const marker: FocusMarker = {
    id: 'm1', x: 0, y: 0, width: 1500, height: 1500, in: 0, out: 5, color: 'yellow',
  };
  const samples = buildRawSeries(clipWith([marker]), SRC, FRAMING_OPTS);
  expect(samples[0]!.h).toBeCloseTo(1080);
});

test('gaussianSmoothSeries leaves a constant series unchanged', () => {
  const input: IgFramingSample[] = [
    { t: 0, cx: 100, cy: 200, w: 540, h: 960 },
    { t: 1, cx: 100, cy: 200, w: 540, h: 960 },
    { t: 2, cx: 100, cy: 200, w: 540, h: 960 },
  ];
  const out = gaussianSmoothSeries(input, 0.5);
  expect(out.length).toBe(input.length);
  for (let i = 0; i < input.length; i++) {
    expect(out[i]!.cx).toBeCloseTo(100);
    expect(out[i]!.cy).toBeCloseTo(200);
  }
});

test('gaussianSmoothSeries softens a step', () => {
  const input: IgFramingSample[] = [
    { t: 0, cx: 0,    cy: 0, w: 540, h: 960 },
    { t: 1, cx: 0,    cy: 0, w: 540, h: 960 },
    { t: 2, cx: 1000, cy: 0, w: 540, h: 960 },
    { t: 3, cx: 1000, cy: 0, w: 540, h: 960 },
    { t: 4, cx: 1000, cy: 0, w: 540, h: 960 },
  ];
  const out = gaussianSmoothSeries(input, 0.5);
  expect(out[0]!.cx).toBeLessThan(50);
  expect(out[4]!.cx).toBeGreaterThan(950);
  expect(out[2]!.cx).toBeGreaterThan(50);
  expect(out[2]!.cx).toBeLessThan(950);
});

test('gaussianSmoothSeries with sigma=0 returns the input unchanged', () => {
  const input: IgFramingSample[] = [
    { t: 0, cx: 100, cy: 200, w: 540, h: 960 },
    { t: 1, cx: 800, cy: 400, w: 540, h: 960 },
  ];
  const out = gaussianSmoothSeries(input, 0);
  expect(out[0]!.cx).toBeCloseTo(100);
  expect(out[1]!.cx).toBeCloseTo(800);
});

test('gaussianSmoothSeries handles 0/1 sample inputs without NaN', () => {
  expect(gaussianSmoothSeries([], 0.5)).toEqual([]);
  const single: IgFramingSample[] = [{ t: 0, cx: 100, cy: 200, w: 540, h: 960 }];
  const out = gaussianSmoothSeries(single, 0.5);
  expect(out).toHaveLength(1);
  expect(Number.isFinite(out[0]!.cx)).toBe(true);
});

test('clampSeriesToSource leaves an in-bounds sample unchanged', () => {
  const input: IgFramingSample[] = [
    { t: 0, cx: 960, cy: 540, w: 540, h: 960 },
  ];
  const out = clampSeriesToSource(input, SRC);
  expect(out[0]!.cx).toBe(960);
  expect(out[0]!.cy).toBe(540);
});

test('clampSeriesToSource pulls a left-edge centre to keep the rect inside', () => {
  const input: IgFramingSample[] = [{ t: 0, cx: 100, cy: 540, w: 540, h: 960 }];
  const out = clampSeriesToSource(input, SRC);
  expect(out[0]!.cx).toBe(270);
});

test('clampSeriesToSource pulls a right-edge centre back', () => {
  const input: IgFramingSample[] = [{ t: 0, cx: 1900, cy: 540, w: 540, h: 960 }];
  const out = clampSeriesToSource(input, SRC);
  expect(out[0]!.cx).toBe(SRC.width - 270);
});

test('clampSeriesToSource shrinks rect that exceeds source bounds, preserving aspect', () => {
  const input: IgFramingSample[] = [{ t: 0, cx: 960, cy: 540, w: 1125, h: 2000 }];
  const out = clampSeriesToSource(input, SRC);
  expect(out[0]!.h).toBe(1080);
  expect(out[0]!.w).toBeCloseTo(1125 * (1080 / 2000), 3);
});
