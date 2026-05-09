import { contextBridge, ipcRenderer } from 'electron';
import type {
  OpenSourceVideoResult, SaveProjectArgs, SaveProjectResult,
  LoadProjectResult, ExportClipArgs, ExportSequenceArgs, ExportProgress, ExportResult,
  DownloadVeoVideoArgs, VeoDownloadProgress, VeoDownloadResult,
  LicenceState,
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
  chooseExportPath: (suggestedName: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('app:chooseExportPath', suggestedName),
  chooseOutroFile: (): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('app:chooseOutroFile'),
  onExportProgress: (cb: (p: ExportProgress) => void) => {
    const handler = (_: unknown, p: ExportProgress) => cb(p);
    ipcRenderer.on('app:exportProgress', handler);
    return () => ipcRenderer.removeListener('app:exportProgress', handler);
  },
  downloadVeoVideo: (args: DownloadVeoVideoArgs): Promise<VeoDownloadResult> =>
    ipcRenderer.invoke('app:downloadVeoVideo', args),
  cancelVeoDownload: (runId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:cancelVeoDownload', runId),
  onVeoDownloadProgress: (cb: (p: VeoDownloadProgress) => void) => {
    const handler = (_: unknown, p: VeoDownloadProgress) => cb(p);
    ipcRenderer.on('app:veoDownloadProgress', handler);
    return () => ipcRenderer.removeListener('app:veoDownloadProgress', handler);
  },
  licence: {
    getState: (): Promise<LicenceState> => ipcRenderer.invoke('app:licence:getState'),
    startActivation: (): Promise<void> =>
      ipcRenderer.invoke('app:licence:startActivation').then(() => undefined),
    cancelActivation: (): Promise<void> =>
      ipcRenderer.invoke('app:licence:cancelActivation').then(() => undefined),
    recheck: (): Promise<void> =>
      ipcRenderer.invoke('app:licence:recheck').then(() => undefined),
    signOut: (): Promise<void> =>
      ipcRenderer.invoke('app:licence:signOut').then(() => undefined),
    openAccountPage: (): Promise<void> =>
      ipcRenderer.invoke('app:licence:openAccountPage').then(() => undefined),
    onChange: (cb: (s: LicenceState) => void) => {
      const handler = (_: unknown, s: LicenceState) => cb(s);
      ipcRenderer.on('app:licence:state', handler);
      return () => ipcRenderer.removeListener('app:licence:state', handler);
    },
  },
});
