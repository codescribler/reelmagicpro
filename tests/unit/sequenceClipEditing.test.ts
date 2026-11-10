import { useProjectStore } from '../../src/renderer/state/projectStore';
import { parseAndClampProject } from '../../src/main/project/schema';
import { serializeProject } from '../../src/main/project/io';
import type { Project } from '../../src/shared/types';

const state = () => useProjectStore.getState();
const current = () => state().project!;
const sequenceClip = () => current().clips.find(c => c.id === current().sequence[0]!.clipId)!;

beforeEach(() => {
  const source = { id: 's1', path: '/match.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };
  const project: Project = {
    version: 1, sourceVideo: source, sources: [source], bookmarks: [],
    clips: [{ id: 'a', name: 'Goal', in: 10, out: 30, speed: 1,
      zoom: { x: 0, y: 0, width: 1920, height: 1080 },
      focusMarkers: [{ id: 'm1', x: 10, y: 10, width: 50, height: 50, in: 10, out: 30, color: 'white' }],
      zoomPath: [{ t: 0, cx: 960, cy: 540, zoom: 1 }, { t: 20, cx: 600, cy: 540, zoom: 2 }] },
      { id: 'b', name: 'Save', in: 40, out: 50, speed: 1,
        zoom: { x: 0, y: 0, width: 1920, height: 1080 }, focusMarkers: [] }],
    sequence: [{ clipId: 'a' }, { clipId: 'b' }, { clipId: 'a' }],
  };
  state().setProject(project);
});

test('sequence playback loads each clip panel without copying or dirtying the project', () => {
  const sourceId = state().addSource({ path: '/second.mp4', duration: 200, width: 640, height: 480, fps: 25 });
  state().updateClip('b', { sourceId });
  state().markClean();
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  expect(state().selectedClipId).toBe('a');
  state().setPreviewMode({ kind: 'sequence', index: 1 });
  expect(state().selectedClipId).toBe('b');
  expect(state().activeSourceId).toBe(sourceId);
  expect(state().previewMode).toEqual({ kind: 'sequence', index: 1 });
  expect(current().clips).toHaveLength(2);
  expect(state().dirty).toBe(false);
});

test('trimming creates a separate clip for just this occurrence and continues editing that version', () => {
  const original = structuredClone(current().clips[0]);
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().nudgeClipBoundary('a', 'in', 5);
  const copy = sequenceClip();
  expect(copy.id).not.toBe('a');
  expect(copy.in).toBe(15);
  expect(copy.focusMarkers[0]!.in).toBe(15);
  expect(copy.zoomPath![0]!.t).toBe(0);
  expect(current().clips[0]).toEqual(original);
  expect(current().sequence[2]!.clipId).toBe('a');
  expect(state().selectedClipId).toBe(copy.id);
  expect(state().previewMode).toEqual({ kind: 'clip', clipId: copy.id });
  expect(state().seekRequest!.time).toBe(15);
  state().updateClip(copy.id, { speed: 0.5 });
  expect(sequenceClip().speed).toBe(0.5);
  expect(current().clips).toHaveLength(3);
});

test.each(['update', 'add-marker', 'update-marker', 'delete-marker', 'primary', 'framing'])('%s isolates the original clip', action => {
  const original = structuredClone(current().clips[0]);
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  switch (action) {
    case 'update': state().updateClip('a', { brightness: 0.2 }); break;
    case 'add-marker': state().addFocusMarker('a', { ...original!.focusMarkers[0]!, id: 'm2' }); break;
    case 'update-marker': state().updateFocusMarker('a', 'm1', { color: 'red' }); break;
    case 'delete-marker': state().deleteFocusMarker('a', 'm1'); break;
    case 'primary': state().togglePrimaryMarker('a', 'm1'); break;
    case 'framing': state().setReelFraming('a', { panPath: [{ t: 0, cx: 500 }] }); break;
  }
  expect(sequenceClip().id).not.toBe('a');
  expect(current().clips[0]).toEqual(original);
  expect(state().selectedClipId).toBe(sequenceClip().id);
  const copy = sequenceClip();
  switch (action) {
    case 'update': expect(copy.brightness).toBe(0.2); break;
    case 'add-marker': expect(copy.focusMarkers.map(m => m.id)).toEqual(['m1', 'm2']); break;
    case 'update-marker': expect(copy.focusMarkers[0]!.color).toBe('red'); break;
    case 'delete-marker': expect(copy.focusMarkers).toEqual([]); break;
    case 'primary': expect(copy.focusMarkers[0]!.primary).toBe(true); break;
    case 'framing': expect(copy.reelFraming).toEqual({ panPath: [{ t: 0, cx: 500 }] }); break;
  }
});

test('marker editor follows the copied clip even when add and track happen in the same event', () => {
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().addFocusMarker('a', { ...current().clips[0]!.focusMarkers[0]!, id: 'new' });
  state().setPreviewMode({ kind: 'track-marker', clipId: 'a', markerId: 'new' });
  expect(state().previewMode).toEqual({ kind: 'track-marker', clipId: sequenceClip().id, markerId: 'new' });
  state().updateFocusMarker('a', 'new', { label: 'Player' });
  expect(sequenceClip().focusMarkers.find(m => m.id === 'new')!.label).toBe('Player');
  expect(current().clips).toHaveLength(3);
});

test('zoom recording keeps sequence context through editor modes and completion', () => {
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().setPreviewMode({ kind: 'record-zoom', clipId: 'a' });
  expect(current().clips).toHaveLength(2);
  state().updateClip('a', { zoomPath: [{ t: 0, cx: 500, cy: 500, zoom: 2 }] });
  state().setPreviewMode({ kind: 'clip', clipId: 'a' });
  expect(state().previewMode).toEqual({ kind: 'clip', clipId: sequenceClip().id });
  expect(current().clips[0]!.zoomPath).toHaveLength(2);
});

test.each([false, true])('the sequence version survives save/reload and later edits (named multi-source=%s)', multi => {
  if (multi) {
    const sourceId = state().addSource({ path: '/second.mp4', duration: 100, width: 640, height: 480, fps: 25 });
    state().updateClip('a', { sourceId });
    state().createNamedSequence('Goals', true);
  }
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().updateClip('a', { out: 20 });
  const copyId = sequenceClip().id;
  state().setProject(parseAndClampProject(JSON.parse(JSON.stringify(serializeProject(current())))).project);
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().updateClip(copyId, { brightness: 0.1 });
  expect(sequenceClip().id).toBe(copyId);
  expect(sequenceClip().out).toBe(20);
  expect(sequenceClip().brightness).toBe(0.1);
  expect(current().clips[0]!.out).toBe(30);
  expect(current().clips).toHaveLength(3);
});

test('editing a copied named sequence preserves the other arrangement and its clip version', () => {
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().updateClip('a', { out: 20 });
  const firstVersion = sequenceClip().id;
  state().createNamedSequence('Short reel', true);
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().updateClip(firstVersion, { out: 18 });
  expect(sequenceClip().id).not.toBe(firstVersion);
  expect(sequenceClip().out).toBe(18);
  state().selectNamedSequence(current().namedSequences![0]!.id);
  expect(sequenceClip().id).toBe(firstVersion);
  expect(sequenceClip().out).toBe(20);
});

test('selecting a library clip exits sequence editing', () => {
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().selectClip('a');
  state().updateClip('a', { name: 'Original goal' });
  expect(current().clips).toHaveLength(2);
  expect(current().clips[0]!.name).toBe('Original goal');
});

test('a clamped trim that changes nothing does not create a copy', () => {
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().nudgeClipBoundary('a', 'in', 0);
  expect(current().clips).toHaveLength(2);
  expect(state().dirty).toBe(false);
});

test('reordering while editing keeps the version attached to the same occurrence', () => {
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().setPreviewMode({ kind: 'set-zoom', clipId: 'a' });
  state().reorderSequence(0, 2);
  state().updateClip('a', { speed: 0.5 });
  expect(current().sequence[0]!.clipId).toBe('b');
  expect(current().sequence[1]!.clipId).toBe('a');
  const copy = current().clips.find(c => c.id === current().sequence[2]!.clipId)!;
  expect(copy.id).not.toBe('a');
  expect(copy.speed).toBe(0.5);
  expect(current().clips[0]!.speed).toBe(1);
});

test('removing an earlier occurrence preserves the current sequence editing target', () => {
  state().setPreviewMode({ kind: 'sequence', index: 2 });
  state().removeFromSequence(0);
  state().updateClip('a', { out: 22 });
  expect(current().sequence[0]!.clipId).toBe('b');
  expect(current().sequence[1]!.clipId).not.toBe('a');
  expect(current().clips[0]!.out).toBe(30);
});

test.each(['remove', 'clear', 'source'])('%s exits sequence editing when the selected occurrence is gone', action => {
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  if (action === 'remove') state().removeFromSequence(0);
  if (action === 'clear') state().clearSequence();
  if (action === 'source') state().setActiveSourceId('s1');
  expect(state().sequenceEditContext).toBeNull();
  expect(state().selectedClipId).toBeNull();
  expect(state().previewMode).toEqual({ kind: 'source' });
});

test('trimming a sequence clip from another source uses that source duration', () => {
  const sourceId = state().addSource({ path: '/long.mp4', duration: 200, width: 640, height: 480, fps: 25 });
  state().updateClip('a', { sourceId, in: 110, out: 120 });
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  state().nudgeClipBoundary('a', 'out', 5);
  expect(sequenceClip().out).toBe(125);
  expect(current().clips[0]!.out).toBe(120);
});

test('deleting a library clip before the playing occurrence keeps the correct sequence target', () => {
  state().setPreviewMode({ kind: 'sequence', index: 2 });
  state().deleteClip('b');
  state().updateClip('a', { out: 22 });
  expect(current().sequence).toHaveLength(2);
  expect(current().sequence[0]!.clipId).toBe('a');
  expect(current().sequence[1]!.clipId).not.toBe('a');
  expect(current().clips[0]!.out).toBe(30);
});

test('removing a source before the current occurrence preserves its editing target', () => {
  const sourceId = state().addSource({ path: '/second.mp4', duration: 100, width: 640, height: 480, fps: 25 });
  state().updateClip('b', { sourceId });
  state().setPreviewMode({ kind: 'sequence', index: 2 });
  state().removeSource(sourceId, { cascade: true });
  state().updateClip('a', { out: 22 });
  expect(current().sequence[0]!.clipId).toBe('a');
  expect(current().sequence[1]!.clipId).not.toBe('a');
  expect(current().clips[0]!.out).toBe(30);
});
