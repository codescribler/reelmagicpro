import { parseAndClampProject } from '../../src/main/project/schema';

const baseSource = { path: 'X', duration: 100, width: 1920, height: 1080, fps: 30 };
const baseClip = {
  id: 'c1', name: 'A', in: 10, out: 20, speed: 1.0,
  zoom: { x: 0, y: 0, width: 1920, height: 1080 },
};
const baseProject = { version: 1, sourceVideo: baseSource, clips: [baseClip], sequence: [{ clipId: 'c1' }] };

test('round-trips a valid project', () => {
  const r = parseAndClampProject(baseProject);
  expect(r.project).toEqual(baseProject);
  expect(r.warnings).toEqual([]);
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
