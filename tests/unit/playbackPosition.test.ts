import { parseAndClampProject } from '../../src/main/project/schema';
import { serializeProject } from '../../src/main/project/io';
import { useProjectStore } from '../../src/renderer/state/projectStore';

const source = { path: 'match.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };
const legacy = { version: 1, sourceVideo: source, clips: [], sequence: [] };

test('single-source projects restore their saved position after a JSON round trip', () => {
  const original = parseAndClampProject({ ...legacy, playbackPosition: { time: 42.75 } }).project;
  const saved = serializeProject(original) as any;
  expect(saved.playbackPosition).toEqual({ time: 42.75 });
  const reopened = parseAndClampProject(JSON.parse(JSON.stringify(saved))).project;
  useProjectStore.getState().setProject(reopened);
  expect(useProjectStore.getState().seekRequest?.time).toBe(42.75);
  expect(useProjectStore.getState().previewMode).toEqual({ kind: 'source' });
});

test('multi-source projects restore the selected video and position', () => {
  const original = parseAndClampProject({ version: 2,
    sources: [{ ...source, id: 'one' }, { ...source, path: 'second.mp4', id: 'two' }],
    clips: [], sequence: [], playbackPosition: { time: 81, sourceId: 'two' },
  }).project;
  const reopened = parseAndClampProject(JSON.parse(JSON.stringify(serializeProject(original)))).project;
  useProjectStore.getState().setProject(reopened);
  expect(useProjectStore.getState().activeSourceId).toBe('two');
  expect(useProjectStore.getState().seekRequest?.time).toBe(81);
});

test('legacy projects reset a previous seek to the beginning', () => {
  useProjectStore.getState().requestSeek(90);
  const token = useProjectStore.getState().seekRequest!.token;
  useProjectStore.getState().setProject(parseAndClampProject(legacy).project);
  expect(useProjectStore.getState().seekRequest).toEqual({ time: 0, token: token + 1 });
});

test.each([[-10, 0], [500, 100]])('clamps saved position %s to %s', (time, expected) => {
  const parsed = parseAndClampProject({ ...legacy, playbackPosition: { time, sourceId: 'missing' } }).project;
  expect(parsed.playbackPosition).toEqual({ time: expected, sourceId: parsed.sources[0]!.id });
});
