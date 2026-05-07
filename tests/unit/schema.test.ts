import { parseAndClampProject } from '../../src/main/project/schema';

const baseSource = { path: 'X', duration: 100, width: 1920, height: 1080, fps: 30 };
const baseClip = {
  id: 'c1', name: 'A', in: 10, out: 20, speed: 1.0,
  zoom: { x: 0, y: 0, width: 1920, height: 1080 },
};
const baseProject = { version: 1, sourceVideo: baseSource, clips: [baseClip], sequence: [{ clipId: 'c1' }] };

test('round-trips a valid project (focusMarkers default to [])', () => {
  const r = parseAndClampProject(baseProject);
  expect(r.project.clips[0]!.focusMarkers).toEqual([]);
  expect(r.warnings).toEqual([]);
});

test('clamps focus marker x/y/width/height to source frame', () => {
  const p = {
    ...baseProject,
    clips: [{
      ...baseClip,
      focusMarkers: [{ id: 'm1', x: -10, y: -5, width: 5000, height: 5000, in: 10, out: 20, color: 'yellow' }],
    }],
  };
  const r = parseAndClampProject(p);
  const m = r.project.clips[0]!.focusMarkers[0]!;
  expect(m.x).toBe(0);
  expect(m.y).toBe(0);
  expect(m.x + m.width).toBeLessThanOrEqual(1920);
  expect(m.y + m.height).toBeLessThanOrEqual(1080);
});

test('clamps focus marker in/out to clip range', () => {
  const p = {
    ...baseProject,
    clips: [{
      ...baseClip,
      focusMarkers: [{ id: 'm1', x: 100, y: 100, width: 80, height: 80, in: 5, out: 30, color: 'yellow' }],
    }],
  };
  const r = parseAndClampProject(p);
  const m = r.project.clips[0]!.focusMarkers[0]!;
  expect(m.in).toBe(10);
  expect(m.out).toBe(20);
});

test('clamps clip out beyond source duration', () => {
  const p = { ...baseProject, clips: [{ ...baseClip, out: 9999 }] };
  const r = parseAndClampProject(p);
  expect(r.project.clips[0]!.out).toBe(100);
  expect(r.warnings).toContain('Clip "A" out clamped to source duration.');
});

test('marks clip invalid when in >= out after clamp', () => {
  const p = { ...baseProject, clips: [{ ...baseClip, in: 200, out: 250 }] };
  const r = parseAndClampProject(p);
  expect(r.invalidClipIds).toContain('c1');
});

test('clamps zoom rect to source frame', () => {
  const p = {
    ...baseProject,
    clips: [{ ...baseClip, zoom: { x: -10, y: -10, width: 5000, height: 5000 } }],
  };
  const r = parseAndClampProject(p);
  expect(r.project.clips[0]!.zoom).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
});

test('clamps speed to [0.25, 4]', () => {
  const p1 = { ...baseProject, clips: [{ ...baseClip, speed: 0.1 }] };
  expect(parseAndClampProject(p1).project.clips[0]!.speed).toBe(0.25);
  const p2 = { ...baseProject, clips: [{ ...baseClip, speed: 100 }] };
  expect(parseAndClampProject(p2).project.clips[0]!.speed).toBe(4);
});

test('rejects unknown version', () => {
  const p = { ...baseProject, version: 99 };
  expect(() => parseAndClampProject(p)).toThrow();
});

test('rejects malformed input', () => {
  expect(() => parseAndClampProject({ foo: 'bar' })).toThrow();
});

test('FocusMarker primary flag round-trips through parseAndClampProject', () => {
  const p = {
    ...baseProject,
    clips: [{
      ...baseClip,
      focusMarkers: [
        { id: 'm1', x: 0, y: 0, width: 80, height: 80, in: 10, out: 20, color: 'yellow', primary: true },
        { id: 'm2', x: 0, y: 0, width: 80, height: 80, in: 10, out: 20, color: 'red' },
      ],
    }],
  };
  const r = parseAndClampProject(p);
  expect(r.project.clips[0]!.focusMarkers[0]!.primary).toBe(true);
  expect(r.project.clips[0]!.focusMarkers[1]!.primary).toBeUndefined();
});

test('FocusMarker without primary field still parses (backwards-compat)', () => {
  const p = {
    ...baseProject,
    clips: [{
      ...baseClip,
      focusMarkers: [{ id: 'm1', x: 0, y: 0, width: 80, height: 80, in: 10, out: 20, color: 'yellow' }],
    }],
  };
  expect(() => parseAndClampProject(p)).not.toThrow();
});
