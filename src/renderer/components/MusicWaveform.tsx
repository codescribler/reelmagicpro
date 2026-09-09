import React, { useEffect, useState } from 'react';
import { MomentMarker } from './MomentMarker';

/** Decode only on track changes, keeping sample data out of project files. */
export function useMusicWaveform(path: string) {
  const [data, setData] = useState<{ peaks: number[]; error?: string }>({ peaks: [] });
  useEffect(() => {
    let cancelled = false;
    const context = new AudioContext();
    setData({ peaks: [] });
    (async () => {
      const response = await window.reelmagic.readMusicAudio(path);
      if (cancelled) return;
      if (!response.bytes) throw new Error(response.error || 'Cannot read audio');
      const buffer = await context.decodeAudioData(new Uint8Array(response.bytes).buffer);
      const peaks = new Array<number>(1200).fill(0);
      const size = Math.max(1, Math.ceil(buffer.length / peaks.length));
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) {
          const bucket = Math.floor(i / size);
          peaks[bucket] = Math.max(peaks[bucket]!, Math.abs(samples[i]!));
        }
      }
      if (!cancelled) setData({ peaks });
    })().catch((error: unknown) => {
      if (!cancelled) setData({ peaks: [], error: `${error instanceof Error ? error.message : 'Waveform unavailable.'} You can still listen, scrub and mark moments.` });
    }).finally(() => { void context.close(); });
    return () => { cancelled = true; };
  }, [path]);
  return data;
}

export function MusicWaveform({ peaks, duration, start, end, offset = 0, marker, markerTime, onMarkerChange, playhead, onSeek, usedStart, usedEnd }: {
  peaks: number[]; duration: number; start: number; end: number; offset?: number;
  marker?: number; playhead?: number; onSeek: (time: number) => void;
  usedStart?: number; usedEnd?: number;
  markerTime?: number; onMarkerChange?: (time: number | undefined) => void;
}) {
  const span = Math.max(0.01, end - start);
  const x = (time: number) => (time - start) / span * 1000;
  return <div className="music-waveform-wrap"><svg className="music-waveform" viewBox="0 0 1000 48" preserveAspectRatio="none"
    aria-hidden="true" onClick={e => {
      const rect = e.currentTarget.getBoundingClientRect();
      onSeek(start + (e.clientX - rect.left) / rect.width * span);
    }}>
    <line x1="0" x2="1000" y1="24" y2="24" stroke="currentColor" opacity="0.2" />
    {peaks.map((peak, i) => {
      const position = x(offset + i / peaks.length * duration);
      if (position < 0 || position > 1000) return null;
      return <line key={i} x1={position} x2={position} y1={24 - peak * 22} y2={24 + peak * 22}
        stroke="currentColor" strokeWidth="1.5"
        opacity={(usedStart !== undefined && i / peaks.length * duration < usedStart)
          || (usedEnd !== undefined && i / peaks.length * duration > usedEnd) ? 0.2 : 1} />;
    })}
    {playhead !== undefined && <line x1={x(playhead)} x2={x(playhead)} y1="0" y2="48" stroke="white" strokeWidth="2" />}
  </svg>
    {marker !== undefined && marker >= start && marker <= end && markerTime !== undefined && onMarkerChange
      && <MomentMarker label="Music moment" time={markerTime} position={x(marker) / 10}
        duration={duration} onChange={onMarkerChange} />}
  </div>;
}
