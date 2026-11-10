import { useProjectStore } from '../../src/renderer/state/projectStore';
import { parseAndClampProject } from '../../src/main/project/schema';
import { serializeProject } from '../../src/main/project/io';

const source = { path: 'game.mp4', duration: 120, width: 1920, height: 1080, fps: 30 };
const player = { id: 'p_alex', name: 'Alex', shortcut: 'a' };

beforeEach(() => {
  useProjectStore.getState().setProject(parseAndClampProject({
    version: 2, sources: [{ ...source, id: 's1' }, { ...source, id: 's2' }],
    clips: [], sequence: [], bookmarks: [],
  }).project);
});

test('player bookmarks keep their own player and active video without changing ordinary bookmarks', () => {
  const st = useProjectStore.getState();
  st.setActiveSourceId('s2');
  st.addBookmark(42, player);
  st.addBookmark(43);
  expect(useProjectStore.getState().project!.bookmarks).toEqual([
    expect.objectContaining({ time: 42, sourceId: 's2', playerId: 'p_alex', playerName: 'Alex' }),
    expect.objectContaining({ time: 43, sourceId: 's2' }),
  ]);
  expect(useProjectStore.getState().project!.bookmarks[1].playerId).toBeUndefined();
  expect(useProjectStore.getState().dirty).toBe(true);
});

test.each([false, true])('player names survive project serialization with multiple sources: %s', multi => {
  const raw = {
    version: multi ? 2 : 1, sourceVideo: source,
    ...(multi ? { sources: [{ ...source, id: 's1' }, { ...source, id: 's2' }] } : {}),
    clips: [{ id: 'c1', name: 'Play', in: 1, out: 10, speed: 1,
      zoom: { x: 0, y: 0, width: 1920, height: 1080 },
      focusMarkers: [{ id: 'm1', x: 0, y: 0, width: 50, height: 50, in: 1, out: 10,
        color: 'white', label: 'Alex', playerId: 'p_alex' }] }],
    sequence: [], bookmarks: [{ id: 'b1', time: 42, createdAt: 1, label: 'Great pass',
      playerId: 'p_alex', playerName: 'Alex', ...(multi ? { sourceId: 's2' } : {}) }],
  };
  const roundTrip = parseAndClampProject(serializeProject(parseAndClampProject(raw).project)).project;
  expect(roundTrip.bookmarks[0]).toMatchObject({ playerId: 'p_alex', playerName: 'Alex', label: 'Great pass' });
  expect(roundTrip.clips[0].focusMarkers[0]).toMatchObject({ label: 'Alex', playerId: 'p_alex' });
});
