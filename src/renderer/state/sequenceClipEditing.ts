import type { State, PreviewMode } from './projectStore';
import { activeNamedSequence, syncActiveSequence } from '../../shared/namedSequences';
import type { SequenceEntry } from '../../shared/types';

export interface SequenceEditContext {
  index: number;
  // Retain the id captured by an editor's event handler before the first copy.
  openedClipId: string;
}

function editingEntry(state: State) {
  const context = state.sequenceEditContext;
  const entry = context && state.project?.sequence[context.index];
  return entry?.clipId === state.selectedClipId ? entry : undefined;
}

export function sequenceEditingClipId(state: State, id: string): string {
  const entry = editingEntry(state);
  return entry && (entry.clipId === id || state.sequenceEditContext?.openedClipId === id)
    ? entry.clipId : id;
}

export function previewModeState(state: State, mode: PreviewMode): Partial<State> {
  if (mode.kind === 'sequence') {
    const entry = state.project?.sequence[mode.index];
    const clip = state.project?.clips.find(c => c.id === entry?.clipId);
    if (!clip || !Number.isInteger(mode.index) || mode.index < 0) return {};
    return {
      previewMode: mode,
      selectedClipId: clip.id,
      sequenceEditContext: { index: mode.index, openedClipId: clip.id },
      activeSourceId: clip.sourceId ?? state.project!.sources[0]!.id,
      marking: null,
    };
  }
  if ('clipId' in mode) {
    const clipId = sequenceEditingClipId(state, mode.clipId);
    return { previewMode: { ...mode, clipId },
      sequenceEditContext: editingEntry(state)?.clipId === clipId ? state.sequenceEditContext : null };
  }
  return { previewMode: mode, sequenceEditContext: null };
}

// Follow the entry object across reorders/removals: clip ids can be repeated.
export function sequenceEntriesState(state: State, sequence: SequenceEntry[]): Partial<State> {
  if (!state.project) return state;
  const context = state.sequenceEditContext;
  const editingIndex = context ? sequence.indexOf(state.project.sequence[context.index]!) : -1;
  const playingIndex = state.previewMode.kind === 'sequence'
    ? sequence.indexOf(state.project.sequence[state.previewMode.index]!) : -1;
  const removedSelection = !!context && editingIndex < 0;
  return {
    project: syncActiveSequence({ ...state.project, sequence }), dirty: true,
    sequenceEditContext: context && editingIndex >= 0 ? { ...context, index: editingIndex } : null,
    selectedClipId: removedSelection ? null : state.selectedClipId,
    previewMode: removedSelection ? { kind: 'source' } : state.previewMode.kind === 'sequence'
      ? (playingIndex >= 0 ? { kind: 'sequence', index: playingIndex } : { kind: 'source' }) : state.previewMode,
    ...(removedSelection ? { pauseRequest: { token: (state.pauseRequest?.token ?? 0) + 1 } } : {}),
  };
}

// All clip mutations pass through here, including overlay saves and marker
// actions. Reading/playing an entry never creates a copy. A persisted origin
// id lets an exclusive sequence version be edited again after reopening.
export function editSequenceClip(
  state: State, id: string, update: (state: State, clipId: string) => Partial<State>,
): Partial<State> {
  const clipId = sequenceEditingClipId(state, id);
  const result = update(state, clipId);
  if (result === state || !state.project) return result;
  const entry = editingEntry(state);
  if (!entry || entry.clipId !== clipId) return result;
  const original = state.project.clips.find(c => c.id === clipId);
  if (!original) return result;

  const active = activeNamedSequence(state.project);
  const references = [...state.project.sequence,
    ...(state.project.namedSequences ?? []).filter(s => s.id !== active.id).flatMap(s => s.entries)]
    .filter(e => e.clipId === clipId).length;
  let editingState = state;
  let targetId = clipId;
  if (!entry.sourceClipId || references > 1) {
    targetId = 'clip_' + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
    const copy = structuredClone(original);
    copy.id = targetId;
    copy.name = `${original.name} (${active.name})`;
    const project = syncActiveSequence({ ...state.project,
      clips: [...state.project.clips, copy],
      sequence: state.project.sequence.map((e, index) => index === state.sequenceEditContext!.index
        ? { ...e, clipId: targetId, sourceClipId: e.sourceClipId ?? clipId } : e) });
    editingState = { ...state, project, selectedClipId: targetId,
      previewMode: 'clipId' in state.previewMode ? { ...state.previewMode, clipId: targetId } : state.previewMode };
  }
  if (editingState.previewMode.kind === 'sequence') {
    editingState = { ...editingState, previewMode: { kind: 'clip', clipId: targetId },
      pauseRequest: { token: (state.pauseRequest?.token ?? 0) + 1 } };
  }
  return { ...editingState, ...update(editingState, targetId) };
}
