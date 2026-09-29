import React, { useEffect, useRef, useState } from 'react';
import type { BackingTrack, Clip } from '../../shared/types';
import { alignMusicMoments, mediaFileUrl, nudgeMusicMoment } from '../../shared/musicTiming';
import { useProjectStore } from '../state/projectStore';
import { previewClock } from '../state/previewClock';
import { MusicWaveform, useMusicWaveform } from './MusicWaveform';
import { MomentMarker } from './MomentMarker';
import '../styles/musicAlignment.css';

const seconds = (value: number) => `${value.toFixed(2)}s`;
const clipDuration = (clip: Clip) => (clip.out - clip.in) / clip.speed;

export function MusicAlignment() {
  const project = useProjectStore(s => s.project);
  const mode = useProjectStore(s => s.previewMode);
  const selected = useProjectStore(s => s.selectedClipId);
  if (!project) return null;
  const clip = project.clips.find(c => c.id === (mode.kind === 'clip' ? mode.clipId : selected));
  const isClip = mode.kind !== 'sequence' && !!clip?.backingTrack;
  const track = isClip ? clip?.backingTrack : project.sequenceBackingTrack;
  if (!track) return null;
  return <AlignmentPanel key={`${isClip ? clip!.id : 'sequence'}:${track.path}`}
    track={track} clip={isClip ? clip : undefined} />;
}

function AlignmentPanel({ track, clip }: { track: BackingTrack; clip?: Clip }) {
  const project = useProjectStore(s => s.project)!;
  const mode = useProjectStore(s => s.previewMode);
  const setMode = useProjectStore(s => s.setPreviewMode);
  const replay = useProjectStore(s => s.replayClip);
  const pause = useProjectStore(s => s.requestPause);
  const updateClip = useProjectStore(s => s.updateClip);
  const setTrack = useProjectStore(s => s.setSequenceBackingTrack);
  const audio = useRef<HTMLAudioElement>(null);
  const [musicTime, setMusicTime] = useState(0);
  const [videoTime, setVideoTime] = useState(0);
  const [duration, setDuration] = useState(track.durationSec ?? 0);
  const [error, setError] = useState('');
  const { peaks, error: waveformError } = useMusicWaveform(track.path);
  const entries = clip ? [clip] : project.sequence.map(e => project.clips.find(c => c.id === e.clipId)).filter((c): c is Clip => !!c);
  const total = entries.reduce((sum, c) => sum + clipDuration(c), 0);
  const active = clip ? mode.kind === 'clip' && mode.clipId === clip.id : mode.kind === 'sequence';
  const offset = track.offsetSec ?? 0;
  function patch(values: Partial<BackingTrack>) {
    if (clip) updateClip(clip.id, { backingTrack: { ...track, ...values } });
    else setTrack({ ...track, ...values });
  }
  function currentVideoTime() {
    const index = mode.kind === 'sequence' && !clip ? mode.index : 0;
    const current = entries[index];
    if (!current) return 0;
    return entries.slice(0, index).reduce((sum, c) => sum + clipDuration(c), 0)
      + Math.max(0, Math.min(clipDuration(current), (previewClock.currentTime - current.in) / current.speed));
  }
  useEffect(() => {
    const timer = window.setInterval(() => { if (active) setVideoTime(currentVideoTime()); }, 50);
    return () => window.clearInterval(timer);
  }, [active, mode, project]);
  useEffect(() => {
    const element = audio.current;
    const stop = () => element?.pause();
    window.addEventListener('reelmagic:video-play', stop);
    return () => { stop(); window.removeEventListener('reelmagic:video-play', stop); };
  }, []);
  function seekMusic(time: number) {
    const next = Math.max(0, Math.min(duration, time));
    if (audio.current && duration > 0) audio.current.currentTime = next;
    setMusicTime(next);
  }
  const canAlign = track.videoMomentSec !== undefined && track.musicMomentSec !== undefined
    && track.videoMomentSec <= total && track.musicMomentSec <= duration && total > 0 && duration > 0;
  return <section className="music-alignment" aria-label="Music alignment">
    <div className="music-alignment-controls">
      <strong>{clip ? 'Clip music' : 'Sequence music'}</strong>
      <span className="music-filename" title={track.path}>{track.path.split(/[\\/]/).pop()}</span>
      <button disabled={!entries.length} onClick={() => {
        audio.current?.pause();
        setMode(clip ? { kind: 'clip', clipId: clip.id } : { kind: 'sequence', index: 0 });
        if (clip) replay();
      }}>Preview together</button>
      <button disabled={!active} onClick={() => {
        pause(); patch({ videoMomentSec: currentVideoTime() });
      }}>Mark video moment</button>
      <span className="music-marker-label">{track.videoMomentSec === undefined ? 'No video marker' : seconds(track.videoMomentSec)}</span>
    </div>
    <div className="music-video-ruler" aria-label="Video timeline">
      {entries.map((entry, index) => <span key={index} style={{ width: `${clipDuration(entry) / total * 100}%` }} title={entry.name}>{entry.name}</span>)}
      {track.videoMomentSec !== undefined && <MomentMarker label="Video moment" time={track.videoMomentSec}
        position={track.videoMomentSec / (total || 1) * 100} duration={total}
        onChange={videoMomentSec => patch({ videoMomentSec })} />}
      {active && <b style={{ left: `${videoTime / total * 100}%` }} />}
    </div>
    <MusicWaveform peaks={peaks} duration={duration} start={0} end={total || 1} offset={offset}
      marker={track.musicMomentSec === undefined ? undefined : track.musicMomentSec + offset}
      markerTime={track.musicMomentSec} onMarkerChange={musicMomentSec => patch({ musicMomentSec })}
      playhead={active ? videoTime : undefined} onSeek={t => seekMusic(t - offset)} />
    <div className="music-time-labels"><span>Video 0s</span><span>{seconds(total)}</span></div>
    <details open>
      <summary>Full song overview · {duration ? seconds(duration) : 'Loading audio…'}</summary>
      <MusicWaveform peaks={peaks} duration={duration} start={0} end={duration || 1}
        marker={track.musicMomentSec} playhead={musicTime} onSeek={seekMusic}
        markerTime={track.musicMomentSec} onMarkerChange={musicMomentSec => patch({ musicMomentSec })}
        usedStart={Math.max(0, -offset)} usedEnd={Math.min(duration, total - offset)} />
    </details>
    <div className="music-alignment-controls">
      <audio ref={audio} src={mediaFileUrl(track.path)} controls preload="metadata"
        onPlay={() => { pause(); }}
        onTimeUpdate={e => setMusicTime(e.currentTarget.currentTime)}
        onLoadedMetadata={e => {
          const value = e.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) {
            setDuration(value);
            if (track.durationSec !== value) patch({ durationSec: value });
          }
        }} onError={() => setError('Cannot load this audio file. Choose another track from the music controls.')} />
      <button disabled={!duration} onClick={() => {
        audio.current?.pause(); patch({ musicMomentSec: audio.current?.currentTime ?? musicTime });
      }}>Mark music moment</button>
      <span className="music-marker-label">{track.musicMomentSec === undefined ? 'No music marker' : seconds(track.musicMomentSec)}</span>
      <button className="primary" disabled={!canAlign} onClick={() => {
        audio.current?.pause();
        patch(alignMusicMoments(track));
      }}>Align moments</button>
      <label>Fade in <input aria-label="Music fade in seconds" type="number" min="0" max="10" step="0.1"
        value={track.fadeInSec ?? 0} onChange={e => {
          if (Number.isFinite(e.currentTarget.valueAsNumber)) patch({ fadeInSec: Math.max(0, Math.min(10, e.currentTarget.valueAsNumber)) });
        }} /> s</label>
      <button title="Move the music moment 0.05 seconds earlier in the song" disabled={track.musicMomentSec === undefined || !duration}
        onClick={() => patch(nudgeMusicMoment(track, -0.05, duration))}>−0.05s</button>
      <button title="Move the music moment 0.05 seconds later in the song" disabled={track.musicMomentSec === undefined || !duration}
        onClick={() => patch(nudgeMusicMoment(track, 0.05, duration))}>+0.05s</button>
      <button onClick={() => patch({ offsetSec: undefined, videoMomentSec: undefined, musicMomentSec: undefined })}>Reset alignment</button>
    </div>
    <div className="dim" aria-live="polite">{offset < 0
      ? `Music starts ${seconds(-offset)} into the song.` : `Music enters at ${seconds(offset)} in the video.`}
      {' '}The ±0.05s buttons adjust the music moment within the song. Use Align moments after adjusting.
      {' '}Select a marker: ←/→ nudge 0.01s, Shift 0.1s, Delete removes it.
      {track.videoMomentSec !== undefined && track.videoMomentSec > total && ' Video marker is outside the current edit. Mark it again.'}
      {duration > 0 && duration + offset < total && ' The song ends before the video; the remaining video continues without music.'}
    </div>
    {(error || waveformError) && <div className="dim" role="status">{error || waveformError}</div>}
  </section>;
}
