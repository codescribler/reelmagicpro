import { contextBridge, ipcRenderer } from 'electron';
import type {
  OpenSourceVideoResult, SaveProjectArgs, SaveProjectResult,
  LoadProjectResult, ExportClipArgs, ExportSequenceArgs, ExportProgress, ExportResult,
} from '../shared/types';

contextBridge.exposeInMainWorld('reelmagic', {
  openSourceVideo: (): Promise<OpenSourceVideoResult> =>
    ipcRenderer.invoke('app:openSourceVideo'),
  saveProject: (args: SaveProjectArgs): Promise<SaveProjectResult> =>
    ipcRenderer.invoke('app:saveProject', args),
  loadProject: (): Promise<LoadProjectResult> =>
    ipcRenderer.invoke('app:loadProject'),
  exportClip: (args: ExportClipArgs): Promise<ExportResult> =>
    ipcRenderer.invoke('app:exportClip', args),
  exportSequence: (args: ExportSequenceArgs): Promise<ExportResult> =>
    ipcRenderer.invoke('app:exportSequence', args),
  cancelExport: (runId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:cancelExport', runId),
  checkPath: (p: string): Promise<{ exists: boolean }> => ipcRenderer.invoke('app:checkPath', p),
  onExportProgress: (cb: (p: ExportProgress) => void) => {
    const handler = (_: unknown, p: ExportProgress) => cb(p);
    ipcRenderer.on('app:exportProgress', handler);
    return () => ipcRenderer.removeListener('app:exportProgress', handler);
  },
});
