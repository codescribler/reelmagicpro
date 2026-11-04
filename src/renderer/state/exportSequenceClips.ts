import type { Project } from '../../shared/types';
import type { ExportSelection } from '../../shared/exportTargets';
import { useProjectStore } from './projectStore';

export async function exportSequenceClipsInteractive(project: Project, format: ExportSelection): Promise<void> {
  try {
    const destination = await window.reelmagic.chooseExportDirectory();
    if (!destination.ok || !destination.path) return;
    const runId = 'r_' + Math.random().toString(36).slice(2, 10);
    useProjectStore.getState().startRun(runId);
    useProjectStore.setState({ exportLabel: 'Individual clips' });
    const result = await window.reelmagic.exportSequenceClips({
      runId, clips: project.clips, sequence: project.sequence, sources: project.sources,
      directory: destination.path, format,
      sequenceName: project.namedSequences?.find(s => s.id === project.activeSequenceId)?.name ?? 'Sequence clips',
    });
    useProjectStore.getState().setExportResult(result);
  } catch (error) {
    useProjectStore.getState().setExportResult({ ok: false,
      error: error instanceof Error ? error.message : String(error) });
  }
}
