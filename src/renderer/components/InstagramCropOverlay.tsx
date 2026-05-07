import React, { useEffect, useRef, useState } from 'react';
import type { Clip, SourceMeta } from '../../shared/types';
import { computeInstagramFraming, IgFramingSample } from '../../shared/instagramFraming';
import { previewClock } from '../state/previewClock';

// Overlay that draws the IG-format crop rectangle on top of the main preview.
// Coordinates here are SOURCE pixels (the parent div applies the same zoom
// transform as the rest of the preview, so source-space coords land in the
// right display position regardless of zoom).
export function InstagramCropOverlay(props: {
  clip: Clip;
  source: SourceMeta;
  // The display scale factor — same `fit` value the Preview uses to size the
  // <video> element. Source-pixel coords are multiplied by this to get
  // display-pixel coords.
  fit: number;
}) {
  const { clip, source, fit } = props;
  const samplesRef = useRef<IgFramingSample[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    samplesRef.current = computeInstagramFraming(clip, source).samples;
  }, [clip, source]);

  // Refresh on rAF so the rectangle follows the playhead while playing.
  useEffect(() => {
    let raf = 0;
    function loop() {
      setTick(n => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const t = previewClock.currentTime - clip.in;
  const s = sampleFraming(samplesRef.current, t);
  if (!s) return null;

  const x = (s.cx - s.w / 2) * fit;
  const y = (s.cy - s.h / 2) * fit;
  const w = s.w * fit;
  const h = s.h * fit;

  return (
    <>
      <div style={{
        position: 'absolute',
        left: x, top: y, width: w, height: h,
        border: '2px solid white',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
      }} />
      <div style={{
        position: 'absolute',
        left: x + 6, top: y + 6,
        background: 'rgba(255,255,255,0.85)',
        color: 'black',
        fontSize: 10,
        fontWeight: 700,
        padding: '1px 5px',
        borderRadius: 3,
        pointerEvents: 'none',
        letterSpacing: 0.5,
      }}>REEL</div>
    </>
  );
}

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
        t, cx: a.cx + k * (b.cx - a.cx), cy: a.cy + k * (b.cy - a.cy),
        w: a.w + k * (b.w - a.w), h: a.h + k * (b.h - a.h),
      };
    }
  }
  return samples[samples.length - 1]!;
}
