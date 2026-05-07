import { create } from 'zustand';
import type { Project, Clip, SourceMeta, SequenceEntry, ZoomRect, FocusMarker, Bookmark, ExportProgress } from '../../shared/types';

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

  setProject: (p: Project | null, path?: string | null) => void;
  setProjectPath: (path: string | null) => void;
  markClean: () => void;
  setSource: (s: SourceMeta) => void;
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

  setProject: (p, path) => set({
    // Normalize on entry so older project files (or a stale main bundle
    // that hasn't picked up the bookmarks schema default yet) can't crash
    // the renderer with `project.bookmarks` being undefined.
    project: p ? { ...p, bookmarks: p.bookmarks ?? [] } : null,
    projectPath: path ?? null, dirty: false,
    selectedClipId: null, previewMode: p ? { kind: 'source' } : { kind: 'idle' },
  }),
  setProjectPath: (path) => set({ projectPath: path }),
  markClean: () => set({ dirty: false }),
  setSource: (s) => set(state => ({
    project: state.project
      ? { ...state.project, sourceVideo: s }
      : { version: 1, sourceVideo: s, clips: [], sequence: [], bookmarks: [] },
    dirty: true,
    previewMode: { kind: 'source' },
  })),
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
