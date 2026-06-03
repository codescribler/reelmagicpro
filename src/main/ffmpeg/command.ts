import path from 'path';
import type { Clip, SourceMeta, FocusMarker, BackingTrack } from '../../shared/types';
import type { ReelFramingSample } from '../../shared/instagramFraming';
import { reelCropSide } from '../../shared/instagramFraming';
import { INSTAGRAM_REEL_WIDTH, INSTAGRAM_REEL_HEIGHT } from '../../shared/instagramFormat';

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(6)));
}

// Length of the export-end audio fade-out, in seconds. "Very quickly" per the
// product brief; long enough that a hard cut isn't audible, short enough that
// nothing the user cares about gets faded away. Clamped per-clip so we never
// fade more than half of a very short clip.
const AUDIO_FADE_OUT_SEC = 0.5;

// Below this magnitude we omit the eq filter entirely so the rest of the
// pipeline stays byte-identical for clips/sequences with brightness left at
// the default. Catches both undefined and rounding noise like 0.00001.
const BRIGHTNESS_EPSILON = 0.001;

// ffmpeg's `eq=brightness=N` adds N (clamped −1.0..1.0) to the normalised
// luma. Applied at the tail of the video filter chain so any markers /
// watermark drawn earlier brighten or darken with the picture — matching
// what a parent expects from a "brightness" control (the whole frame
// changes, not just the source pixels).
function brightnessFilter(brightness: number | undefined): string {
  if (!brightness || Math.abs(brightness) < BRIGHTNESS_EPSILON) return '';
  return `,eq=brightness=${fmt(brightness)}`;
}

// Output (playback) duration of a clip in seconds. Source segment is
// (out - in) seconds; slow-mo at 0.5× doubles that. The audio chain has to
// match this number so fadeouts and atrims land on the same beat as the
// rendered video.
function clipOutputDurationSec(clip: Clip): number {
  return (clip.out - clip.in) / clip.speed;
}

// Build the audio half of the filter_complex when the clip has a backing
// track. Returns the filter snippet ending in [aout], the input args for the
// mp3 file, and the audio map flag.
//
// Source audio behaviour:
//   - speed === 1 AND keepSource → mix source [0:a] with the backing track.
//   - speed !== 1 OR muteSource  → source is silent / hidden; backing track
//                                  plays alone. (Slow-mo already silences
//                                  source elsewhere in the pipeline, so this
//                                  path matches the existing convention.)
//
// The backing track is volume-scaled, length-clamped to the clip's output
// duration, and faded out at the very end. amix uses normalize=0 so the user's
// volume slider behaves like an actual gain control — without it, ffmpeg
// would silently halve both inputs.
function buildBackingAudio(clip: Clip, bgInputIndex: number): {
  inputs: string[];
  filter: string;
  audioMap: string;
} {
  const bg = clip.backingTrack!;
  const dur = clipOutputDurationSec(clip);
  const fade = Math.min(AUDIO_FADE_OUT_SEC, Math.max(0, dur / 2));
  const fadeStart = Math.max(0, dur - fade);
  const trimTail = `,atrim=duration=${fmt(dur)},asetpts=PTS-STARTPTS`;
  const fadeTail = fade > 0
    ? `,afade=t=out:st=${fmt(fadeStart)}:d=${fmt(fade)}`
    : '';

  const keepSource = !bg.muteSource && clip.speed === 1;
  let filter: string;
  if (keepSource) {
    // Source audio (untrimmed; -ss/-to already restricted it) mixed with the
    // gain-scaled backing track. duration=first stops the mix when source
    // ends, so a longer mp3 gets cut at the clip boundary.
    filter = `[${bgInputIndex}:a]volume=${fmt(bg.volume)}[bg];`
      + `[0:a][bg]amix=inputs=2:duration=first:normalize=0[mix];`
      + `[mix]anull${trimTail}${fadeTail}[aout]`;
  } else {
    filter = `[${bgInputIndex}:a]volume=${fmt(bg.volume)}${trimTail}${fadeTail}[aout]`;
  }

  return {
    inputs: ['-i', bg.path],
    filter,
    audioMap: '[aout]',
  };
}

// Build a piecewise-linear ffmpeg expression for a value v(t) sampled at
// path points, evaluated against drawbox's `t` (clip-relative seconds).
// Before the first point and after the last, the value is clamped to the
// nearest endpoint. Inside each segment we lerp between adjacent points.
// The output is wrapped in single quotes so callers can drop it straight
// into the drawbox arg list.
function piecewiseExpr(points: { t: number; v: number }[]): string {
  if (points.length === 0) return '0';
  if (points.length === 1) return fmt(points[0]!.v);
  // Build right-to-left: the deepest else is the last endpoint.
  const last = points[points.length - 1]!;
  let expr = fmt(last.v);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dt = b.t - a.t;
    // a.v + (t - a.t) * (b.v - a.v) / (b.t - a.t)
    const slope = dt === 0 ? 0 : (b.v - a.v) / dt;
    // Wrap the slope in its own parens so a leading minus sign can't fuse
    // with the preceding `*` and confuse the expression parser.
    const segment = `(${fmt(a.v)}+(t-${fmt(a.t)})*(${fmt(slope)}))`;
    expr = `if(lt(t\\,${fmt(b.t)})\\,${segment}\\,${expr})`;
  }
  return expr;
}

// Thin a recorded marker path down to at most `maxSegments` segments. Keeps
// the first and last samples exact and picks ~evenly-spaced points in between.
// Linear interpolation between ~40 keypoints over a few seconds is visually
// indistinguishable from a denser path, but the resulting ffmpeg expression
// is far smaller and ffmpeg's parser handles it comfortably.
function thinPathForExport<T>(path: T[], maxSegments = 40): T[] {
  if (path.length <= maxSegments + 1) return path;
  const factor = Math.ceil((path.length - 1) / maxSegments);
  const out: T[] = [path[0]!];
  for (let i = factor; i < path.length - 1; i += factor) {
    out.push(path[i]!);
  }
  out.push(path[path.length - 1]!);
  return out;
}

// Brand font for drawtext (player name labels, watermark). Oswald Bold — a
// condensed sans-serif that matches the broadcast-style typography used in
// football highlight reels. Bundled with the app so output looks identical
// across Windows / macOS / Linux instead of falling back to whatever each
// OS's "Arial" happens to render.
//
// Path resolution mirrors runner.ts's ffmpeg-static handling: in dev,
// __dirname sits inside dist-electron/main/ffmpeg/ (or src/main/ffmpeg/
// under ts-jest); in a packaged build the file is unpacked from app.asar
// into app.asar.unpacked (see asarUnpack in electron-builder.yml). ffmpeg
// drawtext on Windows wants forward slashes inside the filter expression.
function fontFilePath(): string {
  const bundled = path.resolve(__dirname, '..', 'assets', 'fonts', 'Oswald-Bold.ttf')
    .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    .replace(/\\/g, '/');
  return bundled;
}

// Escape a label for use inside drawtext's `text='...'` single-quoted value.
// Inside single quotes, only backslash and single quote need escaping. We
// strip single quotes outright (rare in player names, simpler than dealing
// with the escape sequence).
function escapeDrawtextLabel(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, '');
}

// Marker coordinates are stored in source pixels. After the crop+scale step
// the frame is back at source resolution but only contains the zoomed region,
// so we map (mx, my, mw, mh) into that post-scale space:
//   post_x = (m.x - zoom.x) * sourceW / zoom.width
// The `enable` expression uses time relative to the clip's in-point because
// `-ss clip.in` shifts the input timeline so t=0 is clip.in.
const BOTTOM_THICKNESS = 4;

// Uniform stroke thickness for oval markers. Rect markers have an asymmetric
// look (1px outline + 4px bottom bar); ovals get a single thicker stroke.
const OVAL_THICKNESS = 4;

// ffmpeg's `geq` filter takes RGB values 0–255, not colour names. Map each
// colour the UI can pick to its triplet. Anything missing falls back to
// yellow (matches the UI default).
const COLOR_RGB: Record<string, { r: number; g: number; b: number }> = {
  yellow: { r: 255, g: 255, b: 0 },
  red: { r: 255, g: 0, b: 0 },
  lime: { r: 0, g: 255, b: 0 },
  cyan: { r: 0, g: 255, b: 255 },
  magenta: { r: 255, g: 0, b: 255 },
  orange: { r: 255, g: 165, b: 0 },
  white: { r: 255, g: 255, b: 255 },
};

function colorRgb(name: string): { r: number; g: number; b: number } {
  return COLOR_RGB[name] ?? COLOR_RGB.yellow!;
}

// drawbox evaluates x/y/w/h expressions ONCE at filter init (when t is NaN),
// not per frame, so an expression of `t` would freeze at its init value. There
// is no eval=frame option for drawbox. To draw a moving box we instead emit
// one drawbox per path segment with constant x/y and a time-windowed `enable`,
// so each segment's box only renders during its own slice.
const DRAWBOX_MAX_SEGMENTS = 200;
// drawtext, by contrast, does re-evaluate x/y per frame, so its label can use
// a piecewise expression of t. We keep that path tighter to avoid stressing
// the expression parser with deeply nested if() chains.
const DRAWTEXT_MAX_SEGMENTS = 40;

// One pair of drawboxes per marker visible at (x, y): a 1px outline for the
// full rectangle plus a filled BOTTOM_THICKNESS-tall bar along the bottom edge
// (drawbox takes a single thickness for all four sides, so this is how we
// give the bottom a thicker line).
function boxStamp(
  color: string, x: number, y: number, w: number, h: number, enable: string,
): string {
  const outline = `drawbox=x=${fmt(x)}:y=${fmt(y)}:w=${fmt(w)}:h=${fmt(h)}:color=${color}:t=1:${enable}`;
  const bottom = `drawbox=x=${fmt(x)}:y=${fmt(y + h - BOTTOM_THICKNESS)}:w=${fmt(w)}:h=${BOTTOM_THICKNESS}:color=${color}:t=fill:${enable}`;
  return `${outline},${bottom}`;
}

// One geq filter per oval stamp. Tests each pixel against an outer ellipse
// (≤ 1) and an inner ellipse (> 1) and overwrites the pixel with the marker
// colour when it falls inside the outline ring. cx and cy are constants —
// for a moving oval we emit one of these per path segment with a time-
// windowed enable, mirroring how drawbox handles tracked rects. That keeps
// each expression short; embedding a big piecewise t-expression here causes
// ffmpeg's parser to choke (the expression is referenced six times across
// the r/g/b channels and inner/outer ellipse tests).
function ovalGeq(
  cx: number, cy: number,
  rx: number, ry: number, thick: number,
  color: { r: number; g: number; b: number },
  enable: string,
): string {
  const rxIn = Math.max(1, rx - thick);
  const ryIn = Math.max(1, ry - thick);
  const dx = `(X-${fmt(cx)})`;
  const dy = `(Y-${fmt(cy)})`;
  const rx2 = fmt(rx * rx);
  const ry2 = fmt(ry * ry);
  const rxIn2 = fmt(rxIn * rxIn);
  const ryIn2 = fmt(ryIn * ryIn);
  const outer = `lte(${dx}*${dx}/${rx2}+${dy}*${dy}/${ry2}\\,1)`;
  const notInner = `gt(${dx}*${dx}/${rxIn2}+${dy}*${dy}/${ryIn2}\\,1)`;
  const onOutline = `(${outer})*(${notInner})`;
  const rExp = `if(${onOutline}\\,${color.r}\\,r(X\\,Y))`;
  const gExp = `if(${onOutline}\\,${color.g}\\,g(X\\,Y))`;
  const bExp = `if(${onOutline}\\,${color.b}\\,b(X\\,Y))`;
  return `geq=r='${rExp}':g='${gExp}':b='${bExp}':${enable}`;
}

function labelDrawtext(
  color: string, label: string, ph: number, pw: number,
  xExpr: string, yExpr: string, enable: string,
): string {
  const text = escapeDrawtextLabel(label);
  const fontSize = Math.max(20, Math.round(ph * 0.16));
  // Centre the label horizontally on the box and place it just below.
  // text_w is a runtime variable drawtext fills in with the rendered
  // string's pixel width.
  const textX = `(${xExpr})+${fmt(pw)}/2-text_w/2`;
  const textY = `(${yExpr})+${fmt(ph)}+8`;
  return `drawtext=fontfile='${fontFilePath()}':text='${text}'`
    + `:x='${textX}':y='${textY}'`
    + `:fontcolor=${color}:fontsize=${fontSize}`
    + `:box=1:boxcolor=black@0.6:boxborderw=4:${enable}`;
}

function buildMarkerFilters(clip: Clip, source: SourceMeta): string {
  if (clip.focusMarkers.length === 0) return '';
  const z = clip.zoom;
  const scaleX = source.width / z.width;
  const scaleY = source.height / z.height;
  // geq operates on RGB; rect markers' drawbox/drawtext work in either space,
  // so when any oval is present we run the whole marker chain in rgba and
  // convert back to yuv420p afterwards. This keeps colours consistent across
  // shapes without paying the format conversion cost when there are no ovals.
  const hasOval = clip.focusMarkers.some(m => (m.shape ?? 'rect') === 'oval');

  const perMarker = clip.focusMarkers.map((m: FocusMarker) => {
    const pw = m.width * scaleX;
    const ph = m.height * scaleY;
    const relIn = Math.max(0, m.in - clip.in);
    const relOut = Math.max(relIn, m.out - clip.in);
    const isOval = (m.shape ?? 'rect') === 'oval';

    if (m.path && m.path.length > 0) {
      const enable = `enable='between(t\\,${fmt(relIn)}\\,${fmt(relOut)})'`;
      const exprPath = thinPathForExport(m.path, DRAWTEXT_MAX_SEGMENTS);
      const xTL = exprPath.map(p => ({ t: p.t, v: (p.cx - z.x) * scaleX - pw / 2 }));
      const yTL = exprPath.map(p => ({ t: p.t, v: (p.cy - z.y) * scaleY - ph / 2 }));
      const xTLExpr = piecewiseExpr(xTL);
      const yTLExpr = piecewiseExpr(yTL);

      // Both shapes use the same per-segment stamping pattern: one filter per
      // path point with constant position and a time-windowed enable. For
      // ovals this avoids inlining the (long) piecewise t-expression into
      // the geq's r/g/b/inner/outer terms, which caused ffmpeg's expression
      // parser to fail on real-world tracks of ~30+ samples.
      const stampPath = thinPathForExport(m.path, DRAWBOX_MAX_SEGMENTS);
      const stamps: string[] = [];
      for (let i = 0; i < stampPath.length; i++) {
        const p = stampPath[i]!;
        const segStart = Math.max(relIn, p.t);
        const rawEnd = i + 1 < stampPath.length ? stampPath[i + 1]!.t : relOut;
        const segEnd = Math.min(relOut, rawEnd);
        if (segEnd <= segStart) continue;
        const segEnable = `enable='between(t\\,${fmt(segStart)}\\,${fmt(segEnd)})'`;
        if (isOval) {
          const cx = (p.cx - z.x) * scaleX;
          const cy = (p.cy - z.y) * scaleY;
          stamps.push(ovalGeq(cx, cy, pw / 2, ph / 2, OVAL_THICKNESS, colorRgb(m.color), segEnable));
        } else {
          const x = (p.cx - z.x) * scaleX - pw / 2;
          const y = (p.cy - z.y) * scaleY - ph / 2;
          stamps.push(boxStamp(m.color, x, y, pw, ph, segEnable));
        }
      }
      let result = stamps.join(',');

      if (m.label) {
        // drawtext re-evaluates x/y per frame, so a piecewise expression gives
        // smooth label motion that follows the marker (same for both shapes).
        result += ',' + labelDrawtext(m.color, m.label, ph, pw, xTLExpr, yTLExpr, enable);
      }
      return result;
    }

    // Static marker: a single filter (geq for oval, drawbox-pair for rect)
    // for the marker's whole enable window, plus an optional label.
    const xVal = (m.x - z.x) * scaleX;
    const yVal = (m.y - z.y) * scaleY;
    const enable = `enable='between(t\\,${fmt(relIn)}\\,${fmt(relOut)})'`;
    let result: string;
    if (isOval) {
      const cx = xVal + pw / 2;
      const cy = yVal + ph / 2;
      result = ovalGeq(cx, cy, pw / 2, ph / 2, OVAL_THICKNESS, colorRgb(m.color), enable);
    } else {
      result = boxStamp(m.color, xVal, yVal, pw, ph, enable);
    }
    if (m.label) {
      result += ',' + labelDrawtext(m.color, m.label, ph, pw, fmt(xVal), fmt(yVal), enable);
    }
    return result;
  }).join(',');

  if (!hasOval) return perMarker;
  return `format=rgba,${perMarker},format=yuv420p`;
}

// Brand watermark burned into every exported clip. White text with a thin
// black outline so it stays legible on busy backgrounds. Font size scales
// with source height, and x is set to ~10% of the source width — at 1080p
// this lands the text well clear of the safe-area cropping that some
// players (and social-media uploaders) apply to the leftmost ~150px.
const WATERMARK_TEXT = 'Made with getreelmagic.co.uk';

function watermarkFilter(source: SourceMeta): string {
  const text = escapeDrawtextLabel(WATERMARK_TEXT);
  const fontSize = Math.max(14, Math.round(source.height * 0.022));
  const x = Math.round(source.width * 0.1);
  const y = Math.max(12, Math.round(source.height * 0.02));
  return `drawtext=fontfile='${fontFilePath()}':text='${text}'`
    + `:x=${x}:y=${y}`
    + `:fontcolor=white:fontsize=${fontSize}`
    + `:borderw=2:bordercolor=black@0.7`;
}

// Watermark sized for the IG canvas. The standard `watermarkFilter` scales
// font size against source.height — fine for landscape (height is the short
// dimension) but on portrait that gives an oversized 42px font. We scale
// against the SHORTER dimension to keep the watermark visually consistent
// with standard exports (~24px on a 1080×1920 IG canvas, matching ~24px on
// a 1920×1080 standard export).
export function instagramWatermarkFilter(width: number, height: number): string {
  const text = escapeDrawtextLabel(WATERMARK_TEXT);
  const shortDim = Math.min(width, height);
  const fontSize = Math.max(14, Math.round(shortDim * 0.022));
  const x = Math.round(width * 0.1);
  const y = Math.max(12, Math.round(shortDim * 0.02));
  return `drawtext=fontfile='${fontFilePath()}':text='${text}'`
    + `:x=${x}:y=${y}`
    + `:fontcolor=white:fontsize=${fontSize}`
    + `:borderw=2:bordercolor=black@0.7`;
}

// Build args for re-encoding the outro into a part that matches the clip
// parts (same resolution, codec, audio params, framerate, SAR) so the concat
// step doesn't get a parameter mismatch — that mismatch was producing files
// where the outro slot played the previous clip's last frame frozen.
//
// The outro is scaled to fit inside the source frame preserving aspect
// ratio, then padded with black so it sits centred on a source-sized canvas.
// `fps=` and `setsar=1` force timing parameters to match the clip parts;
// `-vsync cfr` and `-r` enforce a constant framerate output. If `hasAudio`
// is false we splice in a silent stereo track because the other parts have
// audio and the concat rejects streams whose layouts differ.
export function buildOutroFfmpegArgs(
  outroPath: string,
  source: SourceMeta,
  outputPath: string,
  hasAudio: boolean,
): string[] {
  const fps = fmt(source.fps);
  const filter = `[0:v]scale=${source.width}:${source.height}:force_original_aspect_ratio=decrease`
    + `,pad=${source.width}:${source.height}:(ow-iw)/2:(oh-ih)/2:color=black`
    + `,fps=${fps},setsar=1`
    + `,setpts=PTS-STARTPTS[v]`;

  const head = ['-y', '-i', outroPath];
  const audioInput = hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=cl=stereo:r=48000'];
  const fc = ['-filter_complex', filter];
  const map = hasAudio
    ? ['-map', '[v]', '-map', '0:a']
    : ['-map', '[v]', '-map', '1:a', '-shortest'];
  const enc = [
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-r', fps,
    '-vsync', 'cfr',
    // Force the encoded DAR to the source's natural aspect so libx264 writes
    // SAR=1 into the SPS. Without this, libx264 sometimes writes weird SARs
    // like 2025:2024 to satisfy a non-square input's exact DAR, which then
    // mismatches the clip parts (SAR 1:1) and crashes the concat filter.
    '-aspect', `${source.width}:${source.height}`,
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
  ];

  return [...head, ...audioInput, ...fc, ...map, ...enc, outputPath];
}

// IG variant of buildOutroFfmpegArgs. The outro file is letterboxed/scaled
// to fit 1080×1920. Used both when the user has set a 9:16 outro file (it
// already fits — the scale+pad is a no-op effectively) and when we're
// reusing the standard 16:9 outro for the IG export (it gets rescaled with
// black bars top and bottom).
export function buildInstagramOutroFfmpegArgs(
  outroPath: string,
  source: SourceMeta,
  outputPath: string,
  hasAudio: boolean,
): string[] {
  const fps = fmt(source.fps);
  const filter = `[0:v]scale=${INSTAGRAM_REEL_WIDTH}:${INSTAGRAM_REEL_HEIGHT}:force_original_aspect_ratio=decrease`
    + `,pad=${INSTAGRAM_REEL_WIDTH}:${INSTAGRAM_REEL_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`
    + `,fps=${fps},setsar=1`
    + `,setpts=PTS-STARTPTS[v]`;

  const head = ['-y', '-i', outroPath];
  const audioInput = hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=cl=stereo:r=48000'];
  const fc = ['-filter_complex', filter];
  const map = hasAudio
    ? ['-map', '[v]', '-map', '0:a']
    : ['-map', '[v]', '-map', '1:a', '-shortest'];
  const enc = [
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-r', fps,
    '-vsync', 'cfr',
    '-aspect', `${INSTAGRAM_REEL_WIDTH}:${INSTAGRAM_REEL_HEIGHT}`,
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
  ];

  return [...head, ...audioInput, ...fc, ...map, ...enc, outputPath];
}

export function buildClipFfmpegArgs(
  clip: Clip,
  source: SourceMeta,
  outputPath: string,
  opts?: { forceSilentAudio?: boolean },
): string[] {
  const { x, y, width, height } = clip.zoom;
  // Use PTS-STARTPTS so the output's first frame has timestamp 0 regardless of
  // where -ss landed on a keyframe. Some players (notably older VLC builds)
  // misbehave on second playback when the file's first frame has a non-zero
  // PTS.
  const setpts = clip.speed === 1 ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${fmt(clip.speed)}`;
  const markerFilters = buildMarkerFilters(clip, source);
  // Watermark is placed AFTER markers so it sits on top of any focus marker
  // that happens to overlap the top-left corner — branding stays visible.
  const watermark = watermarkFilter(source);
  const videoFilter = `[0:v]crop=${fmt(width)}:${fmt(height)}:${fmt(x)}:${fmt(y)},scale=${source.width}:${source.height}${markerFilters ? ',' + markerFilters : ''},${watermark}${brightnessFilter(clip.brightness)},setpts=${setpts}[v]`;

  const head = ['-y', '-ss', fmt(clip.in), '-to', fmt(clip.out), '-i', source.path];
  const hasBacking = !!clip.backingTrack && clip.backingTrack.path.length > 0;
  // Backing-track input goes after the source video so its filter graph can
  // reference it as [1:a]. The legacy anullsrc for slow-mo only applies when
  // there's no backing track — otherwise the backing track IS the audio.
  // `forceSilentAudio` (used by the sequence-with-backing-track pipeline)
  // promotes the speed!=1 anullsrc path to apply at speed=1 too, so each
  // clip part contributes silent audio to the concat — the sequence-level
  // track then mixes over the whole thing.
  const backing = hasBacking ? buildBackingAudio(clip, 1) : null;
  const needSilent = !backing && (opts?.forceSilentAudio || clip.speed !== 1);
  const audioInput = backing
    ? backing.inputs
    : (needSilent ? ['-f', 'lavfi', '-i', 'anullsrc=cl=stereo:r=48000'] : []);

  const filter = backing ? `${videoFilter};${backing.filter}` : videoFilter;
  const fc = ['-filter_complex', filter];

  let map: string[];
  if (backing) {
    map = ['-map', '[v]', '-map', backing.audioMap, '-shortest'];
  } else if (needSilent) {
    map = ['-map', '[v]', '-map', '1:a', '-shortest'];
  } else {
    map = ['-map', '[v]', '-map', '0:a?'];
  }
  const enc = [
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
  ];

  return [...head, ...audioInput, ...fc, ...map, ...enc, outputPath];
}

// IG variant of buildClipFfmpegArgs. Pipeline:
//   [optional] markers (drawn in SOURCE space — no focus-box zoom for reels)
//   → crop(cropSide × cropSide, full height, at x(t))   // square slice
//   → scale(1080:1080)
//   → pad(1080:1920, black bars top/bottom)
//   → IG watermark → brightness → setpts → [v]
//
// `samples` carry the (smoothed, clamped, thinned) crop rect over time. cy/w/h
// are constant (square, centred); only cx varies. crop re-evaluates x per frame
// from a piecewise expression of `t` (clip-relative, since -ss shifts t=0 to
// clip.in).
export function buildInstagramClipFfmpegArgs(
  clip: Clip,
  source: SourceMeta,
  samples: ReelFramingSample[],
  outputPath: string,
  opts?: { forceSilentAudio?: boolean },
): string[] {
  const side = reelCropSide(source);
  const cropY = (source.height - side) / 2; // 0 for landscape (side === srcH)
  const xPts = samples.map(s => ({ t: s.t, v: s.cx - side / 2 }));
  const xExpr = piecewiseExpr(xPts);

  const setpts = clip.speed === 1 ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${fmt(clip.speed)}`;
  // Reels ignore the clip's focus-box zoom, so markers are drawn against the
  // full source frame. Passing a full-frame zoom makes buildMarkerFilters use
  // an identity (scale=1, offset=0) source→frame mapping.
  const fullZoom = { x: 0, y: 0, width: source.width, height: source.height };
  const markerFilters = buildMarkerFilters({ ...clip, zoom: fullZoom }, source);
  const igWatermark = instagramWatermarkFilter(INSTAGRAM_REEL_WIDTH, INSTAGRAM_REEL_HEIGHT);
  const padY = (INSTAGRAM_REEL_HEIGHT - INSTAGRAM_REEL_WIDTH) / 2;

  const videoFilter = `[0:v]`
    + (markerFilters ? `${markerFilters},` : '')
    + `crop=${fmt(side)}:${fmt(side)}:${xExpr}:${fmt(cropY)}`
    + `,scale=${INSTAGRAM_REEL_WIDTH}:${INSTAGRAM_REEL_WIDTH}`
    + `,pad=${INSTAGRAM_REEL_WIDTH}:${INSTAGRAM_REEL_HEIGHT}:0:${fmt(padY)}:color=black`
    + `,${igWatermark}`
    + brightnessFilter(clip.brightness)
    + `,setpts=${setpts}[v]`;

  const head = ['-y', '-ss', fmt(clip.in), '-to', fmt(clip.out), '-i', source.path];
  const hasBacking = !!clip.backingTrack && clip.backingTrack.path.length > 0;
  const backing = hasBacking ? buildBackingAudio(clip, 1) : null;
  const needSilent = !backing && (opts?.forceSilentAudio || clip.speed !== 1);
  const audioInput = backing
    ? backing.inputs
    : (needSilent ? ['-f', 'lavfi', '-i', 'anullsrc=cl=stereo:r=48000'] : []);

  const filter = backing ? `${videoFilter};${backing.filter}` : videoFilter;
  const fc = ['-filter_complex', filter];

  let map: string[];
  if (backing) {
    map = ['-map', '[v]', '-map', backing.audioMap, '-shortest'];
  } else if (needSilent) {
    map = ['-map', '[v]', '-map', '1:a', '-shortest'];
  } else {
    map = ['-map', '[v]', '-map', '0:a?'];
  }
  const enc = [
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-aspect', `${INSTAGRAM_REEL_WIDTH}:${INSTAGRAM_REEL_HEIGHT}`,
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
  ];

  return [...head, ...audioInput, ...fc, ...map, ...enc, outputPath];
}
