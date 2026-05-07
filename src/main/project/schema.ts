import { z } from 'zod';
import type { Project } from '../../shared/types';

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
});
const SourceSchema = z.object({
  path: z.string(),
  duration: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
});
const ClipSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  in: z.number().min(0),
  out: z.number().min(0),
  speed: z.number(),
  zoom: ZoomRectSchema,
  focusMarkers: z.array(FocusMarkerSchema).default([]),
});
const SequenceEntrySchema = z.object({ clipId: z.string().min(1) });
const BookmarkSchema = z.object({
  id: z.string().min(1),
  time: z.number().min(0),
  label: z.string().optional(),
  createdAt: z.number(),
});
const ProjectSchema = z.object({
  version: z.literal(1),
  sourceVideo: SourceSchema,
  clips: z.array(ClipSchema),
  sequence: z.array(SequenceEntrySchema),
  // Default keeps older project files (saved before bookmarks existed) loadable.
  bookmarks: z.array(BookmarkSchema).default([]),
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
  const { width: sw, height: sh, duration: sd } = parsed.sourceVideo;

  const clips = parsed.clips.map(clip => {
    const next = { ...clip };
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

  // Drop bookmarks whose time fell outside the source duration on load.
  const bookmarks = parsed.bookmarks.filter(b => b.time <= sd);

  return {
    project: { ...parsed, clips, bookmarks } as Project,
    warnings,
    invalidClipIds,
  };
}
