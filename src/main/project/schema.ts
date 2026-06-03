import { z } from 'zod';
import type { Project, SourceVideo } from '../../shared/types';
import { newSourceId, resolveSource } from '../../shared/resolveSource';

const ZoomRectSchema = z.object({
  x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(),
});
const FocusMarkerPathPointSchema = z.object({
  t: z.number().min(0),
  cx: z.number(),
  cy: z.number(),
});
const FocusMarkerSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  in: z.number().min(0),
  out: z.number().min(0),
  color: z.string().min(1),
  shape: z.enum(['rect', 'oval']).optional(),
  label: z.string().optional(),
  path: z.array(FocusMarkerPathPointSchema).optional(),
  primary: z.boolean().optional(),
});
const ReelPanPointSchema = z.object({
  t: z.number().min(0),
  cx: z.number(),
});
const ReelFramingSchema = z.object({
  panPath: z.array(ReelPanPointSchema),
});
const SourceSchema = z.object({
  path: z.string(),
  duration: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
});
// v2 source-list entries: a SourceMeta plus an id and an optional friendly
// name. Loaders that encounter v1 projects synthesise these on the fly.
const SourceVideoSchema = SourceSchema.extend({
  id: z.string().min(1),
  name: z.string().optional(),
});
const BackingTrackSchema = z.object({
  path: z.string().min(1),
  volume: z.number().min(0).max(1),
  muteSource: z.boolean(),
});
const ClipSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  in: z.number().min(0),
  out: z.number().min(0),
  speed: z.number(),
  zoom: ZoomRectSchema,
  focusMarkers: z.array(FocusMarkerSchema).default([]),
  backingTrack: BackingTrackSchema.optional(),
  brightness: z.number().min(-1).max(1).optional(),
  sourceId: z.string().optional(),
  reelFraming: ReelFramingSchema.optional(),
});
const SequenceEntrySchema = z.object({ clipId: z.string().min(1) });
const BookmarkSchema = z.object({
  id: z.string().min(1),
  time: z.number().min(0),
  label: z.string().optional(),
  createdAt: z.number(),
  sourceId: z.string().optional(),
});
// Project schema accepts v1 (single `sourceVideo`, no `sources`) or v2
// (canonical `sources` array). Both fields are optional at the schema level
// so either shape parses; parseAndClampProject validates that at least one
// is present and migrates to the canonical in-memory representation
// (always both `sourceVideo` and `sources`).
const ProjectSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  sourceVideo: SourceSchema.optional(),
  sources: z.array(SourceVideoSchema).optional(),
  clips: z.array(ClipSchema),
  sequence: z.array(SequenceEntrySchema),
  // Default keeps older project files (saved before bookmarks existed) loadable.
  bookmarks: z.array(BookmarkSchema).default([]),
  sequenceBackingTrack: BackingTrackSchema.optional(),
  sequenceBrightness: z.number().min(-1).max(1).optional(),
});

export interface ParseResult {
  project: Project;
  warnings: string[];
  invalidClipIds: string[];
}

export function parseAndClampProject(raw: unknown): ParseResult {
  const parsed = ProjectSchema.parse(raw);
  const warnings: string[] = [];
  const invalidClipIds: string[] = [];

  // Establish the canonical `sources` array. v1 projects only have
  // `sourceVideo`; lift that into a one-element list with a generated id.
  // v2 projects already have `sources`. Either way the in-memory shape ends
  // up with both fields, so renderer code that says `project.sourceVideo`
  // continues to resolve to the primary source.
  let sources: SourceVideo[];
  if (parsed.sources && parsed.sources.length > 0) {
    sources = parsed.sources;
  } else if (parsed.sourceVideo) {
    sources = [{ id: newSourceId(), ...parsed.sourceVideo }];
  } else {
    throw new Error('Project has neither `sources` nor `sourceVideo`');
  }
  const primary = sources[0]!;

  const sourceById = new Map(sources.map(s => [s.id, s]));

  // Clamp each clip against ITS OWN source's dimensions and duration. A
  // multi-source project has clips whose in/out / zoom / markers reference
  // the source they were cut from — never the project's primary. Unknown
  // sourceId references the primary (back-compat fallback) but the clip
  // gets flagged invalid so the UI can surface it.
  const clips = parsed.clips.map(clip => {
    const next = { ...clip };
    const ownSource = clip.sourceId !== undefined ? sourceById.get(clip.sourceId) : primary;
    const src = ownSource ?? primary;
    if (clip.sourceId !== undefined && !ownSource) {
      warnings.push(`Clip "${clip.name}" references missing source ${clip.sourceId}; falling back to primary source.`);
      invalidClipIds.push(clip.id);
    }
    const sw = src.width;
    const sh = src.height;
    const sd = src.duration;
    if (next.out > sd) {
      warnings.push(`Clip "${clip.name}" out clamped to source duration.`);
      next.out = sd;
    }
    if (next.in < 0) next.in = 0;
    const z = { ...next.zoom };
    if (z.x < 0) z.x = 0;
    if (z.y < 0) z.y = 0;
    if (z.x + z.width > sw) z.width = sw - z.x;
    if (z.y + z.height > sh) z.height = sh - z.y;
    if (z.width > sw) { z.x = 0; z.width = sw; }
    if (z.height > sh) { z.y = 0; z.height = sh; }
    next.zoom = z;
    if (next.speed < 0.25) next.speed = 0.25;
    if (next.speed > 4) next.speed = 4;
    if (next.in >= next.out) invalidClipIds.push(next.id);

    next.focusMarkers = (next.focusMarkers ?? []).map(m => {
      const fm = { ...m };
      if (fm.x < 0) fm.x = 0;
      if (fm.y < 0) fm.y = 0;
      if (fm.x + fm.width > sw) fm.width = Math.max(1, sw - fm.x);
      if (fm.y + fm.height > sh) fm.height = Math.max(1, sh - fm.y);
      if (fm.in < next.in) fm.in = next.in;
      if (fm.out > next.out) fm.out = next.out;
      if (fm.in >= fm.out) { fm.in = next.in; fm.out = next.out; }
      return fm;
    });
    return next;
  });

  // Drop bookmarks whose time fell outside their source's duration. Per-
  // source resolution keeps multi-source bookmarks honest; the legacy path
  // (no sourceId) falls through to the primary source.
  const bookmarks = parsed.bookmarks.filter(b => {
    const ownSource = b.sourceId !== undefined ? sourceById.get(b.sourceId) : primary;
    if (b.sourceId !== undefined && !ownSource) {
      warnings.push(`Bookmark "${b.label ?? ''}" references missing source ${b.sourceId}; dropping.`);
      return false;
    }
    const src = ownSource ?? primary;
    return b.time <= src.duration;
  });

  // The `sourceVideo` mirror is plain SourceMeta — strip the id/name fields
  // that live on SourceVideo so the v1-shape serializer doesn't have to do
  // it later, and so deep-equal comparisons in tests behave intuitively.
  const project: Project = {
    version: parsed.version,
    sourceVideo: {
      path: primary.path,
      duration: primary.duration,
      width: primary.width,
      height: primary.height,
      fps: primary.fps,
    },
    sources,
    clips,
    sequence: parsed.sequence,
    bookmarks,
    sequenceBackingTrack: parsed.sequenceBackingTrack,
    sequenceBrightness: parsed.sequenceBrightness,
  };

  return { project, warnings, invalidClipIds };
}

// Verify the in-memory project as a smoke-test against bad in-memory state
// before save. Currently a no-op pass-through so I/O can refer to it
// symmetrically with parse; left in place so future writer-side validation
// (e.g. "every clip's sourceId resolves") has somewhere to land.
export { resolveSource } from '../../shared/resolveSource';
