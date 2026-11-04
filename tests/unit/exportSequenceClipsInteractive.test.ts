import { exportSequenceClipsInteractive } from '../../src/renderer/state/exportSequenceClips';
import { useProjectStore } from '../../src/renderer/state/projectStore';
import type { Project } from '../../src/shared/types';

const source = { id: 'source', path: '/match.mp4', width: 1920, height: 1080, duration: 60, fps: 30 };
const project: Project = {
  version: 1, sourceVideo: source, sources: [source], clips: [], bookmarks: [],
  sequence: [{ clipId: 'c2' }, { clipId: 'c1' }],
  namedSequences: [{ id: 'short', name: 'Short highlights', entries: [{ clipId: 'c1' }] }],
  activeSequenceId: 'short',
};
const chooseExportDirectory = jest.fn();
const exportSequenceClips = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  (global as any).window = { reelmagic: { chooseExportDirectory, exportSequenceClips } };
  useProjectStore.setState({ activeRun: null, exportResult: null, exportLabel: null });
});
afterAll(() => { delete (global as any).window; });

test('cancelling the folder picker does not start an export', async () => {
  chooseExportDirectory.mockResolvedValue({ ok: false });
  await exportSequenceClipsInteractive(project, 'both');
  expect(exportSequenceClips).not.toHaveBeenCalled();
  expect(useProjectStore.getState().activeRun).toBeNull();
  expect(useProjectStore.getState().exportResult).toBeNull();
});

test('exports the active edited sequence to the chosen location in both formats', async () => {
  chooseExportDirectory.mockResolvedValue({ ok: true, path: '/chosen' });
  const result = { ok: true, outputDirectory: '/chosen/Short highlights', outputPaths: ['/chosen/01.mp4'] };
  exportSequenceClips.mockImplementation(async (args) => {
    expect(useProjectStore.getState().activeRun?.runId).toBe(args.runId);
    return result;
  });
  await exportSequenceClipsInteractive(project, 'both');
  expect(exportSequenceClips).toHaveBeenCalledWith(expect.objectContaining({
    sequence: project.sequence, clips: project.clips, sources: project.sources,
    directory: '/chosen', sequenceName: 'Short highlights', format: 'both',
  }));
  expect(useProjectStore.getState().exportResult).toEqual(result);
});

test('preserves saved-file information when a batch is cancelled', async () => {
  chooseExportDirectory.mockResolvedValue({ ok: true, path: '/chosen' });
  const result = { ok: false, error: 'Cancelled', outputPaths: ['/chosen/01.mp4'], outputDirectory: '/chosen/clips' };
  exportSequenceClips.mockResolvedValue(result);
  await exportSequenceClipsInteractive(project, 'standard');
  expect(useProjectStore.getState().exportResult).toEqual(result);
});

test('reports folder-picker and IPC failures in the export dialog', async () => {
  chooseExportDirectory.mockRejectedValue(new Error('Folder unavailable'));
  await exportSequenceClipsInteractive(project, 'standard');
  expect(useProjectStore.getState().exportResult).toMatchObject({ ok: false, error: 'Folder unavailable' });
  chooseExportDirectory.mockResolvedValue({ ok: true, path: '/chosen' });
  exportSequenceClips.mockRejectedValue(new Error('Export unavailable'));
  await exportSequenceClipsInteractive(project, 'standard');
  expect(useProjectStore.getState().exportResult).toMatchObject({ ok: false, error: 'Export unavailable' });
});
