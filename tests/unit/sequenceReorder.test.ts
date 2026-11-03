import { useProjectStore } from '../../src/renderer/state/projectStore';
import { sequenceDropIndex } from '../../src/renderer/lib/sequenceDrag';

beforeEach(() => {
  const source = { path: '/match.mp4', duration: 60, width: 320, height: 240, fps: 30 };
  useProjectStore.getState().setProject({ version: 2, sourceVideo: source, sources: [{ ...source, id: 's' }],
    clips: ['a', 'b', 'c'].map(id => ({ id, name: id, in: 0, out: 5, speed: 1,
      zoom: { x: 0, y: 0, width: 320, height: 240 }, focusMarkers: [] })),
    sequence: ['a', 'b', 'a', 'c'].map(clipId => ({ clipId })), bookmarks: [],
  });
});

test.each([
  [0, 3, 2, 1, ['b', 'a', 'c', 'a']],
  [3, 0, 2, 3, ['c', 'a', 'b', 'a']],
  [2, 0, 2, 0, ['a', 'a', 'b', 'c']],
  [0, 3, 0, 3, ['b', 'a', 'c', 'a']],
])('moving entry %s to %s keeps playing occurrence %s at %s', (from, to, playing, expectedIndex, expectedOrder) => {
  useProjectStore.getState().setPreviewMode({ kind: 'sequence', index: playing });
  useProjectStore.getState().reorderSequence(from, to);
  const state = useProjectStore.getState();
  expect(state.project!.sequence.map(entry => entry.clipId)).toEqual(expectedOrder);
  expect(state.previewMode).toEqual({ kind: 'sequence', index: expectedIndex });
  expect(state.dirty).toBe(true);
});

test.each([[-1, 0], [0, 9], [0.5, 2], [0, NaN], [1, 1]])('invalid or unchanged reorder %s → %s leaves the project clean', (from, to) => {
  const before = useProjectStore.getState().project;
  useProjectStore.getState().reorderSequence(from, to);
  expect(useProjectStore.getState().project).toBe(before);
  expect(useProjectStore.getState().dirty).toBe(false);
});

test.each([[0, 3, 2], [3, 1, 1], [0, 4, 3], [3, 0, 0], [0, 1, 0]])(
  'drop from entry %s at gap %s produces position %s', (from, gap, expected) => {
    expect(sequenceDropIndex(from, gap, 4)).toBe(expected);
  },
);
