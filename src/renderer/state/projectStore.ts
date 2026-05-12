import { create } from 'zustand';
import type { Project, Clip, SourceMeta, SourceVideo, SequenceEntry, ZoomRect, FocusMarker, Bookmark, ExportProgress, BackingTrack } from '../../shared/types';
import { newSourceId, resolveSource } from '../../shared/resolveSource';

// Strip a SourceVideo down to the plain SourceMeta fields used by the
// in-memory `project.sourceVideo` mirror. Matches parseAndClampProject's
// behaviour so the in-memory shape is consistent regardless of whether the
// project was loaded from disk or built up by the store actions below.
function toSourceMeta(sv: { path: string; duration: number; width: number; height: number; fps: number }): SourceMeta {
  return {
    path: sv.path, duration: sv.duration,
    width: sv.width, height: sv.height, fps: sv.fps,
  };
}

export type PreviewMode =
  | { kind: 'idle' }
  | { kind: 'source' }
  | { kind: 'clip'; clipId: string }
  | { kind: 'sequence'; index: number }
  | { kind: 'set-zoom'; clipId: string }
  | { kind: 'track-marker'; clipId: string; markerId: string };

interface State {
  project: Project | null;
  projectPath: string | null;
  dirty: boolean;
  selectedClipId: string | null;
  previewMode: PreviewMode;
  invalidClipIds: Set<string>;

  // Bumped each time a clip is added. Subscribed to by App / ClipDetail to
  // play a brief "look here" animation on the right panel and the export
  // button so the just-created clip doesn't land silently in the corner.
  clipCreatedToken: number;
  // Bumped each time a clip is appended to the sequence. Drives a flash on
  // the sequence bar so the user sees their clip land there — important
  // because the bar lives at the bottom of the screen, far from where they
  // clicked the button on the right panel.
  sequenceAppendToken: number;

  // Which source is currently loaded into the preview / timeline. Always
  // points to a source in the project's sources array (or null when no
  // project is open). Used by Phase-2 UI to pick which video the <video>
  // element should load and which source's clips / bookmarks belong to the
  // timeline at any moment.
  activeSourceId: string | null;

  setProject: (p: Project | null, path?: string | null) => void;
  setProjectPath: (path: string | null) => void;
  markClean: () => void;
  setSource: (s: SourceMeta) => void;
  addSource: (s: SourceMeta, opts?: { name?: string }) => string;
  removeSource: (sourceId: string, opts?: { cascade?: boolean }) => { ok: boolean; reason?: string };
  renameSource: (sourceId: string, name: string) => void;
  reorderSources: (from: number, to: number) => void;
  setActiveSourceId: (sourceId: string) => void;
  addClip: (clip: Clip) => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  deleteClip: (id: string) => void;
  duplicateClip: (id: string) => string | null;
  selectClip: (id: string | null) => void;
  viewSource: () => void;
  setPreviewMode: (m: PreviewMode) => void;
  replayToken: number;
  replayClip: () => void;
  appendToSequence: (clipId: string) => void;
  reorderSequence: (from: number, to: number) => void;
  removeFromSequence: (index: number) => void;
  clearSequence: () => void;
  setSequenceBackingTrack: (track: BackingTrack | undefined) => void;
  setSequenceBrightness: (value: number | undefined) => void;

  // Fine-grained adjustment of a clip's in or out point. Deltas come in as
  // seconds; the action clamps against source bounds, the opposite endpoint
  // (with a minimum clip length so the clip can't collapse), and pulls any
  // focus markers inward so they stay within the new clip range. After
  // moving the boundary the preview seeks to it and pauses, so the user
  // sees the exact frame they just landed on.
  nudgeClipBoundary: (clipId: string, which: 'in' | 'out', deltaSec: number) => void;

  addFocusMarker: (clipId: string, marker: FocusMarker) => void;
  updateFocusMarker: (clipId: string, markerId: string, patch: Partial<FocusMarker>) => void;
  deleteFocusMarker: (clipId: string, markerId: string) => void;
  togglePrimaryMarker: (clipId: string, markerId: string) => void;

  addBookmark: (time: number) => void;
  updateBookmark: (id: string, patch: Partial<Bookmark>) => void;
  deleteBookmark: (id: string) => void;

  // Token-based seek request: incrementing the token tells Preview to jump
  // the video element to `time`. Bookmark click and skip-to-bookmark go
  // through here so we can also force the preview into source mode.
  seekRequest: { time: number; token: number } | null;
  requestSeek: (time: number) => void;

  // Token-based relative skip. Lets the clip editor and the preview overlay
  // share one mechanism for ±5s nudges without each owning its own video ref.
  skipRequest: { delta: number; token: number } | null;
  requestSkip: (delta: number) => void;

  // Token-based pause. Used by the timeline's "Set out (from preview)" button
  // so the user doesn't blow past the moment they just marked.
  pauseRequest: { token: number } | null;
  requestPause: () => void;

  activeRun: { runId: string; phase: ExportProgress['phase']; percent: number; currentItem: number; totalItems: number } | null;
  exportResult: { ok: boolean; outputPath?: string; error?: string } | null;
  startRun: (runId: string) => void;
  setProgress: (p: ExportProgress) => void;
  setExportResult: (r: { ok: boolean; outputPath?: string; error?: string } | null) => void;
  clearRun: () => void;
}

function newId(): string {
  return 'clip_' + Math.random().toString(36).slice(2, 10);
}

function newMarkerId(): string {
  return 'fm_' + Math.random().toString(36).slice(2, 10);
}

function newBookmarkId(): string {
  return 'bm_' + Math.random().toString(36).slice(2, 10);
}

export const useProjectStore = create<State>((set, get) => ({
  project: null,
  projectPath: null,
  dirty: false,
  selectedClipId: null,
  previewMode: { kind: 'idle' },
  invalidClipIds: new Set(),
  clipCreatedToken: 0,
  sequenceAppendToken: 0,
  activeSourceId: null,

  setProject: (p, path) => set({
    // Normalize on entry so older project files (or a stale main bundle
    // that hasn't picked up the bookmarks schema default yet) can't crash
    // the renderer with `project.bookmarks` being undefined.
    project: p ? { ...p, bookmarks: p.bookmarks ?? [] } : null,
    projectPath: path ?? null, dirty: false,
    selectedClipId: null, previewMode: p ? { kind: 'source' } : { kind: 'idle' },
    activeSourceId: p?.sources[0]?.id ?? null,
  }),
  setProjectPath: (path) => set({ projectPath: path }),
  markClean: () => set({ dirty: false }),
  // First-source / replace-source entry point used by the empty-state CTA
  // and the Open-video menu item. Creates a fresh project when none exists,
  // or replaces the sole source when one does. To ADD a second source to an
  // existing project, callers should use addSource() instead — set up in
  // Phase 2's UI.
  setSource: (s) => set(state => {
    const id = newSourceId();
    const newSource: SourceVideo = { id, ...s };
    if (!state.project) {
      return {
        project: {
          version: 1,
          sourceVideo: s,
          sources: [newSource],
          clips: [], sequence: [], bookmarks: [],
        },
        dirty: true,
        previewMode: { kind: 'source' },
        activeSourceId: id,
      };
    }
    // Existing project: replace the primary source (and its sources[0]) but
    // keep clips / bookmarks / sequence intact. This matches pre-Phase-1
    // behaviour where "open a video" with a project already in place
    // swapped the underlying file. Phase 2's UI will route any "add another
    // video" affordance through addSource() instead so this code path
    // really does mean "replace."
    return {
      project: {
        ...state.project,
        sourceVideo: s,
        sources: [newSource, ...state.project.sources.slice(1)],
      },
      dirty: true,
      previewMode: { kind: 'source' },
      activeSourceId: id,
    };
  }),

  addSource: (s, opts) => {
    const id = newSourceId();
    const sv: SourceVideo = { id, ...s, ...(opts?.name ? { name: opts.name } : {}) };
    set(state => {
      if (!state.project) {
        return {
          project: {
            version: 1,
            sourceVideo: s,
            sources: [sv],
            clips: [], sequence: [], bookmarks: [],
          },
          dirty: true,
          previewMode: { kind: 'source' },
          activeSourceId: id,
        };
      }
      const sources = [...state.project.sources, sv];
      return {
        project: { ...state.project, sources },
        dirty: true,
        // Switch the preview to the freshly-added source — matches the user
        // expectation that "I just imported this video, I want to see it."
        previewMode: { kind: 'source' },
        activeSourceId: id,
        selectedClipId: null,
      };
    });
    return id;
  },

  removeSource: (sourceId, opts) => {
    const state = get();
    if (!state.project) return { ok: false, reason: 'no_project' };
    const sources = state.project.sources;
    if (sources.length <= 1) return { ok: false, reason: 'last_source' };
    const idx = sources.findIndex(s => s.id === sourceId);
    if (idx < 0) return { ok: false, reason: 'unknown' };
    const usedByClips = state.project.clips.some(c =>
      (c.sourceId ?? sources[0]!.id) === sourceId
    );
    const usedByBookmarks = state.project.bookmarks.some(b =>
      (b.sourceId ?? sources[0]!.id) === sourceId
    );
    if ((usedByClips || usedByBookmarks) && !opts?.cascade) {
      return { ok: false, reason: 'in_use' };
    }
    set(s => {
      if (!s.project) return s;
      const nextSources = s.project.sources.filter(src => src.id !== sourceId);
      const removedClipIds = new Set(
        s.project.clips
          .filter(c => (c.sourceId ?? s.project!.sources[0]!.id) === sourceId)
          .map(c => c.id),
      );
      const clips = s.project.clips.filter(c => !removedClipIds.has(c.id));
      const bookmarks = s.project.bookmarks.filter(b =>
        (b.sourceId ?? s.project!.sources[0]!.id) !== sourceId
      );
      const sequence = s.project.sequence.filter(e => !removedClipIds.has(e.clipId));
      const newPrimary = nextSources[0]!;
      const nextActive = s.activeSourceId === sourceId ? newPrimary.id : s.activeSourceId;
      return {
        project: {
          ...s.project,
          sourceVideo: toSourceMeta(newPrimary),
          sources: nextSources,
          clips, bookmarks, sequence,
        },
        activeSourceId: nextActive,
        selectedClipId: s.selectedClipId && removedClipIds.has(s.selectedClipId)
          ? null : s.selectedClipId,
        dirty: true,
      };
    });
    return { ok: true };
  },

  renameSource: (sourceId, name) => set(state => {
    if (!state.project) return state;
    const trimmed = name.trim();
    return {
      project: {
        ...state.project,
        sources: state.project.sources.map(src =>
          src.id === sourceId
            ? (trimmed ? { ...src, name: trimmed } : (() => {
                const { name: _drop, ...rest } = src; return rest;
              })())
            : src
        ),
      },
      dirty: true,
    };
  }),

  reorderSources: (from, to) => set(state => {
    if (!state.project) return state;
    const sources = [...state.project.sources];
    if (from < 0 || from >= sources.length || to < 0 || to >= sources.length) return state;
    const [moved] = sources.splice(from, 1);
    if (moved) sources.splice(to, 0, moved);
    // Reordering can change which source is sources[0], the implicit
    // default. Update sourceVideo to match so renderer reads stay
    // consistent.
    return {
      project: { ...state.project, sources, sourceVideo: toSourceMeta(sources[0]!) },
      dirty: true,
    };
  }),

  setActiveSourceId: (sourceId) => set(state => {
    if (!state.project) return state;
    if (!state.project.sources.some(s => s.id === sourceId)) return state;
    return {
      activeSourceId: sourceId,
      // Switching sources implicitly returns to source-mode playback for
      // that source. Selected clip is cleared so the editor doesn't keep
      // showing a clip from a different source.
      selectedClipId: null,
      previewMode: { kind: 'source' },
    };
  }),
  addClip: (clip) => set(state => state.project ? ({
    project: { ...state.project, clips: [...state.project.clips, clip] },
    dirty: true,
    clipCreatedToken: state.clipCreatedToken + 1,
  }) : state),
  updateClip: (id, patch) => set(state => state.project ? ({
    project: { ...state.project, clips: state.project.clips.map(c => c.id === id ? { ...c, ...patch } : c) },
    dirty: true,
  }) : state),
  deleteClip: (id) => set(state => {
    if (!state.project) return state;
    const newSequence = state.project.sequence.filter(e => e.clipId !== id);
    const oldEntry = state.project.sequence[
      state.previewMode.kind === 'sequence' ? state.previewMode.index : -1
    ];
    const sequenceWasPlayingDeletedClip =
      state.previewMode.kind === 'sequence' && oldEntry?.clipId === id;

    let nextPreviewMode = state.previewMode;
    if (
      (state.previewMode.kind === 'clip'
        || state.previewMode.kind === 'set-zoom'
        || state.previewMode.kind === 'track-marker')
      && state.previewMode.clipId === id
    ) {
      nextPreviewMode = { kind: 'source' };
    } else if (sequenceWasPlayingDeletedClip) {
      nextPreviewMode = { kind: 'source' };
    }

    return {
      project: { ...state.project, clips: state.project.clips.filter(c => c.id !== id), sequence: newSequence },
      selectedClipId: state.selectedClipId === id ? null : state.selectedClipId,
      previewMode: nextPreviewMode,
      dirty: true,
    };
  }) ,
  duplicateClip: (id) => {
    const proj = get().project;
    if (!proj) return null;
    const orig = proj.clips.find(c => c.id === id);
    if (!orig) return null;
    const copy: Clip = {
      ...orig,
      id: newId(),
      name: `${orig.name} (copy)`,
      zoom: { ...orig.zoom },
      focusMarkers: orig.focusMarkers.map(m => ({ ...m, id: newMarkerId() })),
    };
    set({
      project: { ...proj, clips: [...proj.clips, copy] },
      dirty: true,
    });
    return copy.id;
  },
  selectClip: (id) => set({ selectedClipId: id, previewMode: id ? { kind: 'clip', clipId: id } : { kind: 'source' } }),
  viewSource: () => set({ selectedClipId: null, previewMode: { kind: 'source' } }),
  setPreviewMode: (m) => set({ previewMode: m }),
  replayToken: 0,
  replayClip: () => set(state => ({ replayToken: state.replayToken + 1 })),
  appendToSequence: (clipId) => set(state => state.project ? ({
    project: { ...state.project, sequence: [...state.project.sequence, { clipId }] },
    dirty: true,
    sequenceAppendToken: state.sequenceAppendToken + 1,
  }) : state),
  reorderSequence: (from, to) => set(state => {
    if (!state.project) return state;
    const seq = [...state.project.sequence];
    const [moved] = seq.splice(from, 1);
    if (moved) seq.splice(to, 0, moved);
    return { project: { ...state.project, sequence: seq }, dirty: true };
  }),
  removeFromSequence: (index) => set(state => {
    if (!state.project) return state;
    const seq = state.project.sequence.filter((_, i) => i !== index);
    return { project: { ...state.project, sequence: seq }, dirty: true };
  }),
  clearSequence: () => set(state => {
    if (!state.project) return state;
    if (state.project.sequence.length === 0) return state;
    // If the preview is currently playing this sequence, drop back to source
    // so we don't keep a now-invalid index in previewMode.
    const nextPreviewMode = state.previewMode.kind === 'sequence'
      ? { kind: 'source' as const }
      : state.previewMode;
    return {
      project: { ...state.project, sequence: [] },
      previewMode: nextPreviewMode,
      dirty: true,
    };
  }),
  setSequenceBackingTrack: (track) => set(state => {
    if (!state.project) return state;
    const project = { ...state.project };
    if (track) project.sequenceBackingTrack = track;
    else delete project.sequenceBackingTrack;
    return { project, dirty: true };
  }),
  setSequenceBrightness: (value) => set(state => {
    if (!state.project) return state;
    const project = { ...state.project };
    // Strip the field when set back to 0 / undefined so the saved project
    // file stays minimal — same pattern as togglePrimaryMarker.
    if (value === undefined || Math.abs(value) < 0.001) {
      delete project.sequenceBrightness;
    } else {
      project.sequenceBrightness = value;
    }
    return { project, dirty: true };
  }),

  nudgeClipBoundary: (clipId, which, deltaSec) => set(state => {
    if (!state.project) return state;
    const clip = state.project.clips.find(c => c.id === clipId);
    if (!clip) return state;
    const dur = state.project.sourceVideo.duration;
    const MIN_LEN = 0.05;
    let newIn = clip.in;
    let newOut = clip.out;
    if (which === 'in') {
      newIn = Math.max(0, Math.min(clip.out - MIN_LEN, clip.in + deltaSec));
      if (newIn === clip.in) return state;
    } else {
      newOut = Math.max(clip.in + MIN_LEN, Math.min(dur, clip.out + deltaSec));
      if (newOut === clip.out) return state;
    }
    // Pull markers back inside the (possibly tightened) clip range. If a
    // marker's window collapses completely, fall back to the full clip
    // range so it stays valid rather than vanishing silently.
    const focusMarkers = clip.focusMarkers.map(m => {
      let mIn = m.in;
      let mOut = m.out;
      if (mIn < newIn) mIn = newIn;
      if (mOut > newOut) mOut = newOut;
      if (mIn >= mOut) { mIn = newIn; mOut = newOut; }
      return { ...m, in: mIn, out: mOut };
    });
    const seekTime = which === 'in' ? newIn : newOut;
    return {
      project: {
        ...state.project,
        clips: state.project.clips.map(c =>
          c.id === clipId ? { ...c, in: newIn, out: newOut, focusMarkers } : c
        ),
      },
      dirty: true,
      // Seek + pause so the user sees the exact frame at the new boundary
      // without leaving clip mode (don't go through requestSeek — that one
      // deselects the clip).
      seekRequest: { time: seekTime, token: (state.seekRequest?.token ?? 0) + 1 },
      pauseRequest: { token: (state.pauseRequest?.token ?? 0) + 1 },
    };
  }),

  addFocusMarker: (clipId, marker) => set(state => state.project ? ({
    project: {
      ...state.project,
      clips: state.project.clips.map(c =>
        c.id === clipId ? { ...c, focusMarkers: [...c.focusMarkers, marker] } : c
      ),
    },
    dirty: true,
  }) : state),
  updateFocusMarker: (clipId, markerId, patch) => set(state => state.project ? ({
    project: {
      ...state.project,
      clips: state.project.clips.map(c =>
        c.id === clipId
          ? { ...c, focusMarkers: c.focusMarkers.map(m => m.id === markerId ? { ...m, ...patch } : m) }
          : c
      ),
    },
    dirty: true,
  }) : state),
  togglePrimaryMarker: (clipId, markerId) => set(state => {
    if (!state.project) return state;
    const clips = state.project.clips.map(c => {
      if (c.id !== clipId) return c;
      const target = c.focusMarkers.find(m => m.id === markerId);
      if (!target) return c;
      const willBePrimary = !target.primary;
      // Strip primary cleanly rather than writing `primary: false` so the
      // saved project file stays minimal.
      const focusMarkers = c.focusMarkers.map(m => {
        const next: FocusMarker = { ...m };
        delete next.primary;
        if (m.id === markerId && willBePrimary) next.primary = true;
        return next;
      });
      return { ...c, focusMarkers };
    });
    return { project: { ...state.project, clips }, dirty: true };
  }),
  deleteFocusMarker: (clipId, markerId) => set(state => {
    if (!state.project) return state;
    let nextMode = state.previewMode;
    if (state.previewMode.kind === 'track-marker' && state.previewMode.markerId === markerId) {
      nextMode = { kind: 'clip', clipId };
    }
    return {
      project: {
        ...state.project,
        clips: state.project.clips.map(c =>
          c.id === clipId
            ? { ...c, focusMarkers: c.focusMarkers.filter(m => m.id !== markerId) }
            : c
        ),
      },
      previewMode: nextMode,
      dirty: true,
    };
  }),

  addBookmark: (time) => set(state => state.project ? ({
    project: {
      ...state.project,
      bookmarks: [
        ...state.project.bookmarks,
        { id: newBookmarkId(), time: Math.max(0, time), createdAt: Date.now() },
      ],
    },
    dirty: true,
  }) : state),
  updateBookmark: (id, patch) => set(state => state.project ? ({
    project: {
      ...state.project,
      bookmarks: state.project.bookmarks.map(b => b.id === id ? { ...b, ...patch } : b),
    },
    dirty: true,
  }) : state),
  deleteBookmark: (id) => set(state => state.project ? ({
    project: { ...state.project, bookmarks: state.project.bookmarks.filter(b => b.id !== id) },
    dirty: true,
  }) : state),

  seekRequest: null,
  requestSeek: (time) => set(state => ({
    selectedClipId: null,
    previewMode: { kind: 'source' },
    seekRequest: { time: Math.max(0, time), token: (state.seekRequest?.token ?? 0) + 1 },
  })),

  skipRequest: null,
  requestSkip: (delta) => set(state => ({
    skipRequest: { delta, token: (state.skipRequest?.token ?? 0) + 1 },
  })),

  pauseRequest: null,
  requestPause: () => set(state => ({
    pauseRequest: { token: (state.pauseRequest?.token ?? 0) + 1 },
  })),

  activeRun: null,
  exportResult: null,
  startRun: (runId) => set({ activeRun: { runId, phase: 'rendering-part', percent: 0, currentItem: 1, totalItems: 1 }, exportResult: null }),
  setProgress: (p) => set(state => state.activeRun && state.activeRun.runId === p.runId
    ? { activeRun: { ...state.activeRun, ...p } } : state),
  setExportResult: (r) => set({ exportResult: r }),
  clearRun: () => set({ activeRun: null, exportResult: null }),
}));
