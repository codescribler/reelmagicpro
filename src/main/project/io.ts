import fs from 'fs/promises';
import type { Project, Clip, Bookmark, SourceMeta } from '../../shared/types';
import { parseAndClampProject, ParseResult } from './schema';
import { projectUsesMultipleSources } from '../../shared/resolveSource';

// Strip the in-memory project down to its file shape. v1 (single
// `sourceVideo`, no `sources`, no per-clip/bookmark `sourceId`s) is used
// when the project has only one source AND nothing references that source
// explicitly — so legacy projects round-trip byte-identically through the
// new code. v2 (`sources` array, `sourceId`s as needed) is used once the
// user adds a second source or any explicit reference exists.
export function serializeProject(project: Project): unknown {
  if (projectUsesMultipleSources(project)) {
    // v2 shape — `sources` is canonical, `sourceVideo` is omitted.
    const clips: Clip[] = project.clips.map(c => ({ ...c }));
    const bookmarks: Bookmark[] = project.bookmarks.map(b => ({ ...b }));
    return {
      version: 2,
      sources: project.sources,
      clips,
      sequence: project.sequence,
      bookmarks,
      sequenceBackingTrack: project.sequenceBackingTrack,
      sequenceBrightness: project.sequenceBrightness,
    };
  }
  // v1 shape — single `sourceVideo`, no `sources`, and crucially strip any
  // `sourceId` fields that might have leaked onto clips/bookmarks at
  // runtime (none should, but defence-in-depth keeps the file format pure
  // when round-tripping).
  const single: SourceMeta = {
    path: project.sourceVideo.path,
    duration: project.sourceVideo.duration,
    width: project.sourceVideo.width,
    height: project.sourceVideo.height,
    fps: project.sourceVideo.fps,
  };
  const clips = project.clips.map(({ sourceId: _drop, ...rest }) => rest);
  const bookmarks = project.bookmarks.map(({ sourceId: _drop, ...rest }) => rest);
  return {
    version: 1,
    sourceVideo: single,
    clips,
    sequence: project.sequence,
    bookmarks,
    sequenceBackingTrack: project.sequenceBackingTrack,
    sequenceBrightness: project.sequenceBrightness,
  };
}

export async function saveProject(project: Project, filePath: string): Promise<void> {
  const json = JSON.stringify(serializeProject(project), null, 2);
  await fs.writeFile(filePath, json, 'utf8');
}

export async function loadProject(filePath: string): Promise<ParseResult> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return parseAndClampProject(parsed);
}
