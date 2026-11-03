import React from 'react';
import { useProjectStore } from '../state/projectStore';
import { loadProjectInteractive } from '../state/loadProject';
import { saveProjectInteractive } from '../state/saveProject';

async function confirmDiscardIfDirty(dirty: boolean): Promise<boolean> {
  if (!dirty) return true;
  return window.confirm('You have unsaved changes. Discard them?');
}

export function MenuActions() {
  const project = useProjectStore(s => s.project);
  const dirty = useProjectStore(s => s.dirty);
  const setProject = useProjectStore(s => s.setProject);

  async function onNew() {
    if (!await confirmDiscardIfDirty(dirty)) return;
    setProject(null, null);
  }

  async function onLoad() {
    await loadProjectInteractive();
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={onNew}>New</button>
      <button onClick={onLoad}>Open Project</button>
      <button disabled={!project} onClick={() => void saveProjectInteractive(false)}>Save</button>
      <button disabled={!project} onClick={() => void saveProjectInteractive(true)}>Save As…</button>
    </div>
  );
}
