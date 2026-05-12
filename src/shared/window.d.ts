import type {
  OpenSourceVideoResult,
  SaveProjectArgs,
  SaveProjectResult,
  LoadProjectResult,
  ExportClipArgs,
  ExportSequenceArgs,
  ExportProgress,
  ExportResult,
  DownloadVeoVideoArgs,
  VeoDownloadProgress,
  VeoDownloadResult,
  LicenceState,
} from './types';

declare global {
  interface Window {
    reelmagic: {
      openSourceVideo: () => Promise<OpenSourceVideoResult>;
      saveProject: (args: SaveProjectArgs) => Promise<SaveProjectResult>;
      loadProject: () => Promise<LoadProjectResult>;
      exportClip: (args: ExportClipArgs) => Promise<ExportResult>;
      exportSequence: (args: ExportSequenceArgs) => Promise<ExportResult>;
      cancelExport: (runId: string) => Promise<{ ok: boolean }>;
      checkPath: (p: string) => Promise<{ exists: boolean }>;
      chooseExportPath: (suggestedName: string) => Promise<{ ok: boolean; path?: string }>;
      chooseOutroFile: () => Promise<{ ok: boolean; path?: string }>;
      chooseBackingTrack: () => Promise<{ ok: boolean; path?: string }>;
      onExportProgress: (cb: (p: ExportProgress) => void) => () => void;
      downloadVeoVideo: (args: DownloadVeoVideoArgs) => Promise<VeoDownloadResult>;
      cancelVeoDownload: (runId: string) => Promise<{ ok: boolean }>;
      onVeoDownloadProgress: (cb: (p: VeoDownloadProgress) => void) => () => void;
      licence: {
        getState: () => Promise<LicenceState>;
        startActivation: () => Promise<void>;
        cancelActivation: () => Promise<void>;
        recheck: () => Promise<void>;
        signOut: () => Promise<void>;
        openAccountPage: () => Promise<void>;
        onChange: (cb: (s: LicenceState) => void) => () => void;
      };
    };
  }
}

export {};
