import { useProjectStore } from '../../src/renderer/state/projectStore';
import { parseAndClampProject } from '../../src/main/project/schema';
import { serializeProject } from '../../src/main/project/io';
import { saveProject, loadProject } from '../../src/main/project/io';
import fs from 'fs';
import os from 'os';
import path from 'path';

function project() {
  return parseAndClampProject({ version: 1,
    sourceVideo: { path: '/match.mp4', duration: 60, width: 320, height: 240, fps: 30 },
    clips: ['a', 'b', 'c'].map(id => ({ id, name: id, in: 0, out: 5, speed: 1,
      zoom: { x: 0, y: 0, width: 320, height: 240 }, focusMarkers: [] })),
    sequence: ['a', 'b', 'a'].map(clipId => ({ clipId })),
    sequenceBackingTrack: { path: '/original.mp3', volume: 0.6, muteSource: true },
    sequenceBrightness: 0.2,
  }).project;
}
const state = () => useProjectStore.getState();
const order = () => state().project!.sequence.map(entry => entry.clipId);

beforeEach(() => state().setProject(project()));

test('legacy projects keep their file shape before named sequences are used', () => {
  const raw = serializeProject(state().project!) as Record<string, unknown>;
  expect(raw).not.toHaveProperty('namedSequences');
  expect(raw.sequence).toEqual([{ clipId: 'a' }, { clipId: 'b' }, { clipId: 'a' }]);
});

test('creating a sequence preserves the original order and settings', () => {
  const id = state().createNamedSequence('Goals');
  expect(id).toBeTruthy();
  expect(order()).toEqual([]);
  expect(state().project!.sequenceBackingTrack).toBeUndefined();
  const original = state().project!.namedSequences!.find(sequence => sequence.name === 'Sequence 1')!;
  state().selectNamedSequence(original.id);
  expect(order()).toEqual(['a', 'b', 'a']);
  expect(state().project!.sequenceBackingTrack!.path).toBe('/original.mp3');
  expect(state().project!.sequenceBrightness).toBe(0.2);
});

test('switching keeps edits and separate audio and brightness for each sequence', () => {
  const goals = state().createNamedSequence('Goals')!;
  const original = state().project!.namedSequences![0]!.id;
  state().appendToSequence('c');
  state().appendToSequence('a');
  state().reorderSequence(1, 0);
  state().setSequenceBackingTrack({ path: '/goals.mp3', volume: 0.4, muteSource: false });
  state().setSequenceBrightness(-0.1);
  state().selectNamedSequence(original);
  state().appendToSequence('b');
  state().selectNamedSequence(goals);
  expect(order()).toEqual(['a', 'c']);
  expect(state().project!.sequenceBackingTrack!.path).toBe('/goals.mp3');
  expect(state().project!.sequenceBrightness).toBe(-0.1);
  expect(state().project!.namedSequences!.find(sequence => sequence.id === original)!.entries.map(e => e.clipId))
    .toEqual(['a', 'b', 'a', 'b']);
});

test.each([false, true])('all names, sequences and active selection survive JSON save/reload (multi-source=%s)', multi => {
  if (multi) state().addSource({ path: '/match2.mp4', duration: 60, width: 640, height: 480, fps: 30 });
  const id = state().createNamedSequence('Goals')!;
  state().appendToSequence('c');
  state().setSequenceBackingTrack({ path: '/song.mp3', volume: 0.3, muteSource: true });
  const restored = parseAndClampProject(JSON.parse(JSON.stringify(serializeProject(state().project!)))).project;
  state().setProject(restored);
  expect(state().project!.activeSequenceId).toBe(id);
  expect(order()).toEqual(['c']);
  expect(state().project!.namedSequences!.map(sequence => sequence.name)).toEqual(['Sequence 1', 'Goals']);
  state().selectNamedSequence(state().project!.namedSequences![0]!.id);
  expect(order()).toEqual(['a', 'b', 'a']);
  expect(state().project!.sequenceBackingTrack!.path).toBe('/original.mp3');
});

test('copying a sequence preserves repeated entries and isolates subsequent edits', () => {
  const copy = state().createNamedSequence('Alternate', true)!;
  expect(order()).toEqual(['a', 'b', 'a']);
  state().removeFromSequence(0);
  state().setSequenceBrightness(0.4);
  state().selectNamedSequence(state().project!.namedSequences![0]!.id);
  expect(order()).toEqual(['a', 'b', 'a']);
  expect(state().project!.sequenceBrightness).toBe(0.2);
  state().selectNamedSequence(copy);
  expect(order()).toEqual(['b', 'a']);
});

test('names can be renamed, trimmed and validated without creating duplicates', () => {
  const id = state().createNamedSequence('  Goals  ')!;
  expect(state().renameNamedSequence(id, ' Highlights ')).toBe(true);
  expect(state().createNamedSequence('highlights')).toBeNull();
  expect(state().createNamedSequence('   ')).toBeNull();
  expect(state().createNamedSequence('a'.repeat(81))).toBeNull();
  expect(state().renameNamedSequence(id, 'sequence 1')).toBe(false);
  expect(state().project!.namedSequences![1]!.name).toBe('Highlights');
});

test('clearing one sequence preserves other sequences', () => {
  state().createNamedSequence('Copy', true);
  state().clearSequence();
  state().selectNamedSequence(state().project!.namedSequences![0]!.id);
  expect(order()).toEqual(['a', 'b', 'a']);
});

test('deleting a library clip removes every occurrence from all saved sequences', () => {
  state().createNamedSequence('Copy', true);
  state().deleteClip('a');
  for (const sequence of state().project!.namedSequences!) expect(sequence.entries).toEqual([{ clipId: 'b' }]);
  expect(order()).toEqual(['b']);
});

test('removing a source cleans its clips from inactive sequences too', () => {
  const sourceId = state().addSource({ path: '/second.mp4', duration: 60, width: 320, height: 240, fps: 30 });
  state().addClip({ ...state().project!.clips[0]!, id: 'foreign', sourceId });
  state().appendToSequence('foreign');
  state().createNamedSequence('Other');
  state().appendToSequence('foreign');
  expect(state().removeSource(sourceId, { cascade: true }).ok).toBe(true);
  for (const sequence of state().project!.namedSequences!) expect(sequence.entries.some(e => e.clipId === 'foreign')).toBe(false);
});

test('switching sequences stops the old preview and invalid selection is ignored', () => {
  state().createNamedSequence('Other');
  state().setPreviewMode({ kind: 'sequence', index: 0 });
  const beforePause = state().pauseRequest?.token ?? 0;
  const original = state().project!.namedSequences![0]!.id;
  state().selectNamedSequence(original);
  expect(state().previewMode.kind).toBe('source');
  expect(state().pauseRequest!.token).toBeGreaterThan(beforePause);
  const before = state().project;
  state().selectNamedSequence('missing');
  expect(state().project).toBe(before);
});

test('deleting the active sequence selects another and never removes library clips or the last sequence', () => {
  const id = state().createNamedSequence('Other')!;
  expect(state().deleteNamedSequence(id)).toBe(true);
  expect(order()).toEqual(['a', 'b', 'a']);
  expect(state().project!.clips).toHaveLength(3);
  expect(state().deleteNamedSequence(state().project!.activeSequenceId!)).toBe(false);
});

test('named sequences can be written to a project file and reopened for editing', async () => {
  const file = path.join(os.tmpdir(), `rm-sequences-${Date.now()}-${Math.random().toString(36).slice(2)}.rmproj`);
  try {
    const goals = state().createNamedSequence('Goals')!;
    state().appendToSequence('c');
    await saveProject(state().project!, file);
    state().setProject(null);
    state().setProject((await loadProject(file)).project, file);
    expect(state().project!.activeSequenceId).toBe(goals);
    expect(order()).toEqual(['c']);
    state().appendToSequence('b');
    state().selectNamedSequence(state().project!.namedSequences![0]!.id);
    expect(order()).toEqual(['a', 'b', 'a']);
    state().selectNamedSequence(goals);
    expect(order()).toEqual(['c', 'b']);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('an unknown active id falls back to the first saved sequence', () => {
  state().createNamedSequence('Goals');
  const raw = JSON.parse(JSON.stringify(serializeProject(state().project!)));
  raw.activeSequenceId = 'missing';
  const restored = parseAndClampProject(raw).project;
  expect(restored.activeSequenceId).toBe(restored.namedSequences![0]!.id);
  expect(restored.sequence.map(entry => entry.clipId)).toEqual(['a', 'b', 'a']);
});
