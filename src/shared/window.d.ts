import type {
  OpenSourceVideoResult,
  SaveProjectArgs,
  SaveProjectResult,
  LoadProjectResult,
  ExportClipArgs,
  ExportSequenceArgs,
  ExportProgress,
  ExportResult,
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
      onExportProgress: (cb: (p: ExportProgress) => void) => () => void;
    };
  }
}

export {};
