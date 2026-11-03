import type { StoreApi } from 'zustand';
import type { State } from './projectStore';
import type { Project } from '../../shared/types';
import { materializeSequences, restoreActiveSequence, sequenceLibrary, syncActiveSequence, validSequenceName } from '../../shared/namedSequences';

export interface NamedSequenceActions {
  createNamedSequence: (name: string, copyCurrent?: boolean) => string | null;
  renameNamedSequence: (id: string, name: string) => boolean;
  selectNamedSequence: (id: string) => void;
  deleteNamedSequence: (id: string) => boolean;
}

export function namedSequenceActions(set: StoreApi<State>['setState'], get: StoreApi<State>['getState']): NamedSequenceActions {
  function activate(project: Project) {
    set(state => ({ project: restoreActiveSequence(project), dirty: true,
      selectedClipId: null, previewMode: { kind: 'source' },
      pauseRequest: { token: (state.pauseRequest?.token ?? 0) + 1 } }));
  }
  return {
    createNamedSequence(name, copyCurrent = false) {
      const current = get().project;
      if (!current || !validSequenceName(current, name)) return null;
      const project = materializeSequences(current);
      const id = 'seq_' + (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`);
      const sequence = { id, name: name.trim(),
        entries: copyCurrent ? current.sequence.map(entry => ({ ...entry })) : [],
        backingTrack: copyCurrent && current.sequenceBackingTrack ? { ...current.sequenceBackingTrack } : undefined,
        brightness: copyCurrent ? current.sequenceBrightness : undefined };
      activate({ ...project, activeSequenceId: id, namedSequences: [...project.namedSequences!, sequence] });
      return id;
    },
    renameNamedSequence(id, name) {
      const current = get().project;
      if (!current || !sequenceLibrary(current).some(sequence => sequence.id === id)
        || !validSequenceName(current, name, id)) return false;
      const project = materializeSequences(current);
      set({ project: { ...project, namedSequences: project.namedSequences!.map(sequence =>
        sequence.id === id ? { ...sequence, name: name.trim() } : sequence) }, dirty: true });
      return true;
    },
    selectNamedSequence(id) {
      const current = get().project;
      if (!current || id === current.activeSequenceId || !sequenceLibrary(current).some(sequence => sequence.id === id)) return;
      activate({ ...syncActiveSequence(current), activeSequenceId: id });
    },
    deleteNamedSequence(id) {
      const current = get().project;
      if (!current?.namedSequences || current.namedSequences.length <= 1
        || !current.namedSequences.some(sequence => sequence.id === id)) return false;
      const project = syncActiveSequence(current);
      const remaining = project.namedSequences!.filter(sequence => sequence.id !== id);
      if (project.activeSequenceId === id) activate({ ...project, namedSequences: remaining, activeSequenceId: remaining[0]!.id });
      else set({ project: { ...project, namedSequences: remaining }, dirty: true });
      return true;
    },
  };
}
