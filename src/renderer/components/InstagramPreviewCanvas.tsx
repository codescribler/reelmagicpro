import React, { useEffect, useRef, useState } from 'react';
import type { Clip, SourceMeta } from '../../shared/types';
import { computeInstagramFraming, IgFramingSample } from '../../shared/instagramFraming';

const DISPLAY_W = 270;
const DISPLAY_H = 480;

// Live preview of the IG-cropped output. Reads a private <video> element
// (kept in sync with the user's chosen scrub time) and draws each frame's
// IG crop window into a canvas using `drawImage` source-rectangle args.
// Watermark and markers are NOT drawn — the canvas previews framing only.
export function InstagramPreviewCanvas(props: {
  clip: Clip;
  source: SourceMeta;
}) {
  const { clip, source } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(0);

  // Memoise the smoothed framing for the clip — pure, cheap to recompute.
  const framingRef = useRef<{ samples: IgFramingSample[] } | null>(null);
  useEffect(() => {
    framingRef.current = computeInstagramFraming(clip, source);
  }, [clip, source]);

  // Drive the canvas off rAF so it stays in sync with playback while playing.
  useEffect(() => {
    let raf = 0;
    function tick() {
      const v = videoRef.current;
      const c = canvasRef.current;
      const f = framingRef.current;
      if (v && c && f && v.readyState >= 2) {
        const t = v.currentTime - clip.in;
        const s = sampleFraming(f.samples, t);
        if (s) {
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.drawImage(
              v,
              s.cx - s.w / 2, s.cy - s.h / 2, s.w, s.h,
              0, 0, c.width, c.height,
            );
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clip.in]);

  function onPlay() { videoRef.current?.play(); }
  function onPause() { videoRef.current?.pause(); }
  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoRef.current;
    if (!v) return;
    const t = parseFloat(e.target.value);
    v.currentTime = clip.in + t;
    setTime(t);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <video
        ref={videoRef}
        src={`file://${source.path}`}
        style={{ display: 'none' }}
        onLoadedData={() => {
          if (videoRef.current) videoRef.current.currentTime = clip.in;
          setReady(true);
        }}
        onTimeUpdate={() => setTime((videoRef.current?.currentTime ?? clip.in) - clip.in)}
      />
      <canvas
        ref={canvasRef}
        width={DISPLAY_W}
        height={DISPLAY_H}
        style={{ background: 'black', borderRadius: 6, alignSelf: 'center' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={onPlay} disabled={!ready}>Play</button>
        <button onClick={onPause} disabled={!ready}>Pause</button>
        <input
          type="range"
          min={0} max={Math.max(0.001, clip.out - clip.in)} step={0.05}
          value={time}
          onChange={onScrub}
          style={{ flex: 1 }}
        />
      </div>
      <div className="dim" style={{ fontSize: 11, textAlign: 'center' }}>
        Watermark and markers will appear on export.
      </div>
    </div>
  );
}

// Linear-interpolate the framing series at a given time. The framing series
// is sparse (≤ 41 endpoints); between samples we lerp position and size.
function sampleFraming(samples: IgFramingSample[], t: number): IgFramingSample | null {
  if (samples.length === 0) return null;
  if (t <= samples[0]!.t) return samples[0]!;
  if (t >= samples[samples.length - 1]!.t) return samples[samples.length - 1]!;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const dt = b.t - a.t;
      const k = dt === 0 ? 0 : (t - a.t) / dt;
      return {
        t,
        cx: a.cx + k * (b.cx - a.cx),
        cy: a.cy + k * (b.cy - a.cy),
        w:  a.w + k * (b.w - a.w),
        h:  a.h + k * (b.h - a.h),
      };
    }
  }
  return samples[samples.length - 1]!;
}
