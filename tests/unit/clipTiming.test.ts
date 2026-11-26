import { useProjectStore } from '../../src/renderer/state/projectStore';
import { markerCentreAt } from '../../src/renderer/state/markerPosition';
import { cameraAt } from '../../src/shared/dynamicZoom';
import { buildRawSeries } from '../../src/shared/instagramFraming';
import { parseAndClampProject } from '../../src/main/project/schema';
import { serializeProject } from '../../src/main/project/io';
import type { Clip, Project } from '../../src/shared/types';

const state = () => useProjectStore.getState();
const project = () => state().project!;
const clip = () => project().clips.find(c => c.id === state().selectedClipId)!;

beforeEach(() => {
  const source = { id: 's1', path: '/match.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };
  const a: Clip = {
    id: 'a', name: 'Goal', in: 10, out: 30, speed: 0.5,
    zoom: { x: 0, y: 0, width: 1920, height: 1080 },
    focusMarkers: [{ id: 'player', in: 12, out: 28, x: 0, y: 0, width: 50, height: 50,
      color: 'yellow', primary: true, label: 'Danny',
      path: [{ t: 0, cx: 100, cy: 100 }, { t: 10, cx: 300, cy: 200 }, { t: 20, cx: 500, cy: 300 }] }],
    zoomPath: [{ t: 0, cx: 960, cy: 540, zoom: 1 }, { t: 20, cx: 600, cy: 540, zoom: 3 }],
    reelFraming: { panPath: [{ t: 0, cx: 600 }, { t: 10, cx: 800 }, { t: 20, cx: 1000 }] },
    backingTrack: { path: '/music.mp3', volume: 0.6, muteSource: true,
      videoMomentSec: 12, musicMomentSec: 20, offsetSec: -8 },
  };
  const p: Project = { version: 1, sourceVideo: source, sources: [source], bookmarks: [],
    clips: [a, { ...a, id: 'b', in: 40, out: 50, speed: 1, focusMarkers: [] }],
    sequence: [{ clipId: 'a' }, { clipId: 'b' }, { clipId: 'a' }] };
  state().setProject(p);
  state().selectClip('a');
});

test.each(['update', 'nudge'])('%s keeps tracking on the same source frames after trimming both ends', method => {
  const before = project();
  const snapshot = structuredClone(before);
  if (method === 'update') state().updateClip('a', { in: 15, out: 25 });
  else {
    state().nudgeClipBoundary('a', 'in', 5);
    state().nudgeClipBoundary('a', 'out', -5);
  }
  const c = clip();
  expect(c.focusMarkers[0]).toMatchObject({ in: 15, out: 25, primary: true, label: 'Danny' });
  // Source frame 18 remains at x=260/y=180, now three seconds into the clip.
  expect(markerCentreAt(c.focusMarkers[0]!, 3)).toEqual({ cx: 260, cy: 180 });
  expect(c.focusMarkers[0]!.path).toEqual([
    { t: 0, cx: 200, cy: 150 }, { t: 5, cx: 300, cy: 200 }, { t: 10, cx: 400, cy: 250 },
  ]);
  expect(c.reelFraming!.panPath).toEqual([{ t: 0, cx: 700 }, { t: 5, cx: 800 }, { t: 10, cx: 900 }]);
  expect(cameraAt(c.zoomPath!, 3)?.zoom).toBeCloseTo(1.8);
  expect(c.backingTrack).toMatchObject({ videoMomentSec: 2, musicMomentSec: 20, offsetSec: -18 });
  expect(before).toEqual(snapshot);
  expect(project().bookmarks).toEqual(before.bookmarks);
});

test.each(['update', 'nudge'])('%s extends the clip while holding recorded endpoints and delaying the original action', method => {
  if (method === 'update') state().updateClip('a', { in: 8, out: 32 });
  else {
    state().nudgeClipBoundary('a', 'in', -2);
    state().nudgeClipBoundary('a', 'out', 2);
  }
  const c = clip();
  expect(markerCentreAt(c.focusMarkers[0]!, 10)).toEqual({ cx: 260, cy: 180 });
  expect(c.focusMarkers[0]!.in).toBe(12);
  expect(c.focusMarkers[0]!.out).toBe(28);
  expect(c.focusMarkers[0]!.path!.map(p => p.t)).toEqual([0, 2, 12, 22, 24]);
  expect(c.reelFraming!.panPath).toEqual([
    { t: 0, cx: 600 }, { t: 2, cx: 600 }, { t: 12, cx: 800 }, { t: 22, cx: 1000 }, { t: 24, cx: 1000 },
  ]);
  expect(c.backingTrack).toMatchObject({ videoMomentSec: 16, offsetSec: -4 });
});

test('an out-only trim clips marker visibility and interpolates paths without shifting retained samples', () => {
  state().updateClip('a', { out: 23 });
  expect(clip().focusMarkers[0]!.out).toBe(23);
  expect(markerCentreAt(clip().focusMarkers[0]!, 8)).toEqual({ cx: 260, cy: 180 });
  expect(clip().reelFraming!.panPath).toEqual([{ t: 0, cx: 600 }, { t: 10, cx: 800 }, { t: 13, cx: 860 }]);
  expect(clip().backingTrack).toMatchObject({ videoMomentSec: 12, offsetSec: -8 });
});

test.each([{ in: 17 }, { out: 15 }])('removing the marked video frame clears its music marker (%j)', patch => {
  state().updateClip('a', patch);
  expect(clip().backingTrack!.videoMomentSec).toBeUndefined();
  expect(clip().backingTrack!.musicMomentSec).toBe(20);
});

test('trimming a sequence occurrence preserves other recordings and survives saving', () => {
  const original = structuredClone(project().clips[0]);
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().nudgeClipBoundary('a', 'in', 5);
  const copy = clip();
  expect(copy.id).not.toBe('a');
  expect(project().clips[0]).toEqual(original);
  expect(project().sequence[2]!.clipId).toBe('a');
  const restored = parseAndClampProject(JSON.parse(JSON.stringify(serializeProject(project())))).project;
  const saved = restored.clips.find(c => c.id === copy.id)!;
  expect(markerCentreAt(saved.focusMarkers[0]!, 3)).toEqual({ cx: 260, cy: 180 });
  expect(buildRawSeries(saved, restored.sourceVideo)[0]).toMatchObject({ t: 0, cx: 700 });
});

test('explicit replacement recordings in an update are already relative to the new boundaries', () => {
  state().updateClip('a', { in: 15,
    focusMarkers: [{ ...clip().focusMarkers[0]!, in: 15, path: [{ t: 0, cx: 222, cy: 333 }] }],
    reelFraming: { panPath: [{ t: 0, cx: 777 }] },
    zoomPath: [{ t: 0, cx: 900, cy: 500, zoom: 2 }],
    backingTrack: { ...clip().backingTrack!, offsetSec: 4, videoMomentSec: 6 } });
  expect(clip().focusMarkers[0]!.path).toEqual([{ t: 0, cx: 222, cy: 333 }]);
  expect(clip().reelFraming!.panPath).toEqual([{ t: 0, cx: 777 }]);
  expect(clip().zoomPath![0]!.zoom).toBe(2);
  expect(clip().backingTrack!.offsetSec).toBe(4);
});

test('sequence music follows a marked frame in a later clip when an earlier occurrence is trimmed', () => {
  state().setSequenceBackingTrack({ path: '/song.mp3', volume: 0.6, muteSource: true,
    videoMomentSec: 45, musicMomentSec: 20, offsetSec: 25 });
  state().createNamedSequence('Short version', true);
  const originalSequenceId = project().namedSequences![0]!.id;
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().nudgeClipBoundary('a', 'in', 2);
  expect(project().sequenceBackingTrack).toMatchObject({ videoMomentSec: 41, offsetSec: 21 });
  state().selectNamedSequence(originalSequenceId);
  expect(project().sequenceBackingTrack).toMatchObject({ videoMomentSec: 45, offsetSec: 25 });
  state().selectNamedSequence(project().namedSequences![1]!.id);
  expect(project().sequenceBackingTrack).toMatchObject({ videoMomentSec: 41, offsetSec: 21 });
});

test('reversing trims after saving restores the original tracking, framing and music', () => {
  const original = structuredClone(clip());
  state().updateClip('a', { in: 17, out: 23 });
  const restored = parseAndClampProject(JSON.parse(JSON.stringify(serializeProject(project())))).project;
  state().setProject(restored);
  state().selectClip('a');
  state().updateClip('a', { in: 10, out: 30 });
  expect(clip().focusMarkers[0]!.path).toEqual(original.focusMarkers[0]!.path);
  expect(clip().focusMarkers[0]).toMatchObject({ in: 12, out: 28 });
  expect(clip().reelFraming).toEqual(original.reelFraming);
  expect(clip().zoomPath).toEqual(original.zoomPath);
  expect(clip().backingTrack).toEqual(original.backingTrack);
});

test('a marker cut out of the clip stays hidden and returns when the boundary is restored', () => {
  state().updateFocusMarker('a', 'player', { in: 12, out: 14 });
  state().updateClip('a', { in: 15 });
  expect(clip().focusMarkers[0]!.in).toBe(clip().focusMarkers[0]!.out);
  state().setProject(parseAndClampProject(JSON.parse(JSON.stringify(serializeProject(project())))).project);
  state().selectClip('a');
  state().updateFocusMarker('a', 'player', { color: 'red' });
  state().nudgeClipBoundary('a', 'in', -5);
  expect(clip().focusMarkers[0]).toMatchObject({ in: 12, out: 14, color: 'red' });
  expect(markerCentreAt(clip().focusMarkers[0]!, 3)).toEqual({ cx: 160, cy: 130 });
});

test('editing a recording after a trim replaces its saved timing without resurrecting the old take', () => {
  state().updateClip('a', { in: 15 });
  state().updateFocusMarker('a', 'player', { in: 16, out: 22,
    path: [{ t: 1, cx: 555, cy: 444 }, { t: 7, cx: 777, cy: 666 }] });
  state().updateClip('a', { reelFraming: { panPath: [{ t: 0, cx: 777 }] }, zoomPath: undefined });
  state().updateClip('a', { in: 10 });
  expect(clip().focusMarkers[0]).toMatchObject({ in: 16, out: 22 });
  expect(markerCentreAt(clip().focusMarkers[0]!, 6)).toEqual({ cx: 555, cy: 444 });
  expect(clip().reelFraming!.panPath.every(p => p.cx === 777)).toBe(true);
  expect(clip().zoomPath).toBeUndefined();
});

test('sequence music still shifts when trimming removes its marked frame', () => {
  state().clearSequence();
  state().appendToSequence('a');
  state().setSequenceBackingTrack({ path: '/song.mp3', volume: 0.6, muteSource: true,
    videoMomentSec: 3, musicMomentSec: 10, offsetSec: -7 });
  state().updateClip('a', { in: 15 });
  expect(project().sequenceBackingTrack!.videoMomentSec).toBeUndefined();
  expect(project().sequenceBackingTrack!.offsetSec).toBe(-17);
  const saved = parseAndClampProject(JSON.parse(JSON.stringify(serializeProject(project())))).project;
  state().setProject(saved);
  state().updateClip('a', { in: 10 });
  expect(project().sequenceBackingTrack).toMatchObject({ videoMomentSec: 3, offsetSec: -7 });
  expect(project().sequenceBackingTrack!.sequenceAnchor).toBeUndefined();
});

test('changing clip music volume keeps its recoverable alignment when restoring a trimmed moment', () => {
  state().updateClip('a', { in: 17 });
  state().updateClip('a', { backingTrack: { ...clip().backingTrack!, volume: 0.2 } });
  state().updateClip('a', { in: 10 });
  expect(clip().backingTrack).toMatchObject({ videoMomentSec: 12, musicMomentSec: 20, offsetSec: -8, volume: 0.2 });
});

test('restoring a trimmed sequence moment after reordering keeps the same song moment', () => {
  state().clearSequence();
  state().appendToSequence('a');
  state().appendToSequence('b');
  state().setSequenceBackingTrack({ path: '/song.mp3', volume: 0.6, muteSource: true,
    videoMomentSec: 3, musicMomentSec: 10, offsetSec: -7 });
  state().updateClip('a', { in: 15 });
  state().reorderSequence(0, 1);
  state().updateClip('a', { in: 10 });
  expect(project().sequenceBackingTrack).toMatchObject({ videoMomentSec: 13, offsetSec: 3 });
});

test('recording over an earlier extension keeps the project loadable', () => {
  state().updateClip('a', { in: 5 });
  state().updateFocusMarker('a', 'player', { in: 5, out: 10,
    path: [{ t: 0, cx: 123, cy: 234 }, { t: 5, cx: 345, cy: 456 }] });
  const saved = parseAndClampProject(JSON.parse(JSON.stringify(serializeProject(project())))).project;
  expect(saved.clips[0]!.focusMarkers[0]!.path![0]).toEqual({ t: 0, cx: 123, cy: 234 });
});
