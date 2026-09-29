const saved = new Map<string, string>();

beforeEach(() => {
  saved.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  } });
});

afterAll(() => { Reflect.deleteProperty(globalThis, 'localStorage'); });

function freshStore(): typeof import('../../src/renderer/state/recentProjects').useRecentProjects {
  let store: any;
  jest.isolateModules(() => { store = require('../../src/renderer/state/recentProjects').useRecentProjects; });
  return store;
}

test('keeps five unique projects newest first and restores them on restart', () => {
  const store = freshStore();
  for (let i = 1; i <= 6; i++) store.getState().remember(`C:\\Projects\\Match ${i}.rmproj`);
  store.getState().remember('c:/projects/match 3.rmproj');
  expect(store.getState().paths).toEqual([
    'c:/projects/match 3.rmproj', 'C:\\Projects\\Match 6.rmproj',
    'C:\\Projects\\Match 5.rmproj', 'C:\\Projects\\Match 4.rmproj', 'C:\\Projects\\Match 2.rmproj',
  ]);
  expect(freshStore().getState().paths).toEqual(store.getState().paths);
});

test.each(['broken JSON', '{}', '[null, 12, "", "C:/Match.rmproj"]'])('handles invalid stored history: %s', raw => {
  saved.set('reelmagic.recentProjects', raw);
  expect(freshStore().getState().paths).toEqual(raw.startsWith('[') ? ['C:/Match.rmproj'] : []);
});
