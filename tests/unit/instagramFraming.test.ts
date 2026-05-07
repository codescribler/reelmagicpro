import { pickDrivingMarker, buildRawSeries } from '../../src/shared/instagramFraming';
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
