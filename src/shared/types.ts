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
