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
  onExportProgress: (cb: (p: ExportProgress) => void) => {
    const handler = (_: unknown, p: ExportProgress) => cb(p);
    ipcRenderer.on('app:exportProgress', handler);
    return () => ipcRenderer.removeListener('app:exportProgress', handler);
  },
});

declare global {
  interface Window {
    reelmagic: {
      openSourceVideo: () => Promise<OpenSourceVideoResult>;
      saveProject: (args: SaveProjectArgs) => Promise<SaveProjectResult>;
      loadProject: () => Promise<LoadProjectResult>;
      exportClip: (args: ExportClipArgs) => Promise<ExportResult>;
      exportSequence: (args: ExportSequenceArgs) => Promise<ExportResult>;
      cancelExport: (runId: string) => Promise<{ ok: boolean }>;
      onExportProgress: (cb: (p: ExportProgress) => void) => () => void;
    };
  }
}
