import { mediaFileUrl, musicGain, musicWindow } from '../../src/shared/musicTiming';
import { musicFilter } from '../../src/main/ffmpeg/musicFilter';
import { buildClipFfmpegArgs } from '../../src/main/ffmpeg/command';
import { buildFilterConcatFfmpegArgs } from '../../src/main/ffmpeg/concatList';
import type { BackingTrack, Clip } from '../../src/shared/types';
import { parseAndClampProject } from '../../src/main/project/schema';
import { serializeProject } from '../../src/main/project/io';

const track: BackingTrack = { path: 'song.wav', volume: 0.6, muteSource: true,
  durationSec: 60, offsetSec: 8 - 42, fadeInSec: 1 };

test('alignment settings and both markers survive saving and reopening', () => {
  const backingTrack = { ...track, videoMomentSec: 8, musicMomentSec: 42 };
  const input = { version: 1, sourceVideo: { path: 'video.mp4', duration: 60, width: 1280, height: 720, fps: 30 },
    clips: [{ id: 'a', name: 'A', in: 0, out: 20, speed: 1,
      zoom: { x: 0, y: 0, width: 1280, height: 720 }, backingTrack }],
    sequence: [{ clipId: 'a' }], sequenceBackingTrack: backingTrack };
  const saved = serializeProject(parseAndClampProject(input).project);
  const loaded = parseAndClampProject(JSON.parse(JSON.stringify(saved))).project;
  expect(loaded.sequenceBackingTrack).toEqual(backingTrack);
  expect(loaded.clips[0]!.backingTrack).toEqual(backingTrack);
});

test('aligns the chosen song moment to the video moment without stretching', () => {
  expect(8 - track.offsetSec!).toBe(42);
  expect(musicWindow(track, 20)).toMatchObject({ start: 0, end: 20, length: 20 });
  expect(musicGain(track, 0, 20)).toBe(0);
  expect(musicGain(track, 0.5, 20)).toBeCloseTo(0.3);
  expect(musicGain(track, 1, 20)).toBe(0.6);
});

test('delayed entry remains silent, eases in, and fades before a short song ends', () => {
  const delayed = { ...track, offsetSec: 3, durationSec: 2 };
  expect(musicGain(delayed, 2.9, 10)).toBe(0);
  expect(musicGain(delayed, 3.5, 10)).toBeCloseTo(0.3);
  expect(musicGain(delayed, 4.75, 10)).toBeCloseTo(0.3);
  expect(musicGain(delayed, 5, 10)).toBe(0);
  expect(musicGain(delayed, 9, 10)).toBe(0);
});

test('handles markers that move beyond the video and very short overlap', () => {
  expect(musicGain({ ...track, offsetSec: 30 }, 2, 10)).toBe(0);
  expect(musicGain({ ...track, offsetSec: -80 }, 2, 10)).toBe(0);
  expect(musicWindow({ ...track, offsetSec: 0 }, 0.2).fadeIn).toBe(0.1);
  expect(musicGain({ ...track, fadeInSec: 0 }, 0, 20)).toBe(0.6);
});

test('encodes Windows audio paths with spaces, hashes, and Unicode', () => {
  expect(mediaFileUrl('C:\\Music\\Goal #1 é.mp3')).toBe('file:///C:/Music/Goal%20%231%20%C3%A9.mp3');
});

test.each([true, false])('clip and sequence exports share the timed music filter (mute=%s)', muteSource => {
  const backingTrack = { ...track, muteSource };
  const source = { path: 'video.mp4', duration: 60, width: 1280, height: 720, fps: 30 };
  const clip: Clip = { id: 'a', name: 'A', in: 10, out: 20, speed: 0.5,
    zoom: { x: 0, y: 0, width: 1280, height: 720 }, focusMarkers: [], backingTrack };
  const filter = musicFilter(backingTrack, 20);
  for (const args of [buildClipFfmpegArgs(clip, source, 'out.mp4'),
    buildFilterConcatFfmpegArgs(['part.mp4'], 'out.mp4', source, { backingTrack, totalDurationSec: 20 })]) {
    expect(args[args.indexOf('-filter_complex') + 1]).toContain(filter);
  }
});
