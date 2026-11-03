import type { NamedSequence, Project } from './types';

// Top-level sequence fields are the active working copy used by existing
// preview/export code. Named records retain each arrangement and its settings.
function capture(project: Project, id: string, name: string): NamedSequence {
  return { id, name, entries: project.sequence.map(entry => ({ ...entry })),
    backingTrack: project.sequenceBackingTrack ? { ...project.sequenceBackingTrack } : undefined,
    brightness: project.sequenceBrightness };
}

export function sequenceLibrary(project: Project): NamedSequence[] {
  return project.namedSequences?.length
    ? project.namedSequences : [capture(project, 'sequence_default', 'Sequence 1')];
}

export function activeNamedSequence(project: Project): NamedSequence {
  const library = sequenceLibrary(project);
  return library.find(sequence => sequence.id === project.activeSequenceId) ?? library[0]!;
}

export function syncActiveSequence(project: Project): Project {
  if (!project.namedSequences?.length) return project;
  const active = activeNamedSequence(project);
  return { ...project, activeSequenceId: active.id,
    namedSequences: project.namedSequences.map(sequence => sequence.id === active.id
      ? capture(project, active.id, active.name) : sequence) };
}

export function materializeSequences(project: Project): Project {
  return syncActiveSequence({ ...project, namedSequences: sequenceLibrary(project),
    activeSequenceId: activeNamedSequence(project).id });
}

export function restoreActiveSequence(project: Project): Project {
  if (!project.namedSequences?.length) return project;
  const active = activeNamedSequence(project);
  return { ...project, activeSequenceId: active.id,
    sequence: active.entries.map(entry => ({ ...entry })),
    sequenceBackingTrack: active.backingTrack ? { ...active.backingTrack } : undefined,
    sequenceBrightness: active.brightness };
}

export function pruneSequenceClips(project: Project): Project {
  if (!project.namedSequences?.length) return project;
  const valid = new Set(project.clips.map(clip => clip.id));
  const synced = syncActiveSequence(project);
  return { ...synced, namedSequences: synced.namedSequences!.map(sequence => ({ ...sequence,
    entries: sequence.entries.filter(entry => valid.has(entry.clipId)) })) };
}

export function validSequenceName(project: Project, name: string, exceptId?: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 80
    && !sequenceLibrary(project).some(sequence => sequence.id !== exceptId
      && sequence.name.toLowerCase() === trimmed.toLowerCase());
}
