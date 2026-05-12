import type { Project, SourceVideo, Clip, Bookmark } from './types';

// Resolve the source video referenced by an id. Undefined / unknown ids
// fall back to the first source — same rule used everywhere a clip,
// bookmark, or sequence entry needs to find its underlying video. The
// fallback keeps legacy single-source projects working without any data
// migration on the consumer side: every existing clip/bookmark lacks a
// `sourceId`, and they all want `sources[0]`.
export function resolveSource(
  project: Pick<Project, 'sources'>,
  sourceId?: string,
): SourceVideo | null {
  if (project.sources.length === 0) return null;
  if (sourceId !== undefined) {
    const hit = project.sources.find(s => s.id === sourceId);
    if (hit) return hit;
  }
  return project.sources[0] ?? null;
}

export function resolveSourceForClip(project: Pick<Project, 'sources'>, clip: Clip): SourceVideo | null {
  return resolveSource(project, clip.sourceId);
}

export function resolveSourceForBookmark(project: Pick<Project, 'sources'>, bookmark: Bookmark): SourceVideo | null {
  return resolveSource(project, bookmark.sourceId);
}

// Whether the project has any multi-source usage — additional sources OR
// explicit sourceId references on any clip or bookmark. Used by the project
// serializer to decide between writing the file in v1 (single-source) or v2
// (multi-source) shape, so single-source users' .rmproj files stay
// byte-identical when they round-trip through the new code.
export function projectUsesMultipleSources(project: Pick<Project, 'sources' | 'clips' | 'bookmarks'>): boolean {
  if (project.sources.length > 1) return true;
  if (project.clips.some(c => c.sourceId !== undefined)) return true;
  if (project.bookmarks.some(b => b.sourceId !== undefined)) return true;
  return false;
}

// Generate a stable, URL-safe id for a new source. Same shape as clip /
// bookmark / focus-marker ids elsewhere in the codebase.
export function newSourceId(): string {
  return 'src_' + Math.random().toString(36).slice(2, 10);
}
