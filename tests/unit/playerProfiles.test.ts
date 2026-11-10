import { createPlayerProfilesStore, playerForShortcut } from '../../src/renderer/state/playerProfiles';

function memoryStorage(initial?: string) {
  let value: string | null = initial ?? null;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
}

test('profiles persist outside projects, including edits and deletion', () => {
  const storage = memoryStorage();
  const store = createPlayerProfilesStore(storage);
  expect(store.getState().saveProfile({ name: ' Alex ', shortcut: 'A' })).toBeNull();
  const alex = store.getState().profiles[0];
  expect(alex).toMatchObject({ name: 'Alex', shortcut: 'a' });
  expect(store.getState().saveProfile({ name: 'Alex Smith', shortcut: 'x' }, alex.id)).toBeNull();
  const reopened = createPlayerProfilesStore(storage);
  expect(reopened.getState().profiles).toEqual([{ ...alex, name: 'Alex Smith', shortcut: 'x' }]);
  reopened.getState().deleteProfile(alex.id);
  expect(createPlayerProfilesStore(storage).getState().profiles).toEqual([]);
});

test('invalid or colliding profiles cannot steal bookmark shortcuts', () => {
  const store = createPlayerProfilesStore(memoryStorage());
  const save = store.getState().saveProfile;
  expect(save({ name: 'Alex', shortcut: 'a' })).toBeNull();
  for (const input of [
    { name: '', shortcut: 'c' }, { name: 'Ben', shortcut: 'b' },
    { name: 'Ben', shortcut: 'A' }, { name: 'Ben', shortcut: 'ab' },
    { name: 'Ben', shortcut: '1' }, { name: 'alex', shortcut: 'c' },
  ]) expect(save(input)).toEqual(expect.any(String));
  expect(store.getState().profiles).toHaveLength(1);
  expect(playerForShortcut(store.getState().profiles, { key: 'A' })?.name).toBe('Alex');
  for (const event of [{ key: 'a', repeat: true }, { key: 'a', ctrlKey: true },
    { key: 'a', altKey: true }, { key: 'a', metaKey: true }, { key: 'b' }, { key: 'z' }]) {
    expect(playerForShortcut(store.getState().profiles, event)).toBeUndefined();
  }
});

test('loading damaged profile data keeps valid entries without shortcut collisions', () => {
  const store = createPlayerProfilesStore(memoryStorage(JSON.stringify([
    { id: 'p1', name: 'Alex', shortcut: 'A' },
    { id: 'p2', name: 'Ben', shortcut: 'a' },
    { id: 'p3', name: 'Chris', shortcut: 'b' },
    null, { id: 'p1', name: 'Duplicate id', shortcut: 'd' },
    { id: 'p4', name: 'Dana', shortcut: 'd' },
  ])));
  expect(store.getState().profiles).toEqual([
    { id: 'p1', name: 'Alex', shortcut: 'a' }, { id: 'p4', name: 'Dana', shortcut: 'd' },
  ]);
  expect(createPlayerProfilesStore(memoryStorage('{bad json')).getState().profiles).toEqual([]);
});

test('a failed write reports an error and retains the saved profiles', () => {
  const store = createPlayerProfilesStore({ getItem: () => null, setItem: () => { throw Error('full'); } });
  expect(store.getState().saveProfile({ name: 'Alex', shortcut: 'a' })).toEqual(expect.any(String));
  expect(store.getState().profiles).toEqual([]);
});
