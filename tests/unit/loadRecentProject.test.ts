/// <reference path="../../src/shared/window.d.ts" />
import { loadProjectInteractive } from '../../src/renderer/state/loadProject';
import { useProjectStore } from '../../src/renderer/state/projectStore';
import { useRecentProjects } from '../../src/renderer/state/recentProjects';
import type { Project } from '../../src/shared/types';

const project: Project = {
  version: 1,
  sourceVideo: { path: 'match.mp4', duration: 60, width: 1920, height: 1080, fps: 30 },
  sources: [], clips: [], sequence: [], bookmarks: [],
};
const loadProject = jest.fn();
const checkPath = jest.fn().mockResolvedValue({ exists: true });
const alertMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  useProjectStore.getState().setProject(null, null);
  useRecentProjects.setState({ paths: [] });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { reelmagic: { loadProject, checkPath } } });
  Object.defineProperty(globalThis, 'alert', { configurable: true, value: alertMock });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'alert');
});

test('opens a recent project directly and remembers the successful load', async () => {
  const path = 'C:/Projects/Match.rmproj';
  loadProject.mockResolvedValue({ ok: true, path, project });
  await loadProjectInteractive(path);
  expect(loadProject).toHaveBeenCalledWith(path);
  expect(useProjectStore.getState().projectPath).toBe(path);
  expect(useRecentProjects.getState().paths).toEqual([path]);
});

test('a missing recent project reports the error without loading or remembering it', async () => {
  loadProject.mockResolvedValue({ ok: false, error: 'File not found' });
  await loadProjectInteractive('missing.rmproj');
  expect(alertMock).toHaveBeenCalledWith("Couldn't load project: File not found");
  expect(useProjectStore.getState().project).toBeNull();
  expect(useRecentProjects.getState().paths).toEqual([]);
});
