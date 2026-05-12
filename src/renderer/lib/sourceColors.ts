// Per-source colour assignment used by every UI surface that signals which
// source a clip / bookmark / sequence chip belongs to. Source 0 ALWAYS uses
// the brand accent — that way a single-source project carries no new colour
// information, and existing users notice nothing when they upgrade. Sources
// 2+ cycle through a small palette of distinct, accessibility-readable hues
// that don't collide with the focus-marker palette's reds and yellows
// (which already signal warnings inside the preview area).
const SOURCE_COLOURS = [
  'var(--accent)',   // source 0 — brand lime
  '#5ed3ff',         // source 1 — cyan
  '#ff5ed3',         // source 2 — magenta
  '#ff9c4a',         // source 3 — orange
  '#a78bfa',         // source 4 — violet
  '#fde047',         // source 5 — amber
];

// Resolve the colour for a given source id within a project. Returns the
// brand accent for unknown ids — keeps the UI from going blank if a clip's
// sourceId got out of sync (rather than throwing, the row just looks like a
// primary-source row).
export function sourceColour(
  project: { sources: { id: string }[] } | null | undefined,
  sourceId: string | undefined,
): string {
  if (!project || project.sources.length === 0) return SOURCE_COLOURS[0]!;
  const resolvedId = sourceId ?? project.sources[0]!.id;
  const idx = project.sources.findIndex(s => s.id === resolvedId);
  if (idx < 0) return SOURCE_COLOURS[0]!;
  return SOURCE_COLOURS[idx % SOURCE_COLOURS.length]!;
}

// Friendly display name for a source. The user-provided `name` wins; falls
// back to the file basename (stripped of extension) when the user hasn't
// renamed it. Used by the tab strip and the timeline's "Source: ..." label.
export function sourceDisplayName(source: { path: string; name?: string }): string {
  if (source.name && source.name.trim()) return source.name.trim();
  const base = source.path.split(/[\\/]/).pop() ?? source.path;
  // Strip the trailing .ext if there is one — keeps tab labels short.
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}
