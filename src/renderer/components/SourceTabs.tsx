import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { sourceColour, sourceDisplayName } from '../lib/sourceColors';

// Horizontal tab strip across the top of the right panel — one tab per
// source video in the project, plus a `+ Add video` button. Switching the
// active source rewrites everything downstream (preview, timeline, clip
// list, bookmark list) to the chosen source's space.
//
// Double-click a tab to rename it; the × on each tab (revealed on hover,
// only when there's more than one source so the parent can never delete
// their last match by accident) opens a cascade-confirm flow before
// removing.
export function SourceTabs({ onAddVideo }: { onAddVideo: () => void }) {
  const project = useProjectStore(s => s.project);
  const activeSourceId = useProjectStore(s => s.activeSourceId);
  const setActiveSourceId = useProjectStore(s => s.setActiveSourceId);
  const renameSource = useProjectStore(s => s.renameSource);
  const removeSource = useProjectStore(s => s.removeSource);

  if (!project || project.sources.length === 0) return null;

  return (
    <div className="source-tabs" role="tablist" aria-label="Source videos">
      {/* The pill is set apart from the tabs visually — it's an action
          ("add"), not a tab ("switch to"). Always-visible so the
          multi-source feature is discoverable even from the empty state. */}
      <button
        className="source-tab-add"
        onClick={onAddVideo}
        title="Add another video to this project">
        + Add video
      </button>
      {project.sources.map((src) => (
        <SourceTab
          key={src.id}
          sourceId={src.id}
          name={sourceDisplayName(src)}
          colour={sourceColour(project, src.id)}
          active={src.id === activeSourceId}
          canRemove={project.sources.length > 1}
          onActivate={() => setActiveSourceId(src.id)}
          onRename={(n) => renameSource(src.id, n)}
          onRemove={() => handleRemove(src.id)}
        />
      ))}
    </div>
  );

  function handleRemove(sourceId: string) {
    if (!project) return;
    const src = project.sources.find(s => s.id === sourceId);
    if (!src) return;
    const clipCount = project.clips.filter(c =>
      (c.sourceId ?? project.sources[0]!.id) === sourceId
    ).length;
    const bookmarkCount = project.bookmarks.filter(b =>
      (b.sourceId ?? project.sources[0]!.id) === sourceId
    ).length;
    const parts: string[] = [];
    if (clipCount > 0) parts.push(`${clipCount} clip${clipCount === 1 ? '' : 's'}`);
    if (bookmarkCount > 0) parts.push(`${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'}`);
    const tail = parts.length
      ? `\n\n${parts.join(' and ')} will be removed.`
      : '';
    const ok = window.confirm(
      `Remove "${sourceDisplayName(src)}" from this project?${tail}`,
    );
    if (!ok) return;
    const result = removeSource(sourceId, { cascade: true });
    if (!result.ok) {
      // The action only refuses when there's just one source left, which
      // the canRemove check already prevents from reaching here. Surface
      // anything else as an alert so it doesn't disappear silently.
      if (result.reason !== 'last_source') {
        alert(`Couldn't remove source: ${result.reason ?? 'unknown reason'}`);
      }
    }
  }
}

function SourceTab({
  sourceId, name, colour, active, canRemove,
  onActivate, onRename, onRemove,
}: {
  sourceId: string;
  name: string;
  colour: string;
  active: boolean;
  canRemove: boolean;
  onActivate: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      // Defer one frame so the input is in the DOM before we try to focus.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    else setDraft(name); // revert if blank or unchanged
  }
  function cancel() {
    setEditing(false);
    setDraft(name);
  }

  return (
    <div
      role="tab"
      aria-selected={active}
      className={`source-tab${active ? ' is-active' : ''}`}
      // Apply the source's colour as the tab's top-border accent. Active
      // tabs get a brighter version (CSS) and the colour band is what
      // visually ties a tab to its clip-row / sequence-chip stripes.
      style={{ borderTopColor: colour }}
      onClick={() => { if (!editing) onActivate(); }}
      onDoubleClick={() => { setDraft(name); setEditing(true); }}
      title={editing ? '' : `${name} — click to switch, double-click to rename`}>
      {editing ? (
        <input
          ref={inputRef}
          className="source-tab-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
        />
      ) : (
        <span className="source-tab-label">{name}</span>
      )}
      {canRemove && !editing && (
        <button
          className="source-tab-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove this source from the project"
          aria-label={`Remove ${name}`}>
          ×
        </button>
      )}
    </div>
  );
}
