import React, { useEffect, useRef, useState } from 'react';
import type { Clip, SourceMeta, FocusMarker } from '../../shared/types';
import { computeReelFraming, ReelFramingSample } from '../../shared/instagramFraming';
import { markerCentreAt } from '../state/markerPosition';

const DISPLAY_W = 270;
const DISPLAY_H = 480;

// Live preview of the exported reel. Mirrors the export pipeline so the canvas
// shows EXACTLY what renders: focus-box zoom, highlight markers, brightness,
// slow-mo timing, the square reel slice letterboxed into 9:16, and the
// watermark. (Previews must be WYSIWYG — anything less isn't a preview.)
export function InstagramPreviewCanvas(props: {
  clip: Clip;
  source: SourceMeta;
}) {
  const { clip, source } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(0);

  // Latest clip in a ref so the rAF loop reads current zoom/markers/brightness
  // without restarting on every edit.
  const clipRef = useRef(clip);
  clipRef.current = clip;

  // Memoise the smoothed framing for the clip — pure, cheap to recompute.
  const framingRef = useRef<{ samples: ReelFramingSample[] } | null>(null);
  useEffect(() => {
    framingRef.current = computeReelFraming(clip, source);
  }, [clip, source]);

  // Drive the canvas off rAF so it stays in sync with playback while playing.
  useEffect(() => {
    let raf = 0;
    function tick() {
      const v = videoRef.current;
      const c = canvasRef.current;
      const f = framingRef.current;
      const cl = clipRef.current;
      if (v && c && f && v.readyState >= 2) {
        const ctx = c.getContext('2d');
        const s = sampleFraming(f.samples, v.currentTime - cl.in);
        if (ctx && s) drawReelFrame(ctx, c, v, cl, source, s);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [source]);

  function onPlay() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.playbackRate = clip.speed; // slow-mo matches the exported timing
    v.play();
  }
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
        muted
        style={{ display: 'none' }}
        onLoadedData={() => {
          if (videoRef.current) {
            videoRef.current.currentTime = clip.in;
            videoRef.current.muted = true;
          }
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
        Live preview — matches the exported reel.
      </div>
    </div>
  );
}

// Render one reel frame onto the canvas, mirroring the ffmpeg chain:
// zoom → markers → square slice → letterbox → watermark → brightness.
function drawReelFrame(
  ctx: CanvasRenderingContext2D,
  c: HTMLCanvasElement,
  v: HTMLVideoElement,
  clip: Clip,
  source: SourceMeta,
  s: ReelFramingSample,
) {
  const z = clip.zoom;
  const srcW = source.width;
  const srcH = source.height;
  // The reel slice (s) is in POST-ZOOM source pixels. Map it back to the raw
  // source rectangle so a single drawImage composes zoom + framing.
  const x0p = s.cx - s.w / 2;
  const y0p = s.cy - s.h / 2;
  const sx = z.x + (x0p * z.width) / srcW;
  const sy = z.y + (y0p * z.height) / srcH;
  const sw = (s.w * z.width) / srcW;
  const sh = (s.h * z.height) / srcH;

  const bandH = c.width;                 // square slice → square band at canvas width
  const dy = (c.height - bandH) / 2;     // black bars top/bottom

  ctx.filter = 'none';
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, c.width, c.height);

  // Brightness applies to the whole frame (eq=brightness near the end of the
  // export chain). CSS/canvas brightness is multiplicative: 1 + offset.
  ctx.filter = `brightness(${Math.max(0, 1 + (clip.brightness ?? 0))})`;
  ctx.drawImage(v, sx, sy, sw, sh, 0, dy, c.width, bandH);

  // Markers, mapped post-zoom → canvas (same scale as the slice).
  const scale = c.width / s.w;
  const t = v.currentTime - clip.in;
  for (const m of clip.focusMarkers) {
    if (v.currentTime < m.in || v.currentTime > m.out) continue;
    const { cx: mx, cy: my } = markerCentreAt(m, t);
    const cxp = ((mx - z.x) * srcW) / z.width;
    const cyp = ((my - z.y) * srcH) / z.height;
    const pw = (m.width * srcW) / z.width;
    const ph = (m.height * srcH) / z.height;
    const bw = pw * scale;
    const bh = ph * scale;
    const left = (cxp - x0p) * scale - bw / 2;
    const top = dy + (cyp - y0p) * scale - bh / 2;
    drawMarker(ctx, m, left, top, bw, bh);
  }

  drawWatermark(ctx, c.width, c.height);
  ctx.filter = 'none';
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  m: FocusMarker,
  x: number, y: number, w: number, h: number,
) {
  ctx.strokeStyle = m.color;
  ctx.fillStyle = m.color;
  if ((m.shape ?? 'rect') === 'oval') {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = m.color;
    ctx.fillRect(x, y + h - 3, w, 3); // thicker bottom edge, matching the export
  }
  if (m.label) {
    const fontSize = Math.max(9, Math.round(h * 0.16));
    ctx.font = `600 ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(m.label).width;
    const tx = x + w / 2;
    const ty = y + h + fontSize + 4;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(tx - tw / 2 - 4, ty - fontSize, tw + 8, fontSize + 6);
    ctx.fillStyle = m.color;
    ctx.fillText(m.label, tx, ty);
  }
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const fontSize = Math.max(7, Math.round(Math.min(w, h) * 0.022));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const x = Math.round(w * 0.1);
  const y = Math.max(10, Math.round(Math.min(w, h) * 0.02)) + fontSize;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText('Made with getreelmagic.co.uk', x, y);
  ctx.fillStyle = 'white';
  ctx.fillText('Made with getreelmagic.co.uk', x, y);
}

// Linear-interpolate the framing series at a given time. The framing series
// is sparse (≤ 41 endpoints); between samples we lerp position and size.
function sampleFraming(samples: ReelFramingSample[], t: number): ReelFramingSample | null {
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
