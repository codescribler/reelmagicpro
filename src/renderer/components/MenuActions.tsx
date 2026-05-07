import React from 'react';
import { useProjectStore } from '../state/projectStore';
import { loadProjectInteractive } from '../state/loadProject';

async function confirmDiscardIfDirty(dirty: boolean): Promise<boolean> {
  if (!dirty) return true;
  return window.confirm('You have unsaved changes. Discard them?');
}

export function MenuActions() {
  const project = useProjectStore(s => s.project);
  const projectPath = useProjectStore(s => s.projectPath);
  const dirty = useProjectStore(s => s.dirty);
  const setProject = useProjectStore(s => s.setProject);
  const markClean = useProjectStore(s => s.markClean);

  async function onNew() {
    if (!await confirmDiscardIfDirty(dirty)) return;
    setProject(null, null);
  }

  async function onSave(forceDialog = false) {
    if (!project) return;
    const r = await window.reelmagic.saveProject({
      project,
      suggestedPath: forceDialog ? undefined : projectPath ?? undefined,
    });
    if (r.ok && r.path) {
      useProjectStore.setState({ projectPath: r.path });
      markClean();
    } else if (r.error) {
      alert(`Couldn't save project: ${r.error}`);
    }
  }

  async function onLoad() {
    await loadProjectInteractive();
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={onNew}>New</button>
      <button onClick={onLoad}>Open Project</button>
      <button disabled={!project} onClick={() => onSave(false)}>Save</button>
      <button disabled={!project} onClick={() => onSave(true)}>Save As…</button>
    </div>
  );
}
