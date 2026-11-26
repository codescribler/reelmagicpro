import type { BackingTrack, Clip, Project, SequenceEntry } from './types';
import { activeNamedSequence, syncActiveSequence } from './namedSequences';
import { shiftMusicTiming } from './clipTiming';

// A sequence's video marker identifies a source frame in one occurrence.
// Recompute its output time when that occurrence or earlier clips are trimmed.
function retimeTrack(
  track: BackingTrack | undefined, oldEntries: SequenceEntry[], newEntries: SequenceEntry[],
  oldClips: Map<string, Clip>, newClips: Map<string, Clip>,
): BackingTrack | undefined {
  if (!track || (track.videoMomentSec === undefined && !track.sequenceAnchor)) return track;
  let oldStart = 0, newStart = 0;
  for (let i = 0; i < oldEntries.length; i++) {
    const oldClip = oldClips.get(oldEntries[i]!.clipId);
    const newClip = newClips.get(newEntries[i]?.clipId ?? '');
    if (!oldClip || !newClip) continue;
    const oldDuration = (oldClip.out - oldClip.in) / oldClip.speed;
    const newDuration = (newClip.out - newClip.in) / newClip.speed;
    const moment = track.videoMomentSec;
    const anchor = track.sequenceAnchor;
    if (anchor ? anchor.index === i : moment !== undefined &&
      (moment < oldStart + oldDuration || (i === oldEntries.length - 1 && moment === oldStart + oldDuration))) {
      const sourceTime = anchor?.sourceTime ?? oldClip.in + (moment! - oldStart) * oldClip.speed;
      const oldMoment = oldStart + (sourceTime - oldClip.in) / oldClip.speed;
      const nextMoment = newStart + (sourceTime - newClip.in) / newClip.speed;
      const visible = sourceTime >= newClip.in && sourceTime <= newClip.out;
      const next = shiftMusicTiming(track, nextMoment - oldMoment, visible ? nextMoment : undefined);
      if (visible) delete next.sequenceAnchor;
      else next.sequenceAnchor = { index: i, sourceTime };
      return next;
    }
    oldStart += oldDuration;
    newStart += newDuration;
  }
  return track;
}

export function moveSequenceMusicAnchor(
  track: BackingTrack | undefined, before: SequenceEntry[], after: SequenceEntry[], clips: Clip[],
) {
  if (!track?.sequenceAnchor) return track;
  const next = { ...track };
  const index = after.indexOf(before[track.sequenceAnchor.index]!);
  if (index < 0) delete next.sequenceAnchor;
  else {
    const byId = new Map(clips.map(c => [c.id, c]));
    const start = (entries: SequenceEntry[], end: number) => entries.slice(0, end).reduce((sum, entry) => {
      const clip = byId.get(entry.clipId);
      return sum + (clip ? (clip.out - clip.in) / clip.speed : 0);
    }, 0);
    next.offsetSec = (track.offsetSec ?? 0) + start(after, index) - start(before, track.sequenceAnchor.index);
    next.sequenceAnchor = { ...track.sequenceAnchor, index };
  }
  return next;
}

export function retimeSequenceMusic(before: Project, after: Project): Project {
  const oldClips = new Map(before.clips.map(c => [c.id, c]));
  const newClips = new Map(after.clips.map(c => [c.id, c]));
  // Other clip edits (including music edits themselves) leave sequence music alone.
  const changedRange = after.sequence.some((entry, i) => {
    const old = oldClips.get(before.sequence[i]?.clipId ?? '');
    const next = newClips.get(entry.clipId);
    return old && next && (old.in !== next.in || old.out !== next.out);
  }) || before.clips.some(old => {
    const next = newClips.get(old.id);
    return next && (old.in !== next.in || old.out !== next.out);
  });
  if (!changedRange) return after;
  const activeId = activeNamedSequence(after).id;
  return syncActiveSequence({ ...after,
    sequenceBackingTrack: retimeTrack(after.sequenceBackingTrack, before.sequence, after.sequence, oldClips, newClips),
    namedSequences: after.namedSequences?.map(sequence => {
      if (sequence.id === activeId) return sequence;
      const old = before.namedSequences?.find(s => s.id === sequence.id);
      return old ? { ...sequence, backingTrack: retimeTrack(sequence.backingTrack,
        old.entries, sequence.entries, oldClips, newClips) } : sequence;
    }),
  });
}
