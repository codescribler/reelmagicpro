import { z } from 'zod';
import type { Project } from '../../shared/types';

const ZoomRectSchema = z.object({
  x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(),
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
});
const SequenceEntrySchema = z.object({ clipId: z.string().min(1) });
const ProjectSchema = z.object({
  version: z.literal(1),
  sourceVideo: SourceSchema,
  clips: z.array(ClipSchema),
  sequence: z.array(SequenceEntrySchema),
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
    return next;
  });

  return {
    project: { ...parsed, clips } as Project,
    warnings,
    invalidClipIds,
  };
}
