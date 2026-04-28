import React from 'react';
import { useProjectStore } from '../state/projectStore';

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
    }
  }

  async function onLoad() {
    if (!await confirmDiscardIfDirty(dirty)) return;
    const r = await window.reelmagic.loadProject();
    if (r.ok && r.project) {
      const exists = await window.reelmagic.checkPath(r.project.sourceVideo.path);
      if (!exists.exists) {
        alert(`Source not found at:\n${r.project.sourceVideo.path}\n\nPick the file to relink.`);
        const picked = await window.reelmagic.openSourceVideo();
        if (picked.source) {
          r.project.sourceVideo = picked.source;
        }
      }
      setProject(r.project, r.path ?? null);
      if (r.invalidClipIds && r.invalidClipIds.length > 0) {
        useProjectStore.setState({ invalidClipIds: new Set(r.invalidClipIds) });
      }
      if (r.warnings && r.warnings.length > 0) {
        alert(r.warnings.join('\n'));
      }
    } else if (r.error) {
      alert(`Couldn't load project: ${r.error}`);
    }
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
