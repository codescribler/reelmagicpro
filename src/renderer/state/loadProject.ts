import { useProjectStore } from './projectStore';

// Shared "open a saved project" flow used by both the menubar (`MenuActions`)
// and the empty-state hero. Handles the source-not-found relink prompt and
// warnings so the entry points stay one-liners.
export async function loadProjectInteractive(): Promise<void> {
  const dirty = useProjectStore.getState().dirty;
  if (dirty) {
    const ok = window.confirm('You have unsaved changes. Discard them?');
    if (!ok) return;
  }
  const r = await window.reelmagic.loadProject();
  if (!r.ok || !r.project) {
    if (r.error) alert(`Couldn't load project: ${r.error}`);
    return;
  }
  const exists = await window.reelmagic.checkPath(r.project.sourceVideo.path);
  let relinked = r.project;
  let didRelink = false;
  if (!exists.exists) {
    alert(`Source not found at:\n${r.project.sourceVideo.path}\n\nPick the file to relink.`);
    const picked = await window.reelmagic.openSourceVideo();
    if (picked.source) {
      // Patch BOTH the legacy sourceVideo mirror and the canonical sources[0]
      // entry. Keeping just one in sync would leave the in-memory project in
      // an inconsistent state — the renderer reads from both.
      const newPrimary = picked.source;
      const oldPrimary = r.project.sources[0]!;
      const nextSources = [
        { ...oldPrimary, ...newPrimary }, // keep id (and any rename) but swap path/dims/duration/fps
        ...r.project.sources.slice(1),
      ];
      relinked = { ...r.project, sourceVideo: newPrimary, sources: nextSources };
      didRelink = true;
    }
  }
  useProjectStore.getState().setProject(relinked, r.path ?? null);
  if (r.invalidClipIds && r.invalidClipIds.length > 0) {
    useProjectStore.setState({ invalidClipIds: new Set(r.invalidClipIds) });
  }
  if (r.warnings && r.warnings.length > 0) {
    alert(r.warnings.join('\n'));
  }
  if (didRelink) {
    // setProject reset dirty to false — flip it because the loaded data no
    // longer matches the saved file.
    useProjectStore.setState({ dirty: true });
  }
}
