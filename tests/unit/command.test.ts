import path from 'path';
import { buildClipFfmpegArgs, buildOutroFfmpegArgs } from '../../src/main/ffmpeg/command';
import type { Clip, SourceMeta } from '../../src/shared/types';

// Mirrors the bundled-font path resolution in command.ts:fontFilePath().
// Tests run under ts-jest, so __dirname for the command module sits at
// src/main/ffmpeg — the resolved path lands on the real bundled font.
const BUNDLED_FONT = path
  .resolve(__dirname, '..', '..', 'src', 'main', 'assets', 'fonts', 'Oswald-Bold.ttf')
  .replace(/\\/g, '/');

const source: SourceMeta = { path: '/in.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };
const baseClip: Clip = {
  id: 'c1', name: 'A', in: 10, out: 20, speed: 1,
  zoom: { x: 0, y: 0, width: 1920, height: 1080 },
  focusMarkers: [],
};

// Mirrors the watermark string the implementation appends to every clip's
// filter chain. Uses the bundled brand font shared with marker labels.
function expectedWatermark(s: SourceMeta): string {
  const fontSize = Math.max(14, Math.round(s.height * 0.022));
  const x = Math.round(s.width * 0.1);
  const y = Math.max(12, Math.round(s.height * 0.02));
  return `drawtext=fontfile='${BUNDLED_FONT}':text='Made with getreelmagic.co.uk'`
    + `:x=${x}:y=${y}`
    + `:fontcolor=white:fontsize=${fontSize}`
    + `:borderw=2:bordercolor=black@0.7`;
}

test('builds args for full-frame, 1x speed', () => {
  const args = buildClipFfmpegArgs(baseClip, source, '/out.mp4');
  expect(args).toEqual([
    '-y',
    '-ss', '10', '-to', '20', '-i', '/in.mp4',
    '-filter_complex', `[0:v]crop=1920:1080:0:0,scale=1920:1080,${expectedWatermark(source)},setpts=PTS-STARTPTS[v]`,
    '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
    '/out.mp4',
  ]);
});

test('uses silent audio and (PTS-STARTPTS)/s when speed != 1', () => {
  const clip: Clip = { ...baseClip, speed: 0.5 };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  expect(args).toContain('-f');
  expect(args).toContain('lavfi');
  expect(args).toContain('anullsrc=cl=stereo:r=48000');
  const fcIndex = args.indexOf('-filter_complex');
  expect(args[fcIndex + 1]).toBe(`[0:v]crop=1920:1080:0:0,scale=1920:1080,${expectedWatermark(source)},setpts=(PTS-STARTPTS)/0.5,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:vsbmc=1:scd=none[v]`);
  expect(args).toContain('-shortest');
  expect(args).toContain('1:a');
});

test('slow-mo adds motion interpolation after setpts; normal speed does not', () => {
  const slow = buildClipFfmpegArgs({ ...baseClip, speed: 0.5 }, source, '/out.mp4');
  const slowFc = slow[slow.indexOf('-filter_complex') + 1]!;
  // minterpolate comes immediately after the slowing setpts.
  expect(slowFc).toContain('setpts=(PTS-STARTPTS)/0.5,minterpolate=fps=30:mi_mode=mci');

  const normal = buildClipFfmpegArgs(baseClip, source, '/out.mp4');
  expect(normal[normal.indexOf('-filter_complex') + 1]!).not.toContain('minterpolate');
});

test('uses zoom rect in crop and rescales to source size', () => {
  const clip: Clip = { ...baseClip, zoom: { x: 100, y: 50, width: 640, height: 360 } };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIndex = args.indexOf('-filter_complex');
  expect(args[fcIndex + 1]).toBe(`[0:v]crop=640:360:100:50,scale=1920:1080,${expectedWatermark(source)},setpts=PTS-STARTPTS[v]`);
});

test('formats fractional seconds without exponent', () => {
  const clip: Clip = { ...baseClip, in: 12.4, out: 18.75 };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const ssIdx = args.indexOf('-ss');
  expect(args[ssIdx + 1]).toBe('12.4');
  const toIdx = args.indexOf('-to');
  expect(args[toIdx + 1]).toBe('18.75');
});

test('emits drawbox filter for each focus marker (full-frame zoom)', () => {
  const clip: Clip = {
    ...baseClip,
    focusMarkers: [
      { id: 'm1', x: 100, y: 200, width: 80, height: 80, in: 12, out: 18, color: 'yellow' },
    ],
  };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIndex = args.indexOf('-filter_complex');
  // marker times are clip-relative: in=12 -> relIn=2, out=18 -> relOut=8
  // outline (t=1) + filled 4px bottom bar at y = 200 + 80 - 4 = 276
  expect(args[fcIndex + 1]).toBe(
    "[0:v]crop=1920:1080:0:0,scale=1920:1080,"
    + "drawbox=x=100:y=200:w=80:h=80:color=yellow:t=1:enable='between(t\\,2\\,8)',"
    + "drawbox=x=100:y=276:w=80:h=4:color=yellow:t=fill:enable='between(t\\,2\\,8)',"
    + `${expectedWatermark(source)},`
    + "setpts=PTS-STARTPTS[v]"
  );
});

test('emits per-segment drawboxes for a path-based marker', () => {
  // drawbox can't follow an expression of t (it evaluates x/y once at filter
  // init), so a tracked path is rendered as one drawbox per path segment with
  // a constant position and a time-windowed enable. 3 path points → 3 segments.
  const clip: Clip = {
    ...baseClip,
    focusMarkers: [
      {
        id: 'm1', x: 100, y: 100, width: 80, height: 80,
        in: 10, out: 14, color: 'yellow',
        path: [
          { t: 0, cx: 100, cy: 200 },   // top-left = (60, 160)
          { t: 1, cx: 200, cy: 200 },   // top-left = (160, 160)
          { t: 2, cx: 200, cy: 400 },   // top-left = (160, 360)
        ],
      },
    ],
  };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIndex = args.indexOf('-filter_complex');
  const filter = args[fcIndex + 1]!;
  // relIn = 0, relOut = 4. Last segment extends from t=2 to relOut=4.
  // Each segment emits an outline (t=1) + bottom bar (t=fill, h=4).
  // Bottom bar y = top-left y + 80 - 4 = top-left y + 76.
  expect(filter).toContain("drawbox=x=60:y=160:w=80:h=80:color=yellow:t=1:enable='between(t\\,0\\,1)'");
  expect(filter).toContain("drawbox=x=60:y=236:w=80:h=4:color=yellow:t=fill:enable='between(t\\,0\\,1)'");
  expect(filter).toContain("drawbox=x=160:y=160:w=80:h=80:color=yellow:t=1:enable='between(t\\,1\\,2)'");
  expect(filter).toContain("drawbox=x=160:y=236:w=80:h=4:color=yellow:t=fill:enable='between(t\\,1\\,2)'");
  expect(filter).toContain("drawbox=x=160:y=360:w=80:h=80:color=yellow:t=1:enable='between(t\\,2\\,4)'");
  expect(filter).toContain("drawbox=x=160:y=436:w=80:h=4:color=yellow:t=fill:enable='between(t\\,2\\,4)'");
  // No eval= options on drawbox — it doesn't support them, and we don't need them.
  expect(filter).not.toContain(':eval=');
});

test('uses piecewise-expr drawtext for a path-based marker label', () => {
  // drawtext does re-evaluate x/y per frame, so the label still uses the
  // piecewise expression to follow the marker smoothly.
  const clip: Clip = {
    ...baseClip,
    focusMarkers: [
      {
        id: 'm1', x: 100, y: 100, width: 80, height: 80,
        in: 10, out: 14, color: 'yellow', label: 'Striker',
        path: [
          { t: 0, cx: 100, cy: 200 },
          { t: 1, cx: 200, cy: 200 },
        ],
      },
    ],
  };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIndex = args.indexOf('-filter_complex');
  const filter = args[fcIndex + 1]!;
  expect(filter).toContain('drawtext=');
  expect(filter).toContain("text='Striker'");
  // x/y are wrapped in single quotes and reference the if(lt(t,...)) form.
  expect(filter).toContain("x='(if(lt(t\\,1)");
  expect(filter).toContain("y='(if(lt(t\\,1)");
});

test('emits geq-based oval filter wrapped in format=rgba/yuv420p', () => {
  // Oval markers can't be drawn with drawbox, so the export pipeline switches
  // into rgba, runs a geq filter that paints pixels falling on the ellipse
  // outline ring, and converts back to yuv420p. The format conversion only
  // happens when at least one oval marker exists on the clip.
  const clip: Clip = {
    ...baseClip,
    focusMarkers: [
      { id: 'm1', x: 100, y: 200, width: 80, height: 80, in: 12, out: 18, color: 'red', shape: 'oval' },
    ],
  };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIndex = args.indexOf('-filter_complex');
  const filter = args[fcIndex + 1]!;
  expect(filter).toContain(',format=rgba,');
  expect(filter).toContain(',format=yuv420p,');
  expect(filter).toContain('geq=');
  // Red is mapped to (255, 0, 0) — geq takes RGB triplets, not colour names.
  expect(filter).toContain('255');
  // Marker is centred at (140, 240) with rx=ry=40; outline thickness 4px.
  expect(filter).toContain('(X-140)');
  expect(filter).toContain('(Y-240)');
  // Time-window enable still kicks in just like the rect path.
  expect(filter).toContain("enable='between(t\\,2\\,8)'");
  expect(filter).not.toContain('drawbox=');
});

test('emits per-segment geq filters for a path-based oval marker', () => {
  // A path-based oval can't inline the piecewise cx/cy expression into geq —
  // the expression gets referenced six times across r/g/b channels and
  // inner/outer ellipse tests, blowing past ffmpeg's expression parser limit
  // on real-world tracks. Instead we stamp one geq per path segment, each
  // with constant cx/cy and a time-windowed enable (mirroring rect drawbox).
  const clip: Clip = {
    ...baseClip,
    focusMarkers: [
      {
        id: 'm1', x: 100, y: 100, width: 80, height: 80,
        in: 10, out: 14, color: 'cyan', shape: 'oval',
        path: [
          { t: 0, cx: 100, cy: 200 },
          { t: 1, cx: 200, cy: 200 },
          { t: 2, cx: 200, cy: 400 },
        ],
      },
    ],
  };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIndex = args.indexOf('-filter_complex');
  const filter = args[fcIndex + 1]!;
  // Each segment is a fresh geq with constant centre and its own enable
  // window. No piecewise t-expression should appear inside the geq args.
  expect(filter.match(/geq=/g)?.length).toBe(3);
  expect(filter).toContain('(X-100)');
  expect(filter).toContain('(X-200)');
  expect(filter).toContain("enable='between(t\\,0\\,1)'");
  expect(filter).toContain("enable='between(t\\,1\\,2)'");
  expect(filter).toContain("enable='between(t\\,2\\,4)'");
  // The geq expressions must not contain `if(lt(t,...)` — that would mean
  // we still embedded the piecewise t-expression that broke the parser.
  expect(filter).not.toMatch(/geq=[^,]*if\(lt\(t/);
});

test('burns the getreelmagic.co.uk watermark into every clip export', () => {
  // Branding sits in the top-left safe-area of every export, indented ~10%
  // of source width so it clears the left-edge cropping that some players
  // and social uploads apply. It goes after the marker filters so a focus
  // marker that overlaps the corner can't hide it.
  const args = buildClipFfmpegArgs(baseClip, source, '/out.mp4');
  const fcIndex = args.indexOf('-filter_complex');
  const filter = args[fcIndex + 1]!;
  expect(filter).toContain("text='Made with getreelmagic.co.uk'");
  expect(filter).toContain('fontcolor=white');
  expect(filter).toContain('fontsize=24');
  // 10% of 1920 = 192; y stays a thin top margin (~22 at 1080p).
  expect(filter).toContain('x=192:y=22');
  expect(filter).toContain('borderw=2');
  // The watermark is the last thing rendered before setpts (anything after
  // setpts wouldn't get burned in correctly).
  expect(filter).toMatch(/drawtext=[^,]+,setpts=/);
});

test('rect-only clips do not pay the format=rgba conversion cost', () => {
  // Sanity check: when there are no ovals we keep the YUV-native pipeline so
  // exports of legacy projects don't regress on speed.
  const clip: Clip = {
    ...baseClip,
    focusMarkers: [
      { id: 'm1', x: 100, y: 200, width: 80, height: 80, in: 12, out: 18, color: 'yellow' },
    ],
  };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIndex = args.indexOf('-filter_complex');
  const filter = args[fcIndex + 1]!;
  expect(filter).not.toContain('format=rgba');
  expect(filter).not.toContain('format=yuv420p,');
  expect(filter).toContain('drawbox=');
});

test('outro args: scale-fit + black pad to source canvas, outro audio when present', () => {
  const args = buildOutroFfmpegArgs('/outro.mp4', source, '/part-outro.mp4', true);
  const fcIndex = args.indexOf('-filter_complex');
  // fps + setsar in the filter, plus -r and -vsync cfr in the encoder, are
  // what stop the concat from desyncing into a frozen-frame outro.
  expect(args[fcIndex + 1]).toBe(
    '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease'
    + ',pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black'
    + ',fps=30,setsar=1'
    + ',setpts=PTS-STARTPTS[v]'
  );
  // Outro has audio: only one input, map [v] + 0:a, no -shortest.
  expect(args.filter(a => a === '-i')).toHaveLength(1);
  expect(args).toContain('0:a');
  expect(args).not.toContain('-shortest');
  // Encoder settings match clip parts so the concat demuxer can re-mux them.
  expect(args).toContain('libx264');
  expect(args).toContain('yuv420p');
  expect(args).toContain('aac');
  // Force constant framerate at the configured fps.
  const rIdx = args.indexOf('-r');
  expect(rIdx).toBeGreaterThanOrEqual(0);
  expect(args[rIdx + 1]).toBe('30');
  expect(args).toContain('-vsync');
  expect(args).toContain('cfr');
  // Force DAR matching source so libx264 encodes SAR=1 into the SPS
  // instead of choosing weird ratios (e.g. 2025:2024) that mismatch the
  // clip parts and crash the concat filter.
  const aspIdx = args.indexOf('-aspect');
  expect(aspIdx).toBeGreaterThanOrEqual(0);
  expect(args[aspIdx + 1]).toBe('1920:1080');
});

test('outro args: silent track when source has no audio', () => {
  const args = buildOutroFfmpegArgs('/outro.mp4', source, '/part-outro.mp4', false);
  // Two inputs: outro + anullsrc.
  const inputs = args.reduce((n, a) => n + (a === '-i' ? 1 : 0), 0);
  expect(inputs).toBe(2);
  expect(args).toContain('anullsrc=cl=stereo:r=48000');
  expect(args).toContain('1:a');
  expect(args).toContain('-shortest');
});

test('marker coords are mapped through the zoom rect', () => {
  // zoom rect is half the source: a marker at source (1000, 500) with size 80x80
  // sits inside the right half of the source, but in the cropped+scaled output
  // it should map to ((1000-960)*2, (500-0)*2) = (80, 1000) with size 160x160.
  const clip: Clip = {
    ...baseClip,
    zoom: { x: 960, y: 0, width: 960, height: 1080 },
    focusMarkers: [
      { id: 'm1', x: 1000, y: 500, width: 80, height: 80, in: 10, out: 20, color: 'red' },
    ],
  };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIndex = args.indexOf('-filter_complex');
  // crop=960:1080:960:0 then scale=1920:1080 (so width scale = 2, height scale = 1)
  // outline (t=1) + filled 4px bottom bar at y = 500 + 80 - 4 = 576
  expect(args[fcIndex + 1]).toBe(
    "[0:v]crop=960:1080:960:0,scale=1920:1080,"
    + "drawbox=x=80:y=500:w=160:h=80:color=red:t=1:enable='between(t\\,0\\,10)',"
    + "drawbox=x=80:y=576:w=160:h=4:color=red:t=fill:enable='between(t\\,0\\,10)',"
    + `${expectedWatermark(source)},`
    + "setpts=PTS-STARTPTS[v]"
  );
});

import { instagramWatermarkFilter } from '../../src/main/ffmpeg/command';

test('instagramWatermarkFilter scales font size against the shorter dimension', () => {
  const filter = instagramWatermarkFilter(1080, 1920);
  expect(filter).toMatch(/fontsize=24/);
  expect(filter).toMatch(/:x=108:/);
  expect(filter).toMatch(/:y=22:/);
  expect(filter).toContain("text='Made with getreelmagic.co.uk'");
  expect(filter).toContain('fontcolor=white');
  expect(filter).toContain('borderw=2:bordercolor=black@0.7');
});

import { buildInstagramOutroFfmpegArgs } from '../../src/main/ffmpeg/command';

test('buildInstagramOutroFfmpegArgs scales/pads to 1080x1920 with audio passthrough', () => {
  const src: SourceMeta = { path: '/in.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };
  const args = buildInstagramOutroFfmpegArgs('/outro.mp4', src, '/out.mp4', true);
  const fcIdx = args.indexOf('-filter_complex');
  expect(args[fcIdx + 1]).toContain('scale=1080:1920:force_original_aspect_ratio=decrease');
  expect(args[fcIdx + 1]).toContain('pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black');
  expect(args[fcIdx + 1]).toContain('fps=30');
  expect(args[fcIdx + 1]).toContain('setsar=1');
  const aspectIdx = args.indexOf('-aspect');
  expect(args[aspectIdx + 1]).toBe('1080:1920');
  expect(args).not.toContain('anullsrc=cl=stereo:r=48000');
});

test('buildInstagramOutroFfmpegArgs synthesises silent audio when source has none', () => {
  const src: SourceMeta = { path: '/in.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };
  const args = buildInstagramOutroFfmpegArgs('/outro.mp4', src, '/out.mp4', false);
  expect(args).toContain('anullsrc=cl=stereo:r=48000');
  expect(args).toContain('-shortest');
});

import { buildInstagramClipFfmpegArgs } from '../../src/main/ffmpeg/command';
import { computeReelFraming } from '../../src/shared/instagramFraming';

test('buildInstagramClipFfmpegArgs applies zoom, then square crop → 1080x1080 → letterbox pad', () => {
  const clip: Clip = { ...baseClip };
  const framing = computeReelFraming(clip, source);
  const args = buildInstagramClipFfmpegArgs(clip, source, framing.samples, '/out.mp4');
  const fcIdx = args.indexOf('-filter_complex');
  const fc = args[fcIdx + 1]!;
  // Focus-box zoom is applied first (full frame for baseClip → crop=1920:1080:0:0),
  // then the square reel slice. cropSide = min(1080,1920) = 1080; centred cx = 960
  // → x = 960 - 540 = 420. (x is a piecewise expr; match its shape.)
  expect(fc).toContain('crop=1920:1080:0:0,scale=1920:1080'); // zoom prefix
  expect(fc).toMatch(/crop=1080:1080:[^:]+:0,scale=1080:1080/); // square reel slice
  expect(fc.match(/crop=/g)?.length).toBe(2);                   // zoom crop + reel crop
  expect(fc).toContain('420'); // the centred x value appears in the expression
  expect(fc).toContain('pad=1080:1920:0:420:color=black');
  expect(fc).toMatch(/fontsize=24/);          // IG watermark sized for short dim
  const aspectIdx = args.indexOf('-aspect');
  expect(args[aspectIdx + 1]).toBe('1080:1920');
});

test('buildInstagramClipFfmpegArgs burns in highlight markers (post-zoom, before the reel slice)', () => {
  const clip: Clip = {
    ...baseClip,
    focusMarkers: [
      { id: 'm1', x: 100, y: 200, width: 80, height: 80, in: 12, out: 18, color: 'yellow' },
    ],
  };
  const framing = computeReelFraming(clip, source);
  const args = buildInstagramClipFfmpegArgs(clip, source, framing.samples, '/out.mp4');
  const fc = args[args.indexOf('-filter_complex') + 1]!;
  expect(fc).toContain('drawbox=');
  // Marker is drawn after the zoom scale but before the square reel slice.
  expect(fc.indexOf('drawbox=')).toBeLessThan(fc.indexOf('crop=1080:1080'));
});

test('buildInstagramClipFfmpegArgs interpolates slow-mo after setpts', () => {
  const clip: Clip = { ...baseClip, speed: 0.5 };
  const framing = computeReelFraming(clip, source);
  const args = buildInstagramClipFfmpegArgs(clip, source, framing.samples, '/out.mp4');
  const fc = args[args.indexOf('-filter_complex') + 1]!;
  expect(fc).toContain('setpts=(PTS-STARTPTS)/0.5,minterpolate=fps=30:mi_mode=mci');
});

test('standard buildClipFfmpegArgs is byte-identical for a fixture clip (regression guard)', () => {
  const args = buildClipFfmpegArgs(baseClip, source, '/out.mp4');
  expect(args).toEqual([
    '-y',
    '-ss', '10', '-to', '20', '-i', '/in.mp4',
    '-filter_complex', `[0:v]crop=1920:1080:0:0,scale=1920:1080,${expectedWatermark(source)},setpts=PTS-STARTPTS[v]`,
    '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
    '/out.mp4',
  ]);
});

// --- backing-track audio chain -----------------------------------------------

test('backing track + mute source: only the mp3 plays, fades out at end', () => {
  const clip: Clip = {
    ...baseClip,
    backingTrack: { path: '/music.mp3', volume: 0.6, muteSource: true },
  };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  // Two inputs: source video and mp3 (no anullsrc when backing track present).
  expect(args.filter(a => a === '-i')).toEqual(['-i', '-i']);
  expect(args).toContain('/music.mp3');
  expect(args).not.toContain('anullsrc=cl=stereo:r=48000');
  // Audio chain references the mp3 input (1:a), volume-scales, length-clamps
  // to the clip's 10s output duration, then fades out in the last 0.5s.
  const fcIdx = args.indexOf('-filter_complex');
  const fc = args[fcIdx + 1]!;
  expect(fc).toContain('[1:a]volume=0.6');
  expect(fc).toContain('atrim=duration=10');
  expect(fc).toContain('afade=t=out:st=9.5:d=0.5');
  expect(fc).toContain('[aout]');
  // Map the synthesised audio, not 0:a.
  const audioMapIdx = args.indexOf('[aout]');
  expect(audioMapIdx).toBeGreaterThanOrEqual(0);
  expect(args).not.toContain('0:a?');
});

test('backing track + keep source at 1x: source mixed with mp3 then faded', () => {
  const clip: Clip = {
    ...baseClip,
    backingTrack: { path: '/music.mp3', volume: 0.4, muteSource: false },
  };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIdx = args.indexOf('-filter_complex');
  const fc = args[fcIdx + 1]!;
  expect(fc).toContain('[1:a]volume=0.4[bg]');
  // amix mixes source [0:a] with the gain-scaled bg; duration=first stops the
  // mix at the source's end (= clip duration); normalize=0 so volume slider
  // behaves as an actual gain control.
  expect(fc).toContain('[0:a][bg]amix=inputs=2:duration=first:normalize=0[mix]');
  expect(fc).toContain('atrim=duration=10');
  expect(fc).toContain('afade=t=out:st=9.5:d=0.5');
});

test('backing track at slow-mo: source is dropped regardless of muteSource flag', () => {
  // At speed != 1 the existing pipeline silences source audio. Backing track
  // takes that slot — the user's "keep source" flag has nothing to keep.
  const clip: Clip = {
    ...baseClip,
    speed: 0.5,
    backingTrack: { path: '/music.mp3', volume: 0.8, muteSource: false },
  };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIdx = args.indexOf('-filter_complex');
  const fc = args[fcIdx + 1]!;
  // Output duration doubles from 10s to 20s at 0.5× speed.
  expect(fc).toContain('atrim=duration=20');
  expect(fc).toContain('afade=t=out:st=19.5:d=0.5');
  // No amix path — backing track plays alone.
  expect(fc).not.toContain('amix=');
  // No silent anullsrc — backing track replaces it as the audio source.
  expect(args).not.toContain('anullsrc=cl=stereo:r=48000');
});

test('clip brightness inserts eq=brightness=N before setpts, after watermark', () => {
  const clip: Clip = { ...baseClip, brightness: 0.3 };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIdx = args.indexOf('-filter_complex');
  const filter = args[fcIdx + 1]!;
  // Order matters: watermark, then eq (so brightness affects the burned-in
  // watermark too — consistent with what the on-screen preview shows), then
  // setpts at the very end.
  expect(filter).toMatch(/borderw=2:bordercolor=black@0\.7,eq=brightness=0\.3,setpts=PTS-STARTPTS\[v\]$/);
});

test('clip brightness omits the eq filter at the default value (regression guard)', () => {
  // brightness=0 should produce the exact same args as no brightness key
  // at all — otherwise existing exports would silently re-encode through
  // a different filter chain.
  const noBrightness = buildClipFfmpegArgs(baseClip, source, '/out.mp4');
  const zeroBrightness = buildClipFfmpegArgs({ ...baseClip, brightness: 0 }, source, '/out.mp4');
  expect(zeroBrightness).toEqual(noBrightness);
  // And tiny rounding noise stays a no-op.
  const epsilonBrightness = buildClipFfmpegArgs({ ...baseClip, brightness: 0.0001 }, source, '/out.mp4');
  expect(epsilonBrightness).toEqual(noBrightness);
});

test('forceSilentAudio swaps the source audio for anullsrc at speed=1', () => {
  // Sequence export with a sequence-wide backing track uses this flag to make
  // each clip part silent before the concat-stage track is mixed over the
  // whole reel. Without the flag, clip parts at speed=1 keep source audio.
  const args = buildClipFfmpegArgs(baseClip, source, '/out.mp4', { forceSilentAudio: true });
  expect(args).toContain('anullsrc=cl=stereo:r=48000');
  expect(args).toContain('-shortest');
  expect(args).toContain('1:a');
  // Sanity: without the flag we still map source audio.
  const normal = buildClipFfmpegArgs(baseClip, source, '/out.mp4');
  expect(normal).toContain('0:a?');
});

test('backing track on a very short clip clamps the fade-out to half its duration', () => {
  // 0.5s clip: a 0.5s fade-out would erase the whole thing. The builder clamps
  // to dur/2 so the fade never exceeds half the clip.
  const clip: Clip = {
    ...baseClip,
    in: 0, out: 0.5,
    backingTrack: { path: '/music.mp3', volume: 1, muteSource: true },
  };
  const args = buildClipFfmpegArgs(clip, source, '/out.mp4');
  const fcIdx = args.indexOf('-filter_complex');
  const fc = args[fcIdx + 1]!;
  expect(fc).toContain('atrim=duration=0.5');
  expect(fc).toContain('afade=t=out:st=0.25:d=0.25');
});
