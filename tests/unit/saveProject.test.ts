/// <reference path="../../src/shared/window.d.ts" />
import { saveProjectInteractive } from '../../src/renderer/state/saveProject';
import { useProjectStore } from '../../src/renderer/state/projectStore';
import { useRecentProjects } from '../../src/renderer/state/recentProjects';

const write = jest.fn();
const alertMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  useProjectStore.getState().setProject(null);
  useProjectStore.getState().setSource({ path: '/match.mp4', duration: 60, width: 320, height: 240, fps: 30 });
  useProjectStore.getState().createNamedSequence('Goals');
  useRecentProjects.setState({ paths: [] });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { reelmagic: { saveProject: write } } });
  Object.defineProperty(globalThis, 'alert', { configurable: true, value: alertMock });
});
afterAll(() => { Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'alert'); });

test('saving writes every named sequence and marks the unchanged project clean', async () => {
  write.mockResolvedValue({ ok: true, path: '/saved.rmproj' });
  expect(await saveProjectInteractive()).toBe(true);
  expect(write.mock.calls[0][0].project.namedSequences.map((sequence: { name: string }) => sequence.name))
    .toEqual(['Sequence 1', 'Goals']);
  expect(useProjectStore.getState().projectPath).toBe('/saved.rmproj');
  expect(useProjectStore.getState().dirty).toBe(false);
  expect(useRecentProjects.getState().paths).toEqual(['/saved.rmproj']);
});

test.each([{ ok: false }, { ok: false, error: 'Disk full' }])('cancelled or failed saving retains unsaved edits: %j', async result => {
  write.mockResolvedValue(result);
  expect(await saveProjectInteractive()).toBe(false);
  expect(useProjectStore.getState().dirty).toBe(true);
  expect(useRecentProjects.getState().paths).toEqual([]);
});

test('changes made while a save is pending remain dirty', async () => {
  let finish!: (result: { ok: boolean; path: string }) => void;
  write.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const saving = saveProjectInteractive();
  useProjectStore.getState().createNamedSequence('Later edit');
  finish({ ok: true, path: '/saved.rmproj' });
  expect(await saving).toBe(true);
  expect(useProjectStore.getState().dirty).toBe(true);
});
