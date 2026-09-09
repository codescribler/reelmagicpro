import { markerForDisplay } from '../../src/shared/pitchMarker';
import type { FocusMarker } from '../../src/shared/types';
import { parseAndClampProject } from '../../src/main/project/schema';
import { serializeProject } from '../../src/main/project/io';
import { smoothMarkerPath } from '../../src/shared/smoothMarkerPath';

const marker: FocusMarker = {
  id: 'm', x: 100, y: 200, width: 100, height: 160,
  in: 0, out: 2, color: 'cyan', shape: 'pitch',
};

test('pitch ring is flat and centred at the bottom of the player area', () => {
  const ring = markerForDisplay(marker);
  expect(ring.x + ring.width / 2).toBe(150);
  expect(ring.y + ring.height / 2).toBe(360);
  expect(ring.height / ring.width).toBeCloseTo(0.3);
});

test('moves the rendered ring to the feet without changing the recorded track', () => {
  const path = [{ t: 0, cx: 150, cy: 280 }, { t: 2, cx: 300, cy: 350 }];
  const tracked = { ...marker, path };
  expect(markerForDisplay(tracked).path).toEqual([
    { t: 0, cx: 150, cy: 360 }, { t: 2, cx: 300, cy: 430 },
  ]);
  expect(tracked.path[0]!.cy).toBe(280);
  expect(markerForDisplay({ ...tracked, shape: 'rect' }).path).toBe(path);
});

test('pitch style survives project save and reload', () => {
  const { project } = parseAndClampProject({
    version: 1,
    sourceVideo: { path: 'match.mp4', width: 1920, height: 1080, duration: 5, fps: 30 },
    clips: [{ id: 'c', name: 'Clip', in: 0, out: 2, speed: 1,
      zoom: { x: 0, y: 0, width: 1920, height: 1080 },
      focusMarkers: [{ ...marker, pitchOffsetX: -12, pitchOffsetY: 25, smoothing: 0.5, pitchOpacity: 0.2 }] }],
    sequence: [],
  });
  const reloaded = parseAndClampProject(serializeProject(project)).project;
  expect(reloaded.clips[0]!.focusMarkers[0]!.shape).toBe('pitch');
  expect(reloaded.clips[0]!.focusMarkers[0]).toMatchObject({ pitchOffsetX: -12, pitchOffsetY: 25, smoothing: 0.5, pitchOpacity: 0.2 });
});

test('position adjustments apply equally to static and tracked circles', () => {
  const adjusted = { ...marker, pitchOffsetX: -12, pitchOffsetY: 25 };
  const ring = markerForDisplay(adjusted);
  const tracked = markerForDisplay({ ...adjusted, path: [{ t: 0, cx: 150, cy: 280 }] });
  expect(tracked.path![0]).toEqual({ t: 0, cx: ring.x + ring.width / 2, cy: ring.y + ring.height / 2 });
  expect(tracked.path![0]).toMatchObject({ cx: 138, cy: 385 });
});

test('smoothing reduces a jerk, preserves endpoints and is reversible', () => {
  const path = Array.from({ length: 11 }, (_, i) => ({ t: i / 10, cx: i * 10, cy: i === 5 ? 100 : 0 }));
  const smoothed = smoothMarkerPath(path, 0.5);
  expect(smoothed[5]!.cy).toBeLessThan(60);
  expect(smoothed[5]!.cx).toBeCloseTo(50);
  expect(smoothed[0]).toEqual(path[0]);
  expect(smoothed[10]).toEqual(path[10]);
  expect(smoothed.map(p => p.t)).toEqual(path.map(p => p.t));
  expect(smoothMarkerPath(path, 0)).toBe(path);
  expect(path[5]!.cy).toBe(100);
  expect(markerForDisplay({ ...marker, shape: 'rect', path, smoothing: 0.5 }).path).toEqual(smoothed);
});
