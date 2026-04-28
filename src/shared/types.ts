export interface SourceMeta {
  path: string;
  duration: number; // seconds
  width: number;
  height: number;
  fps: number;
}

export interface ZoomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Clip {
  id: string;
  name: string;
  in: number;
  out: number;
  speed: number;
  zoom: ZoomRect;
}

export interface SequenceEntry {
  clipId: string;
}

export interface Project {
  version: 1;
  sourceVideo: SourceMeta;
  clips: Clip[];
  sequence: SequenceEntry[];
}

export type ExportPhase = 'rendering-part' | 'concatenating' | 'done' | 'error';

export interface ExportProgress {
  runId: string;
  phase: ExportPhase;
  currentItem: number; // 1-based
  totalItems: number;
  percent: number;     // 0–100 overall
  message?: string;
}

export interface ExportResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
}

export type IpcChannel =
  | 'app:openSourceVideo'
  | 'app:saveProject'
  | 'app:loadProject'
  | 'app:exportClip'
  | 'app:exportSequence'
  | 'app:cancelExport'
  | 'app:exportProgress'; // main → renderer

export interface OpenSourceVideoResult { source: SourceMeta | null; error?: string; }
export interface SaveProjectArgs { project: Project; suggestedPath?: string; }
export interface SaveProjectResult { ok: boolean; path?: string; error?: string; }
export interface LoadProjectResult {
  ok: boolean;
  path?: string;
  project?: Project;
  warnings?: string[];
  invalidClipIds?: string[];
  error?: string;
}
export interface ExportClipArgs { runId: string; clip: Clip; source: SourceMeta; outputPath: string; }
export interface ExportSequenceArgs {
  runId: string; clips: Clip[]; sequence: SequenceEntry[]; source: SourceMeta; outputPath: string;
}
