import { parseAndClampProject } from '../../src/main/project/schema';
import { serializeProject } from '../../src/main/project/io';

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

test('v1 load: synthesises a sources array from sourceVideo with a stable id', () => {
  const r = parseAndClampProject(baseProject);
  expect(r.project.sources).toHaveLength(1);
  expect(r.project.sources[0]!.path).toBe('X');
  expect(r.project.sources[0]!.duration).toBe(100);
  expect(r.project.sources[0]!.id).toMatch(/^src_/);
  // Primary mirror points at sources[0] so existing `project.sourceVideo`
  // read sites continue to compile.
  expect(r.project.sourceVideo).toEqual({ ...baseSource });
});

test('v1 round-trip: a single-source project saves back as v1 (no sources field)', () => {
  // Critical for back-compat: existing users' .rmproj files must survive a
  // round-trip through the new code without gaining unfamiliar fields.
  const r = parseAndClampProject(baseProject);
  const serialized = serializeProject(r.project) as any;
  expect(serialized.version).toBe(1);
  expect(serialized.sources).toBeUndefined();
  expect(serialized.sourceVideo).toEqual(baseSource);
  // Clips don't carry sourceId on disk in the v1 shape.
  expect(serialized.clips[0].sourceId).toBeUndefined();
});

test('v2 load: project with multiple sources parses and exposes both shapes', () => {
  const v2 = {
    version: 2,
    sources: [
      { id: 'src_a', path: 'A.mp4', duration: 60, width: 1920, height: 1080, fps: 30 },
      { id: 'src_b', path: 'B.mp4', duration: 90, width: 1280, height: 720, fps: 25, name: 'Match 2' },
    ],
    clips: [
      { ...baseClip, id: 'c1', sourceId: 'src_a' },
      { ...baseClip, id: 'c2', sourceId: 'src_b', zoom: { x: 0, y: 0, width: 1280, height: 720 } },
    ],
    sequence: [{ clipId: 'c1' }, { clipId: 'c2' }],
    bookmarks: [
      { id: 'b1', time: 30, createdAt: 1, sourceId: 'src_a' },
      { id: 'b2', time: 45, createdAt: 2, sourceId: 'src_b' },
    ],
  };
  const r = parseAndClampProject(v2);
  expect(r.project.sources).toHaveLength(2);
  expect(r.project.sources[1]!.name).toBe('Match 2');
  expect(r.project.clips[0]!.sourceId).toBe('src_a');
  expect(r.project.clips[1]!.sourceId).toBe('src_b');
  expect(r.project.bookmarks).toHaveLength(2);
});

test('v2 round-trip: a multi-source project saves back as v2 (no legacy sourceVideo field)', () => {
  const v2 = {
    version: 2,
    sources: [
      { id: 'src_a', path: 'A.mp4', duration: 60, width: 1920, height: 1080, fps: 30 },
      { id: 'src_b', path: 'B.mp4', duration: 90, width: 1280, height: 720, fps: 25 },
    ],
    clips: [{ ...baseClip, sourceId: 'src_b', zoom: { x: 0, y: 0, width: 1280, height: 720 } }],
    sequence: [],
  };
  const r = parseAndClampProject(v2);
  const serialized = serializeProject(r.project) as any;
  expect(serialized.version).toBe(2);
  expect(serialized.sourceVideo).toBeUndefined();
  expect(serialized.sources).toHaveLength(2);
  expect(serialized.clips[0].sourceId).toBe('src_b');
});

test('per-source clamping: a clip in source B respects B\'s duration, not the primary\'s', () => {
  // Source A is 60s; source B is 90s. A clip whose out is 80 (valid for B,
  // would be invalid against A) must clamp against its OWN source — the
  // legacy single-source clamping would wrongly trim it to 60.
  const v2 = {
    version: 2,
    sources: [
      { id: 'src_a', path: 'A.mp4', duration: 60, width: 1920, height: 1080, fps: 30 },
      { id: 'src_b', path: 'B.mp4', duration: 90, width: 1280, height: 720, fps: 25 },
    ],
    clips: [{
      ...baseClip,
      sourceId: 'src_b',
      in: 5, out: 80,
      zoom: { x: 0, y: 0, width: 1280, height: 720 },
    }],
    sequence: [],
  };
  const r = parseAndClampProject(v2);
  expect(r.project.clips[0]!.out).toBe(80);
  expect(r.warnings).toEqual([]);
});

test('a clip with a sourceId that points to a missing source is flagged invalid', () => {
  const v2 = {
    version: 2,
    sources: [{ id: 'src_a', path: 'A.mp4', duration: 60, width: 1920, height: 1080, fps: 30 }],
    clips: [{ ...baseClip, sourceId: 'src_ghost', out: 30 }],
    sequence: [],
  };
  const r = parseAndClampProject(v2);
  expect(r.invalidClipIds).toContain('c1');
  expect(r.warnings[0]).toMatch(/missing source/);
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

test('parseAndClampProject round-trips reelFraming.panPath', () => {
  const raw = {
    version: 1,
    sourceVideo: { path: '/v.mp4', duration: 100, width: 1920, height: 1080, fps: 30 },
    clips: [{
      id: 'c1', name: 'A', in: 1, out: 5, speed: 1,
      zoom: { x: 0, y: 0, width: 1920, height: 1080 },
      focusMarkers: [],
      reelFraming: { panPath: [{ t: 0, cx: 600 }, { t: 4, cx: 1300 }] },
    }],
    sequence: [],
    bookmarks: [],
  };
  const { project } = parseAndClampProject(raw);
  expect(project.clips[0]!.reelFraming?.panPath).toEqual([
    { t: 0, cx: 600 }, { t: 4, cx: 1300 },
  ]);
});

test('parseAndClampProject loads a clip with no reelFraming as undefined', () => {
  const raw = {
    version: 1,
    sourceVideo: { path: '/v.mp4', duration: 100, width: 1920, height: 1080, fps: 30 },
    clips: [{
      id: 'c1', name: 'A', in: 1, out: 5, speed: 1,
      zoom: { x: 0, y: 0, width: 1920, height: 1080 },
      focusMarkers: [],
    }],
    sequence: [],
    bookmarks: [],
  };
  const { project } = parseAndClampProject(raw);
  expect(project.clips[0]!.reelFraming).toBeUndefined();
});
