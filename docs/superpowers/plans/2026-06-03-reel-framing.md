# Reel Framing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user define an Instagram reel's framing directly by dragging a reel-shaped box over the normal video and panning it left/right through the clip (mouse-tracked), replacing the old focus-marker-derived crop that produced odd sizes.

**Architecture:** A clip gains a `reelFraming.panPath` (horizontal centre over time). The Instagram export builds each frame as: full-height **square** slice of the source at `x(t)` → scale to `1080×1080` → pad to `1080×1920` with black bars top/bottom. Highlight markers are still burned in (drawn in source space); the clip's focus-box zoom is NOT applied to reels. The old marker-driven framing (`pickDrivingMarker`, `marker.height × 2.5`) is removed entirely.

**Tech Stack:** Electron + React + Zustand (renderer), Node + ffmpeg arg-building (main), Zod (project schema), Jest + ts-jest (tests).

**Key decisions (from the approved spec, `docs/superpowers/specs/2026-06-03-reel-framing-design.md`):**
- Reel slice is a **square** `cropSide = min(srcH, srcW)` (= `srcH` for landscape) → scaled to `1080×1080` → centred in `1080×1920` (≈420px black bars top & bottom). Resolution-independent.
- Pan is **horizontal only**; vertical is locked to source centre.
- Reels burn in **highlight markers** but **not** the focus-box zoom.
- **Un-framed clips** export a static, centred slice.
- Approach **C**: replace marker-derived framing; existing projects' reels re-render as this centred letterbox until re-framed. The `FocusMarker.primary` field stays readable but ignored.

**Naming locked across all tasks:**
- Types (in `src/shared/types.ts`): `ReelPanPoint { t: number; cx: number }`, `ReelFraming { panPath: ReelPanPoint[] }`, `Clip.reelFraming?: ReelFraming`.
- Framing module (`src/shared/instagramFraming.ts`): `ReelFramingSample { t; cx; cy; w; h }`, `computeReelFraming(clip, source, opts?): { samples: ReelFramingSample[] }`, `ReelFramingOpts { smoothingSigmaSeconds?: number }`.
- ffmpeg: `buildInstagramClipFfmpegArgs(clip, source, samples: ReelFramingSample[], outputPath, opts?)`.
- Store: `PreviewMode` gains `{ kind: 'frame-reel'; clipId: string }`; action `setReelFraming(clipId: string, framing: ReelFraming | undefined)`.
- Component: `ReelFrameOverlay`.

---

## Task 1: Add reel-framing types

**Files:**
- Modify: `src/shared/types.ts` (after the `FocusMarker` interface, before `BackingTrack`)

- [ ] **Step 1: Add the types**

In `src/shared/types.ts`, immediately after the `FocusMarker` interface (ends at the line `  primary?: boolean;\n}`), insert:

```ts
// A single horizontal-pan sample for reel framing. The reel box is always
// vertically centred and square-sized (see computeReelFraming), so only the
// horizontal centre varies over time.
export interface ReelPanPoint {
  t: number;   // clip-relative seconds (0 = clip.in)
  cx: number;  // reel-box centre x in source pixels
}

// Direct reel (9:16) framing for a clip. When present it drives the Instagram
// export crop; when absent the reel is a static, centred slice. Replaces the
// old focus-marker-derived framing.
export interface ReelFraming {
  panPath: ReelPanPoint[]; // sorted by t ascending
}
```

- [ ] **Step 2: Add the field to `Clip`**

In the `Clip` interface, after the `sourceId?: string;` line and its comment block, add:

```ts
  // Direct reel-framing pan path. When set, the Instagram export pans the 9:16
  // crop horizontally along this path; when undefined the reel is centred.
  reelFraming?: ReelFraming;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS (no errors introduced by the new optional field).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add ReelFraming/ReelPanPoint and Clip.reelFraming"
```

---

## Task 2: Persist reel framing in the project schema

**Files:**
- Modify: `src/main/project/schema.ts`
- Test: `tests/unit/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/schema.test.ts`:

```ts
test('parseAndClampProject round-trips reelFraming.panPath', () => {
  const raw = {
    version: 1,
    sourceVideo: { path: '/v.mp4', duration: 100, width: 1920, height: 1080, fps: 30 },
    clips: [{
      id: 'c1', name: 'A', in: 1, out: 5, speed: 1,
      zoom: { x: 0, y: 0, width: 1920, height: 1080 },
      focusMarkers: [],
      reelFraming: { panPath: [{ t: 0, cx: 600 }, { t: 4, cx: 1300 }] },
    }],
    sequence: [],
    bookmarks: [],
  };
  const { project } = parseAndClampProject(raw);
  expect(project.clips[0]!.reelFraming?.panPath).toEqual([
    { t: 0, cx: 600 }, { t: 4, cx: 1300 },
  ]);
});

test('parseAndClampProject loads a clip with no reelFraming as undefined', () => {
  const raw = {
    version: 1,
    sourceVideo: { path: '/v.mp4', duration: 100, width: 1920, height: 1080, fps: 30 },
    clips: [{
      id: 'c1', name: 'A', in: 1, out: 5, speed: 1,
      zoom: { x: 0, y: 0, width: 1920, height: 1080 },
      focusMarkers: [],
    }],
    sequence: [],
    bookmarks: [],
  };
  const { project } = parseAndClampProject(raw);
  expect(project.clips[0]!.reelFraming).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/schema.test.ts -t "reelFraming"`
Expected: FAIL — the parsed clip strips `reelFraming` (schema doesn't know the field), so the first test's `toEqual` fails.

- [ ] **Step 3: Add the schema**

In `src/main/project/schema.ts`, after `FocusMarkerSchema` (ends at line with `});` following `primary: z.boolean().optional(),`) add:

```ts
const ReelPanPointSchema = z.object({
  t: z.number().min(0),
  cx: z.number(),
});
const ReelFramingSchema = z.object({
  panPath: z.array(ReelPanPointSchema),
});
```

Then in `ClipSchema`, after `sourceId: z.string().optional(),` add:

```ts
  reelFraming: ReelFramingSchema.optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/schema.test.ts -t "reelFraming"`
Expected: PASS (both tests).

- [ ] **Step 5: Run the whole schema suite (regression guard)**

Run: `npx jest tests/unit/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/project/schema.ts tests/unit/schema.test.ts
git commit -m "feat(schema): persist reelFraming.panPath on clips"
```

---

## Task 3: Replace framing computation with reel geometry

This rewrites `src/shared/instagramFraming.ts`. The smoothing/clamping/thinning helpers are kept and reused; the marker-driving and size-derivation logic is removed.

**Files:**
- Modify: `src/shared/instagramFraming.ts`
- Test: `tests/unit/instagramFraming.test.ts`

- [ ] **Step 1: Replace the test file**

Overwrite `tests/unit/instagramFraming.test.ts` with:

```ts
import type { Clip, SourceMeta } from '../../src/shared/types';
import { computeReelFraming } from '../../src/shared/instagramFraming';

const source: SourceMeta = { path: '/v.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };

function clip(extra: Partial<Clip>): Clip {
  return {
    id: 'c1', name: 'A', in: 0, out: 4, speed: 1,
    zoom: { x: 0, y: 0, width: 1920, height: 1080 },
    focusMarkers: [],
    ...extra,
  };
}

test('un-framed clip is a static centred square slice (full height)', () => {
  const { samples } = computeReelFraming(clip({}), source);
  expect(samples.length).toBe(2);
  // cropSide = min(1080,1920) = 1080; centred cx = 1920/2 = 960; cy = 540.
  for (const s of samples) {
    expect(s.w).toBe(1080);
    expect(s.h).toBe(1080);
    expect(s.cx).toBe(960);
    expect(s.cy).toBe(540);
  }
  expect(samples[0]!.t).toBe(0);
  expect(samples[samples.length - 1]!.t).toBe(4);
});

test('panPath drives horizontal centre, vertical stays centred, size stays square', () => {
  const c = clip({ reelFraming: { panPath: [{ t: 0, cx: 600 }, { t: 4, cx: 1300 }] } });
  const { samples } = computeReelFraming(c, source);
  expect(samples[0]!.cx).toBeCloseTo(600, 0);
  expect(samples[samples.length - 1]!.cx).toBeCloseTo(1300, 0);
  for (const s of samples) {
    expect(s.cy).toBe(540);
    expect(s.w).toBe(1080);
    expect(s.h).toBe(1080);
  }
});

test('cx is clamped so the square slice stays inside the source', () => {
  // cropSide=1080 → valid cx range is [540, 1380]. Out-of-range values clamp.
  const c = clip({ reelFraming: { panPath: [{ t: 0, cx: 0 }, { t: 4, cx: 99999 }] } });
  const { samples } = computeReelFraming(c, source);
  for (const s of samples) {
    expect(s.cx).toBeGreaterThanOrEqual(540);
    expect(s.cx).toBeLessThanOrEqual(1380);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/instagramFraming.test.ts`
Expected: FAIL — `computeReelFraming` does not exist yet.

- [ ] **Step 3: Rewrite `instagramFraming.ts`**

Overwrite `src/shared/instagramFraming.ts` with:

```ts
import type { Clip, SourceMeta } from './types';

export interface ReelFramingOpts {
  smoothingSigmaSeconds?: number; // Gaussian σ on the smoothing pass (default 0.5)
}

export interface ReelFramingSample {
  t: number;   // clip-relative seconds (0 = clip.in)
  cx: number;  // crop centre x in SOURCE pixels
  cy: number;  // crop centre y in source pixels (always source centre)
  w: number;   // crop width in source pixels  (square: = cropSide)
  h: number;   // crop height in source pixels (square: = cropSide)
}

const DEFAULTS: Required<ReelFramingOpts> = {
  smoothingSigmaSeconds: 0.5,
};

function withDefaults(opts: ReelFramingOpts | undefined): Required<ReelFramingOpts> {
  return { ...DEFAULTS, ...(opts ?? {}) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// The reel crop is a full-height square slice of the source. For landscape
// footage cropSide = source.height; for the rare portrait case it clamps to
// source.width so the slice still fits.
export function reelCropSide(source: SourceMeta): number {
  return Math.min(source.height, source.width);
}

// Build the raw (unsmoothed) framing series. With a pan path we map each point
// to a full square slice at that horizontal centre; without one we return a
// constant centred series.
export function buildRawSeries(
  clip: Clip,
  source: SourceMeta,
): ReelFramingSample[] {
  const side = reelCropSide(source);
  const cy = source.height / 2;
  const duration = Math.max(0, clip.out - clip.in);
  const path = clip.reelFraming?.panPath;

  if (!path || path.length === 0) {
    const cx = source.width / 2;
    return [
      { t: 0, cx, cy, w: side, h: side },
      { t: duration, cx, cy, w: side, h: side },
    ];
  }
  return path.map(p => ({ t: p.t, cx: p.cx, cy, w: side, h: side }));
}

// Symmetric Gaussian smoothing of a time series (operates offline on the full
// path). Endpoints are blended too — a constant prefix/suffix pulls them toward
// the constant value. O(N²); paths top out at a few hundred samples.
export function gaussianSmoothSeries(
  samples: ReelFramingSample[],
  sigmaSeconds: number,
): ReelFramingSample[] {
  if (samples.length === 0) return [];
  if (sigmaSeconds <= 0 || samples.length === 1) {
    return samples.map(s => ({ ...s }));
  }
  const twoSigmaSq = 2 * sigmaSeconds * sigmaSeconds;
  return samples.map(centre => {
    let sumW = 0, cxSum = 0, cySum = 0, wSum = 0, hSum = 0;
    for (const other of samples) {
      const dt = other.t - centre.t;
      const weight = Math.exp(-(dt * dt) / twoSigmaSq);
      sumW += weight;
      cxSum += weight * other.cx;
      cySum += weight * other.cy;
      wSum  += weight * other.w;
      hSum  += weight * other.h;
    }
    return { t: centre.t, cx: cxSum / sumW, cy: cySum / sumW, w: wSum / sumW, h: hSum / sumW };
  });
}

// Clamp each sample so the crop rect fits inside the source. Shrinks w/h if
// they exceed the source, then clamps cx/cy so the rect sits inside bounds.
export function clampSeriesToSource(
  samples: ReelFramingSample[],
  source: SourceMeta,
): ReelFramingSample[] {
  return samples.map(s => {
    let { w, h } = s;
    const fitW = w > source.width ? source.width / w : 1;
    const fitH = h > source.height ? source.height / h : 1;
    const fit = Math.min(fitW, fitH);
    if (fit < 1) { w = w * fit; h = h * fit; }
    const halfW = w / 2;
    const halfH = h / 2;
    const cx = clamp(s.cx, halfW, source.width - halfW);
    const cy = clamp(s.cy, halfH, source.height - halfH);
    return { t: s.t, cx, cy, w, h };
  });
}

const MAX_SEGMENTS = 40;

// Thin a series to at most maxSegments segments, keeping first and last and
// picking ~evenly spaced points between. Mirrors thinPathForExport in
// command.ts so the IG ffmpeg expression stays compact.
function thinSeries(samples: ReelFramingSample[], maxSegments: number): ReelFramingSample[] {
  if (samples.length <= maxSegments + 1) return samples;
  const factor = Math.ceil((samples.length - 1) / maxSegments);
  const out: ReelFramingSample[] = [samples[0]!];
  for (let i = factor; i < samples.length - 1; i += factor) out.push(samples[i]!);
  out.push(samples[samples.length - 1]!);
  return out;
}

// Public entry point. Pipeline: build raw series → Gaussian-smooth → clamp to
// source bounds → thin for compact downstream expressions.
export function computeReelFraming(
  clip: Clip,
  source: SourceMeta,
  opts?: ReelFramingOpts,
): { samples: ReelFramingSample[] } {
  const o = withDefaults(opts);
  const raw = buildRawSeries(clip, source);
  const smoothed = gaussianSmoothSeries(raw, o.smoothingSigmaSeconds);
  const clamped = clampSeriesToSource(smoothed, source);
  const thinned = thinSeries(clamped, MAX_SEGMENTS);
  return { samples: thinned };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/instagramFraming.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/instagramFraming.ts tests/unit/instagramFraming.test.ts
git commit -m "feat(framing): replace marker-derived framing with reel square-slice + pan path"
```

---

## Task 4: Rewrite the Instagram ffmpeg command

The new chain: optional markers (source space, full-frame zoom) → square crop at `x(t)` → `scale=1080:1080` → `pad=1080:1920:0:420:black` → IG watermark → brightness → setpts.

**Files:**
- Modify: `src/main/ffmpeg/command.ts` (the import at line 3, and `buildInstagramClipFfmpegArgs` at ~line 525-586)
- Test: `tests/unit/command.test.ts` (lines 355-383)

- [ ] **Step 1: Replace the IG unit tests**

In `tests/unit/command.test.ts`, replace the import on line 356 and the two tests at lines 358-383 with:

```ts
import { computeReelFraming } from '../../src/shared/instagramFraming';

test('buildInstagramClipFfmpegArgs builds square crop → 1080x1080 scale → letterbox pad', () => {
  const clip: Clip = { ...baseClip };
  const framing = computeReelFraming(clip, source);
  const args = buildInstagramClipFfmpegArgs(clip, source, framing.samples, '/out.mp4');
  const fcIdx = args.indexOf('-filter_complex');
  const fc = args[fcIdx + 1]!;
  // cropSide = min(1080,1920) = 1080; centred cx = 960 → x = 960 - 540 = 420.
  // (x is a piecewise expr; match its shape rather than an exact literal.)
  expect(fc).toMatch(/crop=1080:1080:x='[^']*':0,scale=1080:1080/);
  expect(fc).toContain('420'); // the centred x value appears in the expression
  expect(fc).toContain('pad=1080:1920:0:420:color=black');
  expect(fc).not.toContain('crop=1920:1080'); // no focus-box zoom crop in reels
  expect(fc).toMatch(/fontsize=24/);          // IG watermark sized for short dim
  const aspectIdx = args.indexOf('-aspect');
  expect(args[aspectIdx + 1]).toBe('1080:1920');
});

test('buildInstagramClipFfmpegArgs burns in highlight markers (source space, before the crop)', () => {
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
  // Marker is drawn before the square crop so it lives in source coordinates.
  expect(fc.indexOf('drawbox=')).toBeLessThan(fc.indexOf('crop=1080:1080'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/command.test.ts -t "buildInstagramClipFfmpegArgs"`
Expected: FAIL — current chain emits `crop=1920:1080` + `scale=1080:1920` and `computeReelFraming` isn't imported by `command.ts` yet (type import error), so the assertions/compile fail.

- [ ] **Step 3: Update the import in `command.ts`**

Change line 3 of `src/main/ffmpeg/command.ts` from:

```ts
import type { IgFramingSample } from '../../shared/instagramFraming';
```

to:

```ts
import type { ReelFramingSample } from '../../shared/instagramFraming';
import { reelCropSide } from '../../shared/instagramFraming';
```

- [ ] **Step 4: Rewrite `buildInstagramClipFfmpegArgs`**

Replace the entire function body (lines ~514-586, from the comment block above `export function buildInstagramClipFfmpegArgs` through its closing `}`) with:

```ts
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
    + `crop=${fmt(side)}:${fmt(side)}:x='${xExpr}':${fmt(cropY)}`
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/command.test.ts -t "buildInstagramClipFfmpegArgs"`
Expected: PASS (both tests).

- [ ] **Step 6: Run the full command suite (regression guard for the standard path)**

Run: `npx jest tests/unit/command.test.ts`
Expected: PASS. (The standard `buildClipFfmpegArgs` byte-identical test must still pass — it was untouched.)

- [ ] **Step 7: Commit**

```bash
git add src/main/ffmpeg/command.ts tests/unit/command.test.ts
git commit -m "feat(ffmpeg): reel export = square slice + pan + letterbox pad, markers in source space"
```

---

## Task 5: Wire the exporter to the new framing function

**Files:**
- Modify: `src/main/ffmpeg/exporter.ts` (line 15 import, lines 34-35 call site)

- [ ] **Step 1: Update the import**

Change line 15 of `src/main/ffmpeg/exporter.ts` from:

```ts
import { computeInstagramFraming } from '../../shared/instagramFraming';
```

to:

```ts
import { computeReelFraming } from '../../shared/instagramFraming';
```

- [ ] **Step 2: Update the call site**

Change lines 34-35 from:

```ts
    const framing = computeInstagramFraming(clip, source);
    return buildInstagramClipFfmpegArgs(clip, source, framing.samples, outputPath, opts);
```

to:

```ts
    const framing = computeReelFraming(clip, source);
    return buildInstagramClipFfmpegArgs(clip, source, framing.samples, outputPath, opts);
```

- [ ] **Step 3: Typecheck the main project**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/ffmpeg/exporter.ts
git commit -m "feat(exporter): use computeReelFraming for IG exports"
```

---

## Task 6: Update Instagram integration tests

The output dimensions are unchanged (1080×1920), so the existing assertions hold; we add a pan-path case and stop relying on marker-driven framing.

**Files:**
- Modify: `tests/integration/exportClipInstagram.test.ts`

- [ ] **Step 1: Add a pan-path export test**

Append to `tests/integration/exportClipInstagram.test.ts`:

```ts
test('exportClip in instagram format with a reelFraming pan path produces 1080x1920', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-ig-pan-${Date.now()}.mp4`);
  const side = Math.min(source.width, source.height);
  const r = await exportClip({
    runId: 'tig-pan',
    clip: {
      id: 'c1', name: 'A', in: 1, out: 3, speed: 1,
      zoom: { x: 0, y: 0, width: source.width, height: source.height },
      focusMarkers: [],
      reelFraming: { panPath: [
        { t: 0, cx: side / 2 },
        { t: 2, cx: source.width - side / 2 },
      ] },
    },
    source,
    outputPath: out,
    format: 'instagram',
  });
  expect(r.ok).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(INSTAGRAM_REEL_WIDTH);
  expect(probed.height).toBe(INSTAGRAM_REEL_HEIGHT);
  fs.unlinkSync(out);
});
```

- [ ] **Step 2: Update the stale test name (cosmetic, keeps intent honest)**

The test at line 43 is named "...uses focus-box centre fallback". Rename its title to:

```ts
test('exportClip in instagram format with no reelFraming uses centred fallback', async () => {
```

(Its body already passes a clip with no `reelFraming`, so no other change is needed.)

- [ ] **Step 3: Run the IG integration tests**

Run: `npx jest tests/integration/exportClipInstagram.test.ts`
Expected: PASS (requires ffmpeg/ffprobe available; this is the project's existing integration setup).

- [ ] **Step 4: Run the IG sequence integration test (regression guard)**

Run: `npx jest tests/integration/exportSequenceInstagram.test.ts`
Expected: PASS (it produces 1080×1920 sequences; clips without `reelFraming` now centre-letterbox, dimensions unchanged).

- [ ] **Step 5: Commit**

```bash
git add tests/integration/exportClipInstagram.test.ts
git commit -m "test(ig): cover reelFraming pan-path export; drop marker-framing assumption"
```

---

## Task 7: Store — `frame-reel` mode and reel-framing actions

**Files:**
- Modify: `src/renderer/state/projectStore.ts`
- Test: `tests/unit/reelFramingStore.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reelFramingStore.test.ts`:

```ts
import { useProjectStore } from '../../src/renderer/state/projectStore';
import type { Project } from '../../src/shared/types';

function baseProject(): Project {
  return {
    version: 1,
    sourceVideo: { path: '/v.mp4', duration: 100, width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 's1', path: '/v.mp4', duration: 100, width: 1920, height: 1080, fps: 30 }],
    clips: [{
      id: 'c1', name: 'A', in: 0, out: 5, speed: 1,
      zoom: { x: 0, y: 0, width: 1920, height: 1080 }, focusMarkers: [],
    }],
    sequence: [], bookmarks: [],
  };
}

test('setReelFraming sets and clears the clip pan path', () => {
  useProjectStore.getState().setProject(baseProject());
  useProjectStore.getState().setReelFraming('c1', { panPath: [{ t: 0, cx: 600 }] });
  expect(useProjectStore.getState().project!.clips[0]!.reelFraming)
    .toEqual({ panPath: [{ t: 0, cx: 600 }] });
  useProjectStore.getState().setReelFraming('c1', undefined);
  expect(useProjectStore.getState().project!.clips[0]!.reelFraming).toBeUndefined();
});

test('deleting a clip while in frame-reel mode drops back to source', () => {
  useProjectStore.getState().setProject(baseProject());
  useProjectStore.getState().setPreviewMode({ kind: 'frame-reel', clipId: 'c1' });
  useProjectStore.getState().deleteClip('c1');
  expect(useProjectStore.getState().previewMode).toEqual({ kind: 'source' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/reelFramingStore.test.ts`
Expected: FAIL — `setReelFraming` is not a function; `frame-reel` not handled by `deleteClip`.

- [ ] **Step 3: Add the `frame-reel` mode**

In `src/renderer/state/projectStore.ts`, extend `PreviewMode` (lines 16-22) by adding a final member:

```ts
  | { kind: 'track-marker'; clipId: string; markerId: string }
  | { kind: 'frame-reel'; clipId: string };
```

- [ ] **Step 4: Declare the action in the `State` interface**

After the `togglePrimaryMarker` declaration (line 85), add:

```ts
  // Set or clear a clip's reel-framing pan path. Pass undefined to clear (the
  // field is deleted so saved projects stay minimal).
  setReelFraming: (clipId: string, framing: ReelFraming | undefined) => void;
```

Also add `ReelFraming` to the type import on line 2:

```ts
import type { Project, Clip, SourceMeta, SourceVideo, SequenceEntry, ZoomRect, FocusMarker, Bookmark, ExportProgress, BackingTrack, ReelFraming } from '../../shared/types';
```

- [ ] **Step 5: Implement the action**

After the `togglePrimaryMarker` implementation (ends at line 540 `}),`), add:

```ts
  setReelFraming: (clipId, framing) => set(state => {
    if (!state.project) return state;
    const clips = state.project.clips.map(c => {
      if (c.id !== clipId) return c;
      const next = { ...c };
      if (framing) next.reelFraming = framing;
      else delete next.reelFraming;
      return next;
    });
    return { project: { ...state.project, clips }, dirty: true };
  }),
```

- [ ] **Step 6: Handle `frame-reel` in `deleteClip`**

In `deleteClip` (lines 348-358), update the previewMode reset condition to include `'frame-reel'`:

```ts
    let nextPreviewMode = state.previewMode;
    if (
      (state.previewMode.kind === 'clip'
        || state.previewMode.kind === 'set-zoom'
        || state.previewMode.kind === 'track-marker'
        || state.previewMode.kind === 'frame-reel')
      && state.previewMode.clipId === id
    ) {
      nextPreviewMode = { kind: 'source' };
    } else if (sequenceWasPlayingDeletedClip) {
      nextPreviewMode = { kind: 'source' };
    }
```

- [ ] **Step 7: Deep-copy reelFraming in `duplicateClip`**

In `duplicateClip` (lines 372-378), add a reelFraming clone to the `copy` object so the duplicate doesn't share the original's array reference:

```ts
    const copy: Clip = {
      ...orig,
      id: newId(),
      name: `${orig.name} (copy)`,
      zoom: { ...orig.zoom },
      focusMarkers: orig.focusMarkers.map(m => ({ ...m, id: newMarkerId() })),
      ...(orig.reelFraming
        ? { reelFraming: { panPath: orig.reelFraming.panPath.map(p => ({ ...p })) } }
        : {}),
    };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest tests/unit/reelFramingStore.test.ts`
Expected: PASS (both tests).

- [ ] **Step 9: Commit**

```bash
git add src/renderer/state/projectStore.ts tests/unit/reelFramingStore.test.ts
git commit -m "feat(store): frame-reel preview mode + setReelFraming action"
```

---

## Task 8: `ReelFrameOverlay` component

A sibling of `TrackMarkerOverlay`, simplified to horizontal-only panning. It records `{ t, cx }` samples, shows the square capture region (full height) with the cropped sides dimmed, and indicates the black-bar zones.

**Files:**
- Create: `src/renderer/components/ReelFrameOverlay.tsx`

- [ ] **Step 1: Create the component**

Create `src/renderer/components/ReelFrameOverlay.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import type { Clip, FocusMarkerPathPoint, ReelPanPoint } from '../../shared/types';
import { useProjectStore } from '../state/projectStore';
import { useSettings } from '../state/settings';
import { smoothPath, decimatePath } from '../state/markerPosition';
import { clampPlayhead, frameStepSeconds, snapToFrame, keyToNudgeDelta } from '../state/playhead';

// Reel-framing workflow (mirrors TrackMarkerOverlay, horizontal-only):
//   1) Mount in 'frame-reel' mode. Video paused at clip.in.
//   2) A 9:16 reel box follows the cursor X (vertically centred). The captured
//      square region is clear; the cropped-out sides are dimmed.
//   3) First click: record a starting pan point, set marker.in = clip.in, play
//      at the tracking rate, sample cursor X every animation frame.
//   4) Second click (or playback reaching clip.out): smooth + decimate the
//      path, save it as clip.reelFraming, exit to clip mode, auto-replay.
export function ReelFrameOverlay({
  clip, videoRef, sourceWidth, sourceHeight, displayWidth, displayHeight,
}: {
  clip: Clip;
  videoRef: React.RefObject<HTMLVideoElement>;
  sourceWidth: number;
  sourceHeight: number;
  displayWidth: number;
  displayHeight: number;
}) {
  const setReelFraming = useProjectStore(s => s.setReelFraming);
  const setMode = useProjectStore(s => s.setPreviewMode);
  const replayClip = useProjectStore(s => s.replayClip);
  const fps = useProjectStore(s => s.project?.sourceVideo.fps ?? 30);
  const skipSeconds = useSettings(s => s.skipSeconds);
  const trackingRate = useSettings(s => s.trackingPlaybackRate);

  const ref = useRef<HTMLDivElement>(null);
  const recordingRef = useRef(false);
  const pathRef = useRef<ReelPanPoint[]>([]);
  const lastSampleTimeRef = useRef<number>(-Infinity);
  const mouseXRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<'waiting-start' | 'recording' | 'done'>('waiting-start');
  const [sampleCount, setSampleCount] = useState(0);
  const [previewX, setPreviewX] = useState<number | null>(null);

  // Square capture side in source px → display px. The 9:16 reel box is taller
  // than the display (it bleeds off top/bottom = the black bars).
  const cropSide = Math.min(sourceWidth, sourceHeight);
  const boxDisplayW = (cropSide / sourceWidth) * displayWidth;
  const boxDisplayH = (cropSide / sourceHeight) * displayHeight; // = displayHeight for landscape
  const halfSrc = cropSide / 2;

  // Seek to clip.in once, slow to the tracking rate, paused & muted. Restore
  // clip speed on exit.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = clip.in;
    v.playbackRate = useSettings.getState().trackingPlaybackRate;
    v.muted = true;
    return () => {
      v.playbackRate = clip.speed;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Nudge shortcuts during waiting-start only (self-removes once recording).
  useEffect(() => {
    if (phase !== 'waiting-start') return;
    function isTyping(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping()) return;
      if (e.code === 'ArrowLeft' && !e.shiftKey) { e.preventDefault(); nudge(-skipSeconds); return; }
      if (e.code === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); nudge(+skipSeconds); return; }
      const delta = keyToNudgeDelta(
        { code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey },
        fps,
      );
      if (delta !== null) { e.preventDefault(); nudge(delta); }
    }
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, [phase, skipSeconds, fps, clip.in, clip.out]);

  function nudge(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    const target = snapToFrame(v.currentTime + delta, fps);
    v.currentTime = clampPlayhead(target, clip.in, clip.out);
  }

  function localX(e: { clientX: number }) {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(displayWidth, e.clientX - r.left));
  }
  // Display x → source cx, clamped so the square slice stays inside the source.
  function toSourceCx(x: number) {
    const sx = (x / displayWidth) * sourceWidth;
    return Math.max(halfSrc, Math.min(sourceWidth - halfSrc, sx));
  }

  function appendSample(displayX: number) {
    const v = videoRef.current;
    if (!v) return;
    const t = Math.max(0, v.currentTime - clip.in);
    if (t - lastSampleTimeRef.current < 0.001) return;
    lastSampleTimeRef.current = t;
    pathRef.current.push({ t, cx: toSourceCx(displayX) });
    setSampleCount(pathRef.current.length);
  }

  function rafLoop() {
    if (!recordingRef.current) return;
    const x = mouseXRef.current;
    if (x !== null) appendSample(x);
    rafRef.current = requestAnimationFrame(rafLoop);
  }

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const x = localX(e);
    mouseXRef.current = x;
    if (phase === 'waiting-start') {
      pathRef.current = [];
      lastSampleTimeRef.current = -Infinity;
      appendSample(x);
      recordingRef.current = true;
      setPhase('recording');
      v.play().catch(() => {});
      rafRef.current = requestAnimationFrame(rafLoop);
    } else if (phase === 'recording') {
      appendSample(x);
      stopAndSave();
    }
  }

  function onMouseMove(e: React.MouseEvent) {
    const x = localX(e);
    mouseXRef.current = x;
    setPreviewX(x);
  }

  function stopAndSave() {
    const v = videoRef.current;
    if (v) v.pause();
    recordingRef.current = false;
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setPhase('done');
    const raw = pathRef.current;
    const saved = raw.length >= 2;
    if (saved) {
      // Reuse the marker path smoothing/decimation helpers. They operate on
      // {t,cx,cy}; carry a constant cy through and drop it on the way out.
      const asPoints: FocusMarkerPathPoint[] = raw.map(p => ({ t: p.t, cx: p.cx, cy: sourceHeight / 2 }));
      const cleaned = decimatePath(smoothPath(asPoints));
      const panPath: ReelPanPoint[] = cleaned.map(p => ({ t: p.t, cx: p.cx }));
      setReelFraming(clip.id, { panPath });
    }
    setMode({ kind: 'clip', clipId: clip.id });
    if (saved) queueMicrotask(() => replayClip());
  }

  function cancel() {
    const v = videoRef.current;
    if (v) v.pause();
    recordingRef.current = false;
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setMode({ kind: 'clip', clipId: clip.id });
  }

  // Auto-stop when playback reaches clip.out while recording.
  useEffect(() => {
    if (phase !== 'recording') return;
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => { if (v.currentTime >= clip.out) stopAndSave(); };
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [phase, clip.out]);

  // Box left edge (display px), centred on the cursor and clamped to bounds.
  const boxLeft = previewX === null
    ? (displayWidth - boxDisplayW) / 2
    : Math.max(0, Math.min(displayWidth - boxDisplayW, previewX - boxDisplayW / 2));
  // The 9:16 reel outline is taller than the display; it extends symmetrically
  // beyond the top/bottom (the black-bar zones).
  const reelDisplayH = boxDisplayW * (1920 / 1080);
  const reelTop = (boxDisplayH - reelDisplayH) / 2;

  return (
    <div ref={ref}
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setPreviewX(null)}
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', overflow: 'hidden' }}>
      {/* Dim the cropped-out sides (left & right of the square capture). */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: boxLeft, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: boxLeft + boxDisplayW, right: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
      {/* The 9:16 reel outline (bleeds off top/bottom = black bars). */}
      <div style={{
        position: 'absolute', left: boxLeft, top: reelTop, width: boxDisplayW, height: reelDisplayH,
        border: '2px dashed rgba(255,255,255,0.8)', boxSizing: 'border-box', pointerEvents: 'none',
      }} />
      {/* The captured square (what's actually rendered, full height). */}
      <div style={{
        position: 'absolute', left: boxLeft, top: 0, width: boxDisplayW, height: boxDisplayH,
        border: '2px solid white', boxSizing: 'border-box', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', top: 8, left: 8, right: 8,
        display: 'flex', justifyContent: 'space-between', gap: 8, pointerEvents: 'none',
      }}>
        <span style={{ background: 'rgba(0,0,0,0.7)', color: 'var(--text)', padding: '4px 10px', borderRadius: 3, fontSize: 12 }}>
          {phase === 'waiting-start' && `Click to start framing the reel. Pan left/right; plays at ${trackingRate}×.`}
          {phase === 'recording' && `Framing… slide left/right to keep the action in shot. Click to stop. (${sampleCount})`}
        </span>
      </div>
      {phase === 'waiting-start' && (
        <div onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
          style={{ position: 'absolute', top: 40, left: 8, display: 'flex', gap: 4, zIndex: 5 }}>
          <button onClick={() => nudge(-skipSeconds)} title={`Skip back ${skipSeconds}s (←)`}>− {skipSeconds}s</button>
          <button onClick={() => nudge(-frameStepSeconds(fps))} title="Step back 1 frame (,)">◀</button>
          <button onClick={() => nudge(+frameStepSeconds(fps))} title="Step forward 1 frame (.)">▶</button>
          <button onClick={() => nudge(+skipSeconds)} title={`Skip forward ${skipSeconds}s (→)`}>+ {skipSeconds}s</button>
        </div>
      )}
      <div onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
        style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', gap: 6 }}>
        <button onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the renderer**

Run: `npx tsc -p tsconfig.renderer.json --noEmit`
Expected: PASS (the component compiles; it is not yet mounted).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ReelFrameOverlay.tsx
git commit -m "feat(ui): ReelFrameOverlay — horizontal reel-framing tracker"
```

---

## Task 9: Mount the overlay in the preview

**Files:**
- Modify: `src/renderer/components/Preview.tsx`

- [ ] **Step 1: Import the overlay**

At the top of `src/renderer/components/Preview.tsx`, alongside the other component imports (near the `TrackMarkerOverlay` import), add:

```ts
import { ReelFrameOverlay } from './ReelFrameOverlay';
```

- [ ] **Step 2: Recognise the mode and suspend zoom for it**

In the render body (lines 378-382), extend the mode flags:

```ts
  const isSetZoom = previewMode.kind === 'set-zoom';
  const isTrackMarker = previewMode.kind === 'track-marker';
  const isFrameReel = previewMode.kind === 'frame-reel';
  // While placing a focus box, tracking a marker, or framing the reel we
  // temporarily disable the zoom transform so the user interacts with the full
  // source frame.
  const suspendZoom = isSetZoom || isTrackMarker || isFrameReel;
```

- [ ] **Step 3: Include `frame-reel` in the active-clip resolution**

In the `activeClip` resolver (lines 30-33), add the new mode so the clip is found:

```ts
    if (previewMode.kind === 'clip'
      || previewMode.kind === 'set-zoom'
      || previewMode.kind === 'track-marker'
      || previewMode.kind === 'frame-reel') {
      return project.clips.find(c => c.id === previewMode.clipId) ?? null;
    }
```

- [ ] **Step 4: Render the overlay**

After the `isTrackMarker && ... TrackMarkerOverlay` block (lines 526-536), add:

```tsx
        {isFrameReel && previewMode.kind === 'frame-reel' && activeClip && (
          <ReelFrameOverlay
            clip={activeClip}
            videoRef={videoRef}
            sourceWidth={sw}
            sourceHeight={sh}
            displayWidth={dw}
            displayHeight={dh}
          />
        )}
```

- [ ] **Step 5: Typecheck the renderer**

Run: `npx tsc -p tsconfig.renderer.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/Preview.tsx
git commit -m "feat(ui): mount ReelFrameOverlay in frame-reel preview mode"
```

---

## Task 10: "Frame reel" / "Clear framing" buttons in the clip editor

**Files:**
- Modify: `src/renderer/components/ClipEditor.tsx`

- [ ] **Step 1: Read the reel-framing action and state**

In `ClipEditor` (after line 21, `const setMode = useProjectStore(s => s.setPreviewMode);`), add:

```ts
  const clearReelFraming = useProjectStore(s => s.setReelFraming);
```

After `const slowmoDone = clip.speed < 1;` (line 46), add:

```ts
  const reelFramed = !!clip.reelFraming && clip.reelFraming.panPath.length > 0;
```

- [ ] **Step 2: Add a reel-framing block inside the Zoom step**

Inside the `zoomRef` section, after the existing focus-box button row `</div>` (after line 94, before the section's closing `</section>` on line 95), insert:

```tsx
        <p className="step-hint" style={{ marginTop: 12 }}>
          Frame the reel: drag the 9:16 box left/right through the clip to choose
          what stays in the vertical crop. Black bars fill the top and bottom.
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setMode({ kind: 'frame-reel', clipId })}
            title="Drag the reel-shaped box left/right to set the reel framing">
            {reelFramed ? 'Re-frame reel' : 'Frame reel'}
          </button>
          <button
            disabled={!reelFramed}
            onClick={() => clearReelFraming(clipId, undefined)}
            title="Reset the reel to a static centred crop">
            Clear reel framing
          </button>
        </div>
```

- [ ] **Step 3: Typecheck the renderer**

Run: `npx tsc -p tsconfig.renderer.json --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ClipEditor.tsx
git commit -m "feat(ui): Frame reel / Clear reel framing buttons in clip editor"
```

---

## Task 11: Update the two Instagram preview components

Both currently call `computeInstagramFraming` and assume the crop fills the whole 9:16 output. Update them to `computeReelFraming` and render the square-into-letterbox correctly.

**Files:**
- Modify: `src/renderer/components/InstagramPreviewCanvas.tsx`
- Modify: `src/renderer/components/InstagramCropOverlay.tsx`

- [ ] **Step 1: Update `InstagramPreviewCanvas.tsx` imports and types**

Change line 3 from:

```ts
import { computeInstagramFraming, IgFramingSample } from '../../shared/instagramFraming';
```

to:

```ts
import { computeReelFraming, ReelFramingSample } from '../../shared/instagramFraming';
```

Replace all `IgFramingSample` occurrences in the file with `ReelFramingSample` (the `framingRef` type on line 23, and the `sampleFraming` signature/return on line 104). Change line 25 `computeInstagramFraming(clip, source)` to `computeReelFraming(clip, source)`.

- [ ] **Step 2: Draw the square into a letterboxed canvas**

Replace the `drawImage` block inside the `tick()` loop (lines 39-47) with a black-filled letterbox draw:

```ts
          const ctx = c.getContext('2d');
          if (ctx) {
            // Letterbox: clear to black, then draw the square slice into the
            // vertically-centred band (matches the exported reel).
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, c.width, c.height);
            const bandH = c.width; // square slice scaled to canvas width → square band
            const dy = (c.height - bandH) / 2;
            ctx.drawImage(
              v,
              s.cx - s.w / 2, s.cy - s.h / 2, s.w, s.h,
              0, dy, c.width, bandH,
            );
          }
```

- [ ] **Step 3: Update `InstagramCropOverlay.tsx`**

Change line 3 from:

```ts
import { computeInstagramFraming, IgFramingSample } from '../../shared/instagramFraming';
```

to:

```ts
import { computeReelFraming, ReelFramingSample } from '../../shared/instagramFraming';
```

Replace all `IgFramingSample` with `ReelFramingSample` (line 19 ref type, line 72 helper). Change line 23 `computeInstagramFraming(clip, source).samples` to `computeReelFraming(clip, source).samples`.

The overlay draws the square capture rect (`s.cx±w/2`, `s.cy±h/2`) with the surrounding area dimmed — that already correctly shows the cropped sides, so no geometry change is needed there.

- [ ] **Step 4: Typecheck the renderer**

Run: `npx tsc -p tsconfig.renderer.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/InstagramPreviewCanvas.tsx src/renderer/components/InstagramCropOverlay.tsx
git commit -m "feat(ui): IG previews render square-slice letterbox via computeReelFraming"
```

---

## Task 12: Update the export-options summary

`ExportOptionsModal` describes framing via the removed marker driver. Replace it with a reel-framing summary.

**Files:**
- Modify: `src/renderer/components/ExportOptionsModal.tsx`

- [ ] **Step 1: Update the import**

Change line 4 from:

```ts
import { computeInstagramFraming } from '../../shared/instagramFraming';
```

to (the function is no longer needed by the summary):

```ts
import type { Clip, SourceMeta } from '../../shared/types';
```

(If `Clip` / `SourceMeta` are already imported elsewhere in the file, merge instead of duplicating — keep a single import. Check the existing imports at the top of the file.)

- [ ] **Step 2: Rewrite `driverSummary`**

Replace the `driverSummary` function (lines 91-100) with:

```ts
function driverSummary(clip: Clip, _source: SourceMeta): string {
  const path = clip.reelFraming?.panPath;
  if (!path || path.length < 2) {
    return 'Reel not framed — using a static, centred crop.';
  }
  const span = (path[path.length - 1]!.t - path[0]!.t).toFixed(1);
  return `Reel framed — panned over ${span}s.`;
}
```

- [ ] **Step 3: Typecheck the renderer**

Run: `npx tsc -p tsconfig.renderer.json --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ExportOptionsModal.tsx
git commit -m "feat(ui): export summary reflects reel framing instead of marker driver"
```

---

## Task 13: Full verification & manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Typecheck everything**

Run: `npx tsc -p tsconfig.json --noEmit; npx tsc -p tsconfig.main.json --noEmit; npx tsc -p tsconfig.renderer.json --noEmit`
Expected: all PASS (no errors).

- [ ] **Step 2: Run the full unit suite**

Run: `npx jest tests/unit`
Expected: PASS — including `command.test.ts`, `instagramFraming.test.ts`, `schema.test.ts`, `reelFramingStore.test.ts`.

- [ ] **Step 3: Run the integration suite (needs ffmpeg)**

Run: `npx jest tests/integration`
Expected: PASS — the IG clip + sequence exports produce 1080×1920 files.

- [ ] **Step 4: Manual smoke test in the app**

Use the `/run` skill (or `npm run dev`) to launch the app, then:
1. Open a landscape source video and create a clip.
2. In the clip editor's Zoom step, click **Frame reel** — confirm the video jumps to the clip start, the 9:16 box bleeds off the top/bottom, and the sides are dimmed.
3. Click once, slide left/right as it plays at the tracking rate, click again at the end.
4. Confirm it returns to clip mode and replays; the IG preview canvas shows the square band with black bars top/bottom following your pan.
5. Export the clip as Instagram format; confirm the output is 1080×1920 with black bars and the framing you set, and any highlight markers are burned in.
6. Click **Clear reel framing**; confirm the IG preview reverts to a static centred crop.

- [ ] **Step 5: Final commit (if any manual-fix touch-ups were needed)**

```bash
git add -A
git commit -m "chore: reel framing verification fixes"
```

(Skip if nothing changed.)

---

## Notes for the implementer

- **Windows/PowerShell:** run jest via `npx jest ...`; chain commands with `;` (not `&&`) if needed.
- **Don't** add a `build` field to `package.json` (electron-builder config lives only in `electron-builder.yml`).
- The standard (non-reel) export path and the byte-identical regression test in `command.test.ts` must remain untouched and green — the reel changes are confined to the IG path.
- `FocusMarker.primary` is intentionally left in the type/schema (readable) but unused by framing now; do not delete it (old projects still carry it).
