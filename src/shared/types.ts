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

export interface FocusMarkerPathPoint {
  t: number;   // clip-relative seconds (0 = clip.in)
  cx: number;  // centre x in source pixels
  cy: number;  // centre y in source pixels
}

export interface FocusMarker {
  id: string;
  x: number;       // top-left in source pixels (used when path is empty)
  y: number;
  width: number;
  height: number;
  in: number;      // source-time seconds (within [clip.in, clip.out])
  out: number;
  color: string;   // ffmpeg/CSS colour name, e.g. 'yellow'
  // Outline shape. Defaults to 'rect' when undefined for back-compat with
  // projects saved before ovals existed.
  shape?: 'rect' | 'oval';
  label?: string;  // optional caption rendered under the box (preview + export)
  // Optional motion track. When present, the marker's centre is interpolated
  // along this path; x/y above are ignored. The list is sorted by t ascending.
  // Times are clip-relative (t=0 corresponds to clip.in).
  path?: FocusMarkerPathPoint[];
  // Optional flag identifying this marker as the driver for Instagram-format
  // export framing on multi-marker clips. At most one marker per clip should
  // have this set. When no marker is flagged, IG framing falls back to the
  // first marker.
  primary?: boolean;
}

export interface Clip {
  id: string;
  name: string;
  in: number;
  out: number;
  speed: number;
  zoom: ZoomRect;
  focusMarkers: FocusMarker[];
}

export interface SequenceEntry {
  clipId: string;
}

export interface Bookmark {
  id: string;
  time: number;       // source-time seconds
  label?: string;     // optional user-given name
  createdAt: number;  // ms epoch — used for stable ordering of same-time bookmarks
}

export interface Project {
  version: 1;
  sourceVideo: SourceMeta;
  clips: Clip[];
  sequence: SequenceEntry[];
  bookmarks: Bookmark[];
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
// Optional outro to append to every exported video. Centred on the source-
// resolution canvas, padded with black around it, and audio (if present)
// re-encoded so the concat demuxer accepts the part stream-copied.
export interface OutroSpec {
  path: string;
}

export interface ExportClipArgs {
  runId: string; clip: Clip; source: SourceMeta; outputPath: string;
  outro?: OutroSpec;
}
export interface ExportSequenceArgs {
  runId: string; clips: Clip[]; sequence: SequenceEntry[]; source: SourceMeta; outputPath: string;
  outro?: OutroSpec;
}
