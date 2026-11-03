import { cameraAt, cameraCrop, easeCamera, pointerTarget, wheelZoom, normalizeZoomPath } from '../../src/shared/dynamicZoom';
import { parseAndClampProject } from '../../src/main/project/schema';
import { useProjectStore } from '../../src/renderer/state/projectStore';

const source = { path: '/match.mp4', width: 1000, height: 600, fps: 30, duration: 60 };
const wide = { cx: 500, cy: 300, zoom: 1 };

test('wheel zoom supports mouse and trackpad deltas and returns to full frame', () => {
  expect(wheelZoom(1, -100, 0)).toBeGreaterThan(1);
  expect(wheelZoom(2, 10000, 0)).toBe(1);
  expect(wheelZoom(6, -100, 0)).toBe(6);
  expect(wheelZoom(2, 3, 1)).toBeCloseTo(wheelZoom(2, 48, 0));
});

test('camera easing is independent of sampling frequency without overshooting', () => {
  const target = { cx: 700, cy: 400, zoom: 3 };
  const once = easeCamera(wide, target, 0.2, source);
  const twice = easeCamera(easeCamera(wide, target, 0.1, source), target, 0.1, source);
  expect(once.zoom).toBeCloseTo(twice.zoom);
  expect(once.cx).toBeCloseTo(twice.cx);
  expect(once.zoom).toBeGreaterThan(1);
  expect(once.zoom).toBeLessThan(3);
});

test('crop preserves aspect ratio at source edges and full zoom-out restores context', () => {
  expect(cameraCrop({ cx: 999, cy: 1, zoom: 2 }, source)).toEqual({ x: 500, y: 0, width: 500, height: 300 });
  expect(cameraCrop({ cx: 999, cy: 1, zoom: 1 }, source)).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
  expect(pointerTarget({ cx: 500, cy: 300, zoom: 2 }, 0.75, 0.5, source)).toEqual({ cx: 625, cy: 300 });
});

test('recorded camera holds endpoints and interpolates the already smoothed path', () => {
  const path = [{ t: 0, ...wide }, { t: 2, cx: 750, cy: 300, zoom: 2 }];
  expect(cameraAt(path, -1)).toMatchObject(wide);
  expect(cameraAt(path, 1)).toMatchObject({ cx: 625, cy: 300, zoom: 1.5 });
  expect(cameraAt(path, 20)?.zoom).toBe(2);
  expect(cameraAt([], 0)).toBeUndefined();
});

test('saved paths are sorted, deduplicated and clamped to the clip and its own source', () => {
  const path = normalizeZoomPath([
    { t: 3, cx: 5000, cy: -200, zoom: 20 },
    { t: 0, ...wide }, { t: 0, cx: 500, cy: 300, zoom: 2 },
  ], source, 2);
  expect(path.map(p => p.t)).toEqual([0, 2]);
  expect(path[0]?.zoom).toBe(2);
  expect(path[1]?.zoom).toBe(6);
  const raw = { version: 1, sourceVideo: source, clips: [{
    id: 'a', name: 'A', in: 10, out: 12, speed: 0.5,
    zoom: { x: 0, y: 0, width: 1000, height: 600 }, focusMarkers: [], zoomPath: path,
  }], sequence: [] };
  const restored = parseAndClampProject(JSON.parse(JSON.stringify(raw))).project.clips[0]!;
  expect(restored.zoomPath).toEqual(path);
});

test.each(['update', 'nudge'])('changing clip start via %s keeps zoom aligned to the original action', method => {
  const project = parseAndClampProject({ version: 1, sourceVideo: source, clips: [{
    id: 'a', name: 'A', in: 10, out: 14, speed: 1, focusMarkers: [],
    zoom: { x: 0, y: 0, width: 1000, height: 600 },
    zoomPath: [{ t: 0, ...wide }, { t: 4, cx: 600, cy: 300, zoom: 3 }],
  }], sequence: [] }).project;
  useProjectStore.getState().setProject(project);
  if (method === 'update') useProjectStore.getState().updateClip('a', { in: 11 });
  else useProjectStore.getState().nudgeClipBoundary('a', 'in', 1);
  const path = useProjectStore.getState().project!.clips[0]!.zoomPath!;
  expect(cameraAt(path, 0)?.zoom).toBeCloseTo(1.5);
  expect(cameraAt(path, 1)?.zoom).toBeCloseTo(2);
  expect(path[path.length - 1]?.t).toBe(3);
});
