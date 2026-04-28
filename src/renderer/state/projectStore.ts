import { create } from 'zustand';
import type { Project, Clip, SourceMeta, SequenceEntry, ZoomRect, ExportProgress } from '../../shared/types';

export type PreviewMode =
  | { kind: 'idle' }
  | { kind: 'source' }
  | { kind: 'clip'; clipId: string }
  | { kind: 'sequence'; index: number }
  | { kind: 'set-zoom'; clipId: string };

interface State {
  project: Project | null;
  projectPath: string | null;
  dirty: boolean;
  selectedClipId: string | null;
  previewMode: PreviewMode;
  invalidClipIds: Set<string>;

  setProject: (p: Project | null, path?: string | null) => void;
  setProjectPath: (path: string | null) => void;
  markClean: () => void;
  setSource: (s: SourceMeta) => void;
  addClip: (clip: Clip) => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  deleteClip: (id: string) => void;
  duplicateClip: (id: string) => string | null;
  selectClip: (id: string | null) => void;
  setPreviewMode: (m: PreviewMode) => void;
  appendToSequence: (clipId: string) => void;
  reorderSequence: (from: number, to: number) => void;
  removeFromSequence: (index: number) => void;

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

export const useProjectStore = create<State>((set, get) => ({
  project: null,
  projectPath: null,
  dirty: false,
  selectedClipId: null,
  previewMode: { kind: 'idle' },
  invalidClipIds: new Set(),

  setProject: (p, path) => set({
    project: p, projectPath: path ?? null, dirty: false,
    selectedClipId: null, previewMode: p ? { kind: 'source' } : { kind: 'idle' },
  }),
  setProjectPath: (path) => set({ projectPath: path }),
  markClean: () => set({ dirty: false }),
  setSource: (s) => set(state => ({
    project: state.project
      ? { ...state.project, sourceVideo: s }
      : { version: 1, sourceVideo: s, clips: [], sequence: [] },
    dirty: true,
    previewMode: { kind: 'source' },
  })),
  addClip: (clip) => set(state => state.project ? ({
    project: { ...state.project, clips: [...state.project.clips, clip] },
    dirty: true,
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
      (state.previewMode.kind === 'clip' || state.previewMode.kind === 'set-zoom')
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
    const copy: Clip = { ...orig, id: newId(), name: `${orig.name} (copy)`, zoom: { ...orig.zoom } };
    set({
      project: { ...proj, clips: [...proj.clips, copy] },
      dirty: true,
    });
    return copy.id;
  },
  selectClip: (id) => set({ selectedClipId: id, previewMode: id ? { kind: 'clip', clipId: id } : { kind: 'source' } }),
  setPreviewMode: (m) => set({ previewMode: m }),
  appendToSequence: (clipId) => set(state => state.project ? ({
    project: { ...state.project, sequence: [...state.project.sequence, { clipId }] },
    dirty: true,
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

  activeRun: null,
  exportResult: null,
  startRun: (runId) => set({ activeRun: { runId, phase: 'rendering-part', percent: 0, currentItem: 1, totalItems: 1 }, exportResult: null }),
  setProgress: (p) => set(state => state.activeRun && state.activeRun.runId === p.runId
    ? { activeRun: { ...state.activeRun, ...p } } : state),
  setExportResult: (r) => set({ exportResult: r }),
  clearRun: () => set({ activeRun: null, exportResult: null }),
}));
