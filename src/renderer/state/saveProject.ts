import { useProjectStore } from './projectStore';
import { useRecentProjects } from './recentProjects';
import { previewClock } from './previewClock';

export async function saveProjectInteractive(forceDialog = false): Promise<boolean> {
  const state = useProjectStore.getState();
  const project = state.project;
  if (!project) return false;
  try {
    const result = await window.reelmagic.saveProject({
      project: { ...project, playbackPosition: { time: previewClock.currentTime,
        sourceId: state.activeSourceId ?? undefined } },
      suggestedPath: forceDialog ? undefined : state.projectPath ?? undefined,
    });
    if (result.ok && result.path) {
      useRecentProjects.getState().remember(result.path);
      // Edits made while the file dialog/write was open still need saving.
      if (useProjectStore.getState().project === project) {
        useProjectStore.setState({ projectPath: result.path, dirty: false });
      }
      return true;
    }
    if (result.error) alert(`Couldn't save project: ${result.error}`);
  } catch (error) {
    alert(`Couldn't save project: ${error instanceof Error ? error.message : String(error)}`);
  }
  return false;
}
