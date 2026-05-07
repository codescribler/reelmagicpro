# Instagram Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Instagram (9:16 Reels) export alongside the existing standard export, with automatic player tracking driven by focus marker paths and a live preview before export.

**Architecture:** Extend the existing FFmpeg pipeline with an additional time-varying crop+scale stage at the end (Approach 1 in the spec — leaves the standard pipeline byte-identical). A new pure shared module computes the smoothed crop window over time and is consumed by both the renderer's preview canvas and the main process's ffmpeg-arg builder, eliminating drift between preview and final render.

**Tech Stack:** TypeScript, Electron (main + renderer + preload), React 18, Zustand, Jest (`npm test` for unit, `npm run test:integration` for integration), FFmpeg via `ffmpeg-static`, Zod for project schema.

**Spec:** `docs/superpowers/specs/2026-05-07-instagram-export-design.md`.

---

## File structure

**New files:**
- `src/shared/instagramFormat.ts` — IG output dimensions and aspect constants.
- `src/shared/instagramFraming.ts` — pure framing computation (driver selection, raw series, smoothing, clamping, thinning).
- `src/renderer/components/InstagramCropOverlay.tsx` — overlay rectangle on main preview.
- `src/renderer/components/InstagramPreviewCanvas.tsx` — live cropped 9:16 canvas in the export options modal.
- `src/renderer/components/ExportOptionsModal.tsx` — pre-export modal with format toggle, IG canvas, driver summary.
- `tests/unit/instagramFraming.test.ts` — unit tests for the framing module.
- `tests/integration/exportClipInstagram.test.ts` — IG clip render integration test.
- `tests/integration/exportSequenceInstagram.test.ts` — IG sequence render integration test.

**Modified files:**
- `src/shared/types.ts` — add `primary?: boolean` to `FocusMarker`; add `format?: 'standard' | 'instagram'` to `ExportClipArgs`/`ExportSequenceArgs`; add `instagramOutroPath?` to `ExportClipArgs`/`ExportSequenceArgs`.
- `src/main/project/schema.ts` — add `primary` to the marker zod schema.
- `src/main/ffmpeg/command.ts` — add `instagramWatermarkFilter`, `buildInstagramOutroFfmpegArgs`, `buildInstagramClipFfmpegArgs`. Existing functions unchanged.
- `src/main/ffmpeg/exporter.ts` — branch on `format` when invoking the clip-arg builder; route IG outro fallbacks.
- `src/main/ipc.ts` — pass `format` and `instagramOutroPath` through to `exportClip`/`exportSequence`.
- `src/preload/preload.ts` — type signatures already use the shared types; no new IPC channels needed.
- `src/shared/window.d.ts` — same.
- `src/renderer/state/settings.ts` — add `instagramOutroPath?: string` to settings.
- `src/renderer/components/SettingsModal.tsx` — add IG outro field (file picker row).
- `src/renderer/state/projectStore.ts` — `togglePrimaryMarker(clipId, markerId)` action.
- `src/renderer/components/ClipFocusMarkers.tsx` (and/or marker list component) — primary star UI.
- `src/renderer/components/Preview.tsx` — mount `InstagramCropOverlay`, add "Show Reel frame" toggle.
- `src/renderer/App.tsx` — route export buttons through `ExportOptionsModal`; add dedicated "Export for Instagram" buttons; plumb `format` + `instagramOutroPath` to IPC calls.
- `tests/unit/command.test.ts` — extend with cases for the IG builder (regression-guard the existing standard builder snapshot).
- `tests/unit/schema.test.ts` — extend for the new `primary` field round-trip.
- `docs/smoke-checklist.md` — add IG manual smoke items.

---

## Phase 1: Foundations

### Task 1: Add `primary` flag to FocusMarker

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/project/schema.ts`
- Test: `tests/unit/schema.test.ts`

- [ ] **Step 1: Write the failing schema round-trip test**

Add to `tests/unit/schema.test.ts`:

```ts
test('FocusMarker primary flag round-trips through parseAndClampProject', () => {
  const raw = {
    version: 1,
    sourceVideo: { path: '/in.mp4', duration: 100, width: 1920, height: 1080, fps: 30 },
    clips: [{
      id: 'c1', name: 'A', in: 0, out: 5, speed: 1,
      zoom: { x: 0, y: 0, width: 1920, height: 1080 },
      focusMarkers: [
        { id: 'm1', x: 0, y: 0, width: 80, height: 80, in: 0, out: 5, color: 'yellow', primary: true },
        { id: 'm2', x: 0, y: 0, width: 80, height: 80, in: 0, out: 5, color: 'red' },
      ],
    }],
    sequence: [],
    bookmarks: [],
  };
  const { project } = parseAndClampProject(raw);
  expect(project.clips[0]!.focusMarkers[0]!.primary).toBe(true);
  expect(project.clips[0]!.focusMarkers[1]!.primary).toBeUndefined();
});

test('FocusMarker without primary field still parses (backwards-compat)', () => {
  const raw = {
    version: 1,
    sourceVideo: { path: '/in.mp4', duration: 100, width: 1920, height: 1080, fps: 30 },
    clips: [{
      id: 'c1', name: 'A', in: 0, out: 5, speed: 1,
      zoom: { x: 0, y: 0, width: 1920, height: 1080 },
      focusMarkers: [{ id: 'm1', x: 0, y: 0, width: 80, height: 80, in: 0, out: 5, color: 'yellow' }],
    }],
    sequence: [],
    bookmarks: [],
  };
  expect(() => parseAndClampProject(raw)).not.toThrow();
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test -- tests/unit/schema.test.ts`
Expected: FAIL — `primary` is `undefined` because the schema doesn't yet include it.

- [ ] **Step 3: Update the FocusMarker type**

In `src/shared/types.ts`, modify the `FocusMarker` interface — add the field after `path?: FocusMarkerPathPoint[];`:

```ts
  path?: FocusMarkerPathPoint[];
  // Optional flag identifying this marker as the driver for Instagram-format
  // export framing on multi-marker clips. At most one marker per clip should
  // have this set. When no marker is flagged, IG framing falls back to the
  // first marker.
  primary?: boolean;
```

- [ ] **Step 4: Update the Zod schema**

In `src/main/project/schema.ts`, modify `FocusMarkerSchema` — add the optional field:

```ts
const FocusMarkerSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  in: z.number().min(0),
  out: z.number().min(0),
  color: z.string().min(1),
  shape: z.enum(['rect', 'oval']).optional(),
  label: z.string().optional(),
  path: z.array(FocusMarkerPathPointSchema).optional(),
  primary: z.boolean().optional(),
});
```

- [ ] **Step 5: Run tests — expect pass**

Run: `npm test -- tests/unit/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full unit suite to confirm no regressions**

Run: `npm test`
Expected: PASS, no failures elsewhere.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/project/schema.ts tests/unit/schema.test.ts
git commit -m "feat(schema): add optional primary flag to FocusMarker for IG framing"
```

---

### Task 2: Shared `instagramFormat` constants

**Files:**
- Create: `src/shared/instagramFormat.ts`

- [ ] **Step 1: Create the constants module**

`src/shared/instagramFormat.ts`:

```ts
// Single source of truth for the Instagram Reels output canvas. Used by the
// ffmpeg arg builder, the framing module's aspect default, and the preview
// canvas size calculations. If we ever add Square (1:1) or Portrait (4:5)
// presets, they can live alongside as additional constants — the framing
// module already takes targetAspect as an option.
export const INSTAGRAM_REEL_WIDTH = 1080;
export const INSTAGRAM_REEL_HEIGHT = 1920;
export const INSTAGRAM_REEL_ASPECT = INSTAGRAM_REEL_WIDTH / INSTAGRAM_REEL_HEIGHT; // 9/16 ≈ 0.5625
```

- [ ] **Step 2: Type-check**

Run: `npm run build:main`
Expected: succeeds. (No code uses the constants yet, so it's just a type/parse check.)

- [ ] **Step 3: Commit**

```bash
git add src/shared/instagramFormat.ts
git commit -m "feat: add INSTAGRAM_REEL_* constants for IG export"
```

---

## Phase 2: Framing module (pure, TDD)

### Task 3: `pickDrivingMarker` — driver selection

**Files:**
- Create: `src/shared/instagramFraming.ts`
- Test: `tests/unit/instagramFraming.test.ts`

- [ ] **Step 1: Write failing tests for driver selection**

`tests/unit/instagramFraming.test.ts`:

```ts
import { pickDrivingMarker } from '../../src/shared/instagramFraming';
import type { Clip, FocusMarker } from '../../src/shared/types';

function clipWith(markers: FocusMarker[]): Clip {
  return {
    id: 'c1', name: 'A', in: 0, out: 5, speed: 1,
    zoom: { x: 0, y: 0, width: 1920, height: 1080 },
    focusMarkers: markers,
  };
}

const m = (id: string, primary?: boolean): FocusMarker => ({
  id, x: 0, y: 0, width: 80, height: 80, in: 0, out: 5, color: 'yellow',
  ...(primary ? { primary: true } : {}),
});

test('pickDrivingMarker returns null when no markers', () => {
  expect(pickDrivingMarker(clipWith([]))).toBeNull();
});

test('pickDrivingMarker returns the explicit primary marker when one is flagged', () => {
  const driver = pickDrivingMarker(clipWith([m('m1'), m('m2', true), m('m3')]));
  expect(driver?.id).toBe('m2');
});

test('pickDrivingMarker falls back to the first marker when none are primary', () => {
  const driver = pickDrivingMarker(clipWith([m('m1'), m('m2')]));
  expect(driver?.id).toBe('m1');
});

test('pickDrivingMarker takes the first primary if multiple are flagged', () => {
  const driver = pickDrivingMarker(clipWith([m('m1', true), m('m2', true)]));
  expect(driver?.id).toBe('m1');
});
```

- [ ] **Step 2: Run tests — expect failure (function not defined)**

Run: `npm test -- tests/unit/instagramFraming.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pickDrivingMarker`**

`src/shared/instagramFraming.ts`:

```ts
import type { Clip, FocusMarker } from './types';

// Pick the marker that drives Instagram framing. Explicit primary wins; if
// none flagged, fall back to the first marker. Returns null when the clip has
// no markers — callers fall back to the focus-box centre in that case.
export function pickDrivingMarker(clip: Clip): FocusMarker | null {
  if (clip.focusMarkers.length === 0) return null;
  const explicit = clip.focusMarkers.find(m => m.primary === true);
  return explicit ?? clip.focusMarkers[0]!;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- tests/unit/instagramFraming.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/instagramFraming.ts tests/unit/instagramFraming.test.ts
git commit -m "feat(framing): pickDrivingMarker for IG export"
```

---

### Task 4: Raw centre + size series

**Files:**
- Modify: `src/shared/instagramFraming.ts`
- Test: `tests/unit/instagramFraming.test.ts`

- [ ] **Step 1: Write failing tests for raw series**

Append to `tests/unit/instagramFraming.test.ts`:

```ts
import { buildRawSeries } from '../../src/shared/instagramFraming';
import type { SourceMeta } from '../../src/shared/types';

const SRC: SourceMeta = { path: '/in.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };

test('buildRawSeries with no markers uses focus-box centre and default zoom', () => {
  const clip = clipWith([]);
  // zoom = full source → centre at (960, 540), default height = 0.7 * 1080 = 756, width = 756 * 9/16 = 425.25
  const samples = buildRawSeries(clip, SRC, { defaultZoomFraction: 0.7, paddingFactor: 2.5, minHeightFraction: 0.30, targetAspect: 9 / 16 });
  expect(samples).toHaveLength(2); // start and end of clip
  expect(samples[0]!.cx).toBeCloseTo(960);
  expect(samples[0]!.cy).toBeCloseTo(540);
  expect(samples[0]!.h).toBeCloseTo(756);
  expect(samples[0]!.w).toBeCloseTo(425.25, 1);
  expect(samples[1]!.t).toBeCloseTo(5);
});

test('buildRawSeries with static marker uses marker centre and padded size', () => {
  const marker: FocusMarker = {
    id: 'm1', x: 800, y: 400, width: 200, height: 200, in: 0, out: 5, color: 'yellow',
  };
  const clip = clipWith([marker]);
  const samples = buildRawSeries(clip, SRC, { defaultZoomFraction: 0.7, paddingFactor: 2.5, minHeightFraction: 0.30, targetAspect: 9 / 16 });
  expect(samples).toHaveLength(2);
  // centre = (800+100, 400+100) = (900, 500); height = 200 * 2.5 = 500
  expect(samples[0]!.cx).toBeCloseTo(900);
  expect(samples[0]!.cy).toBeCloseTo(500);
  expect(samples[0]!.h).toBeCloseTo(500);
  expect(samples[0]!.w).toBeCloseTo(500 * 9 / 16, 1);
});

test('buildRawSeries with tracked marker samples the path', () => {
  const marker: FocusMarker = {
    id: 'm1', x: 0, y: 0, width: 100, height: 100, in: 0, out: 5, color: 'yellow',
    path: [
      { t: 0, cx: 200, cy: 200 },
      { t: 5, cx: 800, cy: 600 },
    ],
  };
  const clip = clipWith([marker]);
  const samples = buildRawSeries(clip, SRC, { defaultZoomFraction: 0.7, paddingFactor: 2.5, minHeightFraction: 0.30, targetAspect: 9 / 16 });
  expect(samples.length).toBeGreaterThanOrEqual(2);
  expect(samples[0]!.cx).toBeCloseTo(200);
  expect(samples[0]!.cy).toBeCloseTo(200);
  expect(samples[samples.length - 1]!.cx).toBeCloseTo(800);
  expect(samples[samples.length - 1]!.cy).toBeCloseTo(600);
});

test('buildRawSeries clamps tiny markers up to minHeightFraction', () => {
  const marker: FocusMarker = {
    id: 'm1', x: 800, y: 400, width: 30, height: 30, in: 0, out: 5, color: 'yellow',
  };
  const clip = clipWith([marker]);
  const samples = buildRawSeries(clip, SRC, { defaultZoomFraction: 0.7, paddingFactor: 2.5, minHeightFraction: 0.30, targetAspect: 9 / 16 });
  // 30 * 2.5 = 75 < 1080 * 0.30 = 324 → clamps to 324.
  expect(samples[0]!.h).toBeCloseTo(324);
});

test('buildRawSeries clamps oversized markers down to source height', () => {
  const marker: FocusMarker = {
    id: 'm1', x: 0, y: 0, width: 1500, height: 1500, in: 0, out: 5, color: 'yellow',
  };
  const clip = clipWith([marker]);
  const samples = buildRawSeries(clip, SRC, { defaultZoomFraction: 0.7, paddingFactor: 2.5, minHeightFraction: 0.30, targetAspect: 9 / 16 });
  // 1500 * 2.5 = 3750 > 1080 → clamps to 1080.
  expect(samples[0]!.h).toBeCloseTo(1080);
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test -- tests/unit/instagramFraming.test.ts`
Expected: FAIL — `buildRawSeries` not defined.

- [ ] **Step 3: Implement `buildRawSeries`**

Append to `src/shared/instagramFraming.ts`:

```ts
import type { SourceMeta } from './types';

export interface IgFramingOpts {
  paddingFactor?: number;       // crop height = marker.height × paddingFactor (default 2.5)
  minHeightFraction?: number;   // crop height ≥ source.height × this (default 0.30)
  smoothingSigmaSeconds?: number; // Gaussian σ on the smoothing pass (default 0.5)
  defaultZoomFraction?: number; // crop height when no marker (default 0.70 of source.height)
  targetAspect?: number;        // crop width / height (default 9/16)
}

export interface IgFramingSample {
  t: number;   // clip-relative seconds (0 = clip.in)
  cx: number;  // centre x in source pixels (same coord space as marker.x/y)
  cy: number;  // centre y in source pixels
  w: number;   // crop width in source pixels
  h: number;   // crop height in source pixels
}

const DEFAULTS: Required<IgFramingOpts> = {
  paddingFactor: 2.5,
  minHeightFraction: 0.30,
  smoothingSigmaSeconds: 0.5,
  defaultZoomFraction: 0.70,
  targetAspect: 9 / 16,
};

function withDefaults(opts: IgFramingOpts | undefined): Required<IgFramingOpts> {
  return { ...DEFAULTS, ...(opts ?? {}) };
}

// Build the raw (unsmoothed, unclamped) framing series from the clip's
// driving marker. When no marker is available, returns a constant series
// centred on the clip's focus box. The return is a list sampled at the
// path's existing time points (or at clip start/end for static cases),
// ready to feed into the smoothing pass.
export function buildRawSeries(
  clip: Clip,
  source: SourceMeta,
  opts?: IgFramingOpts,
): IgFramingSample[] {
  const o = withDefaults(opts);
  const driver = pickDrivingMarker(clip);
  const duration = Math.max(0, clip.out - clip.in);

  const minH = source.height * o.minHeightFraction;
  const maxH = source.height;

  // No marker → static crop centred on the focus box.
  if (!driver) {
    const cx = clip.zoom.x + clip.zoom.width / 2;
    const cy = clip.zoom.y + clip.zoom.height / 2;
    const h = clamp(source.height * o.defaultZoomFraction, minH, maxH);
    const w = Math.min(h * o.targetAspect, source.width);
    return [
      { t: 0, cx, cy, w, h },
      { t: duration, cx, cy, w, h },
    ];
  }

  // Marker height drives crop size (padded). Same value applied at every
  // sample for static markers; for tracked markers we still use the marker
  // box dims (path samples carry only centres). If you want size to vary
  // along the path, that would need keyframed marker dims — out of scope.
  const rawH = driver.height * o.paddingFactor;
  const h = clamp(rawH, minH, maxH);
  const w = Math.min(h * o.targetAspect, source.width);

  if (!driver.path || driver.path.length === 0) {
    const cx = driver.x + driver.width / 2;
    const cy = driver.y + driver.height / 2;
    return [
      { t: 0, cx, cy, w, h },
      { t: duration, cx, cy, w, h },
    ];
  }

  // Tracked marker — sample the path verbatim. (Smoothing is a later pass.)
  return driver.path.map(p => ({ t: p.t, cx: p.cx, cy: p.cy, w, h }));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- tests/unit/instagramFraming.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/instagramFraming.ts tests/unit/instagramFraming.test.ts
git commit -m "feat(framing): buildRawSeries for IG framing samples"
```

---

### Task 5: Gaussian smoothing

**Files:**
- Modify: `src/shared/instagramFraming.ts`
- Test: `tests/unit/instagramFraming.test.ts`

- [ ] **Step 1: Write failing test for smoothing**

Append to `tests/unit/instagramFraming.test.ts`:

```ts
import { gaussianSmoothSeries } from '../../src/shared/instagramFraming';

test('gaussianSmoothSeries leaves a constant series unchanged', () => {
  const input: IgFramingSample[] = [
    { t: 0, cx: 100, cy: 200, w: 540, h: 960 },
    { t: 1, cx: 100, cy: 200, w: 540, h: 960 },
    { t: 2, cx: 100, cy: 200, w: 540, h: 960 },
  ];
  const out = gaussianSmoothSeries(input, 0.5);
  expect(out.length).toBe(input.length);
  for (let i = 0; i < input.length; i++) {
    expect(out[i]!.cx).toBeCloseTo(100);
    expect(out[i]!.cy).toBeCloseTo(200);
  }
});

test('gaussianSmoothSeries softens a step', () => {
  // A step in cx from 0 to 1000 at t=2.
  const input: IgFramingSample[] = [
    { t: 0, cx: 0,    cy: 0, w: 540, h: 960 },
    { t: 1, cx: 0,    cy: 0, w: 540, h: 960 },
    { t: 2, cx: 1000, cy: 0, w: 540, h: 960 },
    { t: 3, cx: 1000, cy: 0, w: 540, h: 960 },
    { t: 4, cx: 1000, cy: 0, w: 540, h: 960 },
  ];
  const out = gaussianSmoothSeries(input, 0.5);
  // Endpoints stay near input; middle samples ease across the step.
  expect(out[0]!.cx).toBeLessThan(50);
  expect(out[4]!.cx).toBeGreaterThan(950);
  // The point AT the step (index 2) lands somewhere between 0 and 1000.
  expect(out[2]!.cx).toBeGreaterThan(50);
  expect(out[2]!.cx).toBeLessThan(950);
});

test('gaussianSmoothSeries with sigma=0 returns the input unchanged', () => {
  const input: IgFramingSample[] = [
    { t: 0, cx: 100, cy: 200, w: 540, h: 960 },
    { t: 1, cx: 800, cy: 400, w: 540, h: 960 },
  ];
  const out = gaussianSmoothSeries(input, 0);
  expect(out[0]!.cx).toBeCloseTo(100);
  expect(out[1]!.cx).toBeCloseTo(800);
});

test('gaussianSmoothSeries handles 0/1 sample inputs without NaN', () => {
  expect(gaussianSmoothSeries([], 0.5)).toEqual([]);
  const single: IgFramingSample[] = [{ t: 0, cx: 100, cy: 200, w: 540, h: 960 }];
  const out = gaussianSmoothSeries(single, 0.5);
  expect(out).toHaveLength(1);
  expect(Number.isFinite(out[0]!.cx)).toBe(true);
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test -- tests/unit/instagramFraming.test.ts`
Expected: FAIL — `gaussianSmoothSeries` not defined.

- [ ] **Step 3: Implement Gaussian smoothing**

Append to `src/shared/instagramFraming.ts`:

```ts
// Symmetric Gaussian smoothing of a time series. We're operating offline on
// a known full path, so we can look ahead and behind. Endpoints are NOT held
// fixed — they get blended too — so a constant prefix/suffix of the input
// pulls them toward the constant value (which is what we want when the
// input itself starts at a stable position).
//
// Simple O(N²) implementation — paths in this app top out at a few hundred
// samples so we don't need an FFT-backed convolution.
export function gaussianSmoothSeries(
  samples: IgFramingSample[],
  sigmaSeconds: number,
): IgFramingSample[] {
  if (samples.length === 0) return [];
  if (sigmaSeconds <= 0 || samples.length === 1) {
    // No smoothing — return a defensive copy so callers can mutate freely.
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
    return {
      t: centre.t,
      cx: cxSum / sumW,
      cy: cySum / sumW,
      w: wSum / sumW,
      h: hSum / sumW,
    };
  });
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- tests/unit/instagramFraming.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/instagramFraming.ts tests/unit/instagramFraming.test.ts
git commit -m "feat(framing): Gaussian smoothing of framing series"
```

---

### Task 6: Edge clamping

**Files:**
- Modify: `src/shared/instagramFraming.ts`
- Test: `tests/unit/instagramFraming.test.ts`

- [ ] **Step 1: Write failing test for clamping**

Append to `tests/unit/instagramFraming.test.ts`:

```ts
import { clampSeriesToSource } from '../../src/shared/instagramFraming';

test('clampSeriesToSource leaves an in-bounds sample unchanged', () => {
  const input: IgFramingSample[] = [
    { t: 0, cx: 960, cy: 540, w: 540, h: 960 }, // fully inside 1920×1080
  ];
  const out = clampSeriesToSource(input, SRC);
  expect(out[0]!.cx).toBe(960);
  expect(out[0]!.cy).toBe(540);
});

test('clampSeriesToSource pulls a left-edge centre to keep the rect inside', () => {
  // w=540 → half-width=270; cx=100 would put the left edge at -170.
  const input: IgFramingSample[] = [{ t: 0, cx: 100, cy: 540, w: 540, h: 960 }];
  const out = clampSeriesToSource(input, SRC);
  expect(out[0]!.cx).toBe(270); // left edge sits at exactly 0
});

test('clampSeriesToSource pulls a right-edge centre back', () => {
  const input: IgFramingSample[] = [{ t: 0, cx: 1900, cy: 540, w: 540, h: 960 }];
  const out = clampSeriesToSource(input, SRC);
  expect(out[0]!.cx).toBe(SRC.width - 270); // right edge at sourceW
});

test('clampSeriesToSource shrinks rect that exceeds source bounds, preserving aspect', () => {
  // h=2000 > 1080. Should clamp h to 1080 and shrink w by the same factor.
  const input: IgFramingSample[] = [{ t: 0, cx: 960, cy: 540, w: 1125, h: 2000 }];
  const out = clampSeriesToSource(input, SRC);
  expect(out[0]!.h).toBe(1080);
  expect(out[0]!.w).toBeCloseTo(1125 * (1080 / 2000), 3);
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test -- tests/unit/instagramFraming.test.ts`
Expected: FAIL — `clampSeriesToSource` not defined.

- [ ] **Step 3: Implement clamping**

Append to `src/shared/instagramFraming.ts`:

```ts
// Clamp each sample so the crop rect fits inside the source. Two stages:
//   1. If h > source.height or w > source.width, shrink both axes by the
//      tighter limiting factor (preserves the aspect chosen earlier).
//   2. Clamp cx/cy so [cx ± w/2, cy ± h/2] sits inside [0, source.{w,h}].
export function clampSeriesToSource(
  samples: IgFramingSample[],
  source: SourceMeta,
): IgFramingSample[] {
  return samples.map(s => {
    let { w, h } = s;
    const fitW = w > source.width ? source.width / w : 1;
    const fitH = h > source.height ? source.height / h : 1;
    const fit = Math.min(fitW, fitH);
    if (fit < 1) {
      w = w * fit;
      h = h * fit;
    }
    const halfW = w / 2;
    const halfH = h / 2;
    const cx = clamp(s.cx, halfW, source.width - halfW);
    const cy = clamp(s.cy, halfH, source.height - halfH);
    return { t: s.t, cx, cy, w, h };
  });
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- tests/unit/instagramFraming.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/instagramFraming.ts tests/unit/instagramFraming.test.ts
git commit -m "feat(framing): clampSeriesToSource keeps crop rect inside frame"
```

---

### Task 7: Public `computeInstagramFraming` (with thinning)

**Files:**
- Modify: `src/shared/instagramFraming.ts`
- Test: `tests/unit/instagramFraming.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/instagramFraming.test.ts`:

```ts
import { computeInstagramFraming } from '../../src/shared/instagramFraming';

test('computeInstagramFraming with no markers returns static framing on focus-box centre', () => {
  const clip = clipWith([]);
  const r = computeInstagramFraming(clip, SRC);
  expect(r.driverMarkerId).toBeNull();
  expect(r.samples.length).toBeGreaterThanOrEqual(2);
  expect(r.samples[0]!.cx).toBeCloseTo(960);
});

test('computeInstagramFraming with primary marker returns its id as driver', () => {
  const marker: FocusMarker = {
    id: 'mP', x: 200, y: 200, width: 80, height: 80, in: 0, out: 5,
    color: 'yellow', primary: true,
  };
  const r = computeInstagramFraming(clipWith([m('m1'), marker]), SRC);
  expect(r.driverMarkerId).toBe('mP');
});

test('computeInstagramFraming smooths a path-tracked marker', () => {
  const marker: FocusMarker = {
    id: 'm1', x: 0, y: 0, width: 100, height: 100, in: 0, out: 5, color: 'yellow',
    path: Array.from({ length: 50 }, (_, i) => ({
      t: i * 0.1,
      cx: 960 + (i % 2 === 0 ? -50 : 50), // jitter ± 50px
      cy: 540,
    })),
  };
  const r = computeInstagramFraming(clipWith([marker]), SRC);
  // Smoothing should pull the jittered cx very close to 960.
  for (const s of r.samples) expect(Math.abs(s.cx - 960)).toBeLessThan(20);
});

test('computeInstagramFraming thins to ≤ 40 segments', () => {
  const marker: FocusMarker = {
    id: 'm1', x: 0, y: 0, width: 100, height: 100, in: 0, out: 5, color: 'yellow',
    path: Array.from({ length: 200 }, (_, i) => ({ t: i * 0.025, cx: 960, cy: 540 })),
  };
  const r = computeInstagramFraming(clipWith([marker]), SRC);
  expect(r.samples.length).toBeLessThanOrEqual(41); // 40 segments = 41 endpoints
});

test('computeInstagramFraming clamps an off-edge marker centre', () => {
  const marker: FocusMarker = {
    id: 'm1', x: 0, y: 0, width: 80, height: 80, in: 0, out: 5, color: 'yellow',
    path: [{ t: 0, cx: -100, cy: 540 }, { t: 5, cx: -100, cy: 540 }],
  };
  const r = computeInstagramFraming(clipWith([marker]), SRC);
  // Centre must satisfy cx >= w/2 (left edge inside source).
  for (const s of r.samples) expect(s.cx).toBeGreaterThanOrEqual(s.w / 2 - 0.001);
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test -- tests/unit/instagramFraming.test.ts`
Expected: FAIL — `computeInstagramFraming` not defined.

- [ ] **Step 3: Implement the public function**

Append to `src/shared/instagramFraming.ts`:

```ts
const MAX_SEGMENTS = 40;

// Thin a series down to at most maxSegments segments, keeping the first and
// last samples and picking ~evenly spaced points in between. Mirrors the
// thinPathForExport helper in command.ts so the IG ffmpeg expression stays
// compact regardless of the source path's density.
function thinSeries(samples: IgFramingSample[], maxSegments: number): IgFramingSample[] {
  if (samples.length <= maxSegments + 1) return samples;
  const factor = Math.ceil((samples.length - 1) / maxSegments);
  const out: IgFramingSample[] = [samples[0]!];
  for (let i = factor; i < samples.length - 1; i += factor) out.push(samples[i]!);
  out.push(samples[samples.length - 1]!);
  return out;
}

// Public entry point. Pipeline: pick driver → build raw centre/size series →
// Gaussian-smooth → clamp to source bounds → thin for compact downstream
// expressions. Smoothing happens BEFORE clamping so the eased trajectory is
// computed in unconstrained space and only then trimmed at the edges.
export function computeInstagramFraming(
  clip: Clip,
  source: SourceMeta,
  opts?: IgFramingOpts,
): { samples: IgFramingSample[]; driverMarkerId: string | null } {
  const o = withDefaults(opts);
  const driver = pickDrivingMarker(clip);
  const raw = buildRawSeries(clip, source, o);
  const smoothed = gaussianSmoothSeries(raw, o.smoothingSigmaSeconds);
  const clamped = clampSeriesToSource(smoothed, source);
  const thinned = thinSeries(clamped, MAX_SEGMENTS);
  return {
    samples: thinned,
    driverMarkerId: driver?.id ?? null,
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- tests/unit/instagramFraming.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/instagramFraming.ts tests/unit/instagramFraming.test.ts
git commit -m "feat(framing): public computeInstagramFraming with thinning"
```

---

## Phase 3: FFmpeg pipeline

### Task 8: `instagramWatermarkFilter`

**Files:**
- Modify: `src/main/ffmpeg/command.ts`
- Test: `tests/unit/command.test.ts`

- [ ] **Step 1: Write failing test**

Append to `tests/unit/command.test.ts`:

```ts
import { instagramWatermarkFilter } from '../../src/main/ffmpeg/command';

test('instagramWatermarkFilter scales font size against the shorter dimension', () => {
  const filter = instagramWatermarkFilter(1080, 1920);
  // shorter dim = 1080. fontSize = max(14, round(1080 * 0.022)) = 24.
  expect(filter).toMatch(/fontsize=24/);
  // x = round(width * 0.1) = 108.
  expect(filter).toMatch(/:x=108:/);
  // y = max(12, round(min(w,h) * 0.02)) = max(12, 22) = 22.
  expect(filter).toMatch(/:y=22:/);
  // Same text and styling as the existing watermark.
  expect(filter).toContain("text='Made with reelmagicpro.co.uk'");
  expect(filter).toContain('fontcolor=white');
  expect(filter).toContain('borderw=2:bordercolor=black@0.7');
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npm test -- tests/unit/command.test.ts`
Expected: FAIL — `instagramWatermarkFilter` not exported.

- [ ] **Step 3: Add `instagramWatermarkFilter` to `command.ts`**

In `src/main/ffmpeg/command.ts`, after the existing `watermarkFilter` function, add:

```ts
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
```

- [ ] **Step 4: Run test — expect pass**

Run: `npm test -- tests/unit/command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ffmpeg/command.ts tests/unit/command.test.ts
git commit -m "feat(ffmpeg): instagramWatermarkFilter for portrait canvas"
```

---

### Task 9: `buildInstagramOutroFfmpegArgs`

**Files:**
- Modify: `src/main/ffmpeg/command.ts`
- Test: `tests/unit/command.test.ts`

- [ ] **Step 1: Write failing test**

Append to `tests/unit/command.test.ts`:

```ts
import { buildInstagramOutroFfmpegArgs } from '../../src/main/ffmpeg/command';

test('buildInstagramOutroFfmpegArgs scales/pads to 1080x1920 with audio passthrough', () => {
  const src: SourceMeta = { path: '/in.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };
  const args = buildInstagramOutroFfmpegArgs('/outro.mp4', src, '/out.mp4', true);
  const fcIdx = args.indexOf('-filter_complex');
  expect(args[fcIdx + 1]).toContain('scale=1080:1920:force_original_aspect_ratio=decrease');
  expect(args[fcIdx + 1]).toContain('pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black');
  // fps and SAR set the same way as standard outro.
  expect(args[fcIdx + 1]).toContain(`fps=30`);
  expect(args[fcIdx + 1]).toContain('setsar=1');
  // -aspect uses the IG dims so the SPS/SAR matches the IG clip parts.
  const aspectIdx = args.indexOf('-aspect');
  expect(args[aspectIdx + 1]).toBe('1080:1920');
  // No silent-audio synth when the outro already has audio.
  expect(args).not.toContain('anullsrc=cl=stereo:r=48000');
});

test('buildInstagramOutroFfmpegArgs synthesises silent audio when source has none', () => {
  const src: SourceMeta = { path: '/in.mp4', duration: 100, width: 1920, height: 1080, fps: 30 };
  const args = buildInstagramOutroFfmpegArgs('/outro.mp4', src, '/out.mp4', false);
  expect(args).toContain('anullsrc=cl=stereo:r=48000');
  expect(args).toContain('-shortest');
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npm test -- tests/unit/command.test.ts`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement `buildInstagramOutroFfmpegArgs`**

In `src/main/ffmpeg/command.ts`, after `buildOutroFfmpegArgs`, add:

```ts
import { INSTAGRAM_REEL_WIDTH, INSTAGRAM_REEL_HEIGHT } from '../../shared/instagramFormat';

// IG variant of buildOutroFfmpegArgs. The outro file is letterboxed/scaled
// to fit 1080×1920. Used both when the user has set a 9:16 outro file (it
// already fits — the scale+pad is a no-op effectively) and when we're
// reusing the standard 16:9 outro for the IG export (it gets rescaled with
// black bars top and bottom).
//
// The framerate and SAR-fixing tricks from buildOutroFfmpegArgs are kept —
// they're what stops the concat filter rejecting parts with mismatched
// timing/SAR parameters.
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
```

- [ ] **Step 4: Run test — expect pass**

Run: `npm test -- tests/unit/command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ffmpeg/command.ts tests/unit/command.test.ts
git commit -m "feat(ffmpeg): buildInstagramOutroFfmpegArgs for 1080x1920 outro"
```

---

### Task 10: `buildInstagramClipFfmpegArgs`

**Files:**
- Modify: `src/main/ffmpeg/command.ts`
- Test: `tests/unit/command.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/command.test.ts`:

```ts
import { buildInstagramClipFfmpegArgs } from '../../src/main/ffmpeg/command';
import { computeInstagramFraming } from '../../src/shared/instagramFraming';

test('buildInstagramClipFfmpegArgs adds an IG crop+scale stage and IG watermark', () => {
  const clip: Clip = { ...baseClip };
  const framing = computeInstagramFraming(clip, source);
  const args = buildInstagramClipFfmpegArgs(clip, source, framing.samples, '/out.mp4');
  const fcIdx = args.indexOf('-filter_complex');
  const fc = args[fcIdx + 1]!;
  // Existing zoom crop + rescale-to-source still in place.
  expect(fc).toContain(`crop=1920:1080:0:0,scale=1920:1080`);
  // A second `crop=...` runs after the zoom rescale. The IG crop's w/h/x/y
  // are expressions, so we just check the second crop appears.
  expect(fc.match(/crop=/g)?.length).toBe(2);
  // Followed by scale to IG dims.
  expect(fc).toContain(`scale=1080:1920`);
  // IG watermark (24px) replaces the source-sized one.
  expect(fc).toMatch(/fontsize=24/);
  // -aspect set to the IG dims for the SPS.
  const aspectIdx = args.indexOf('-aspect');
  expect(args[aspectIdx + 1]).toBe('1080:1920');
});

test('buildInstagramClipFfmpegArgs preserves marker filters in the chain', () => {
  const clip: Clip = {
    ...baseClip,
    focusMarkers: [
      { id: 'm1', x: 100, y: 200, width: 80, height: 80, in: 12, out: 18, color: 'yellow' },
    ],
  };
  const framing = computeInstagramFraming(clip, source);
  const args = buildInstagramClipFfmpegArgs(clip, source, framing.samples, '/out.mp4');
  const fcIdx = args.indexOf('-filter_complex');
  // drawbox for the marker still appears (in source-size space, before IG crop).
  expect(args[fcIdx + 1]).toContain('drawbox=');
});

test('standard buildClipFfmpegArgs is byte-identical for a fixture clip (regression guard)', () => {
  // Snapshot of the existing standard chain so the IG work doesn't accidentally
  // alter it. Compare against the exact same expectation as the existing
  // "builds args for full-frame, 1x speed" test above.
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
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test -- tests/unit/command.test.ts`
Expected: FAIL — `buildInstagramClipFfmpegArgs` not exported.

- [ ] **Step 3: Implement `buildInstagramClipFfmpegArgs`**

In `src/main/ffmpeg/command.ts`, after `buildClipFfmpegArgs`, add:

```ts
import type { IgFramingSample } from '../../shared/instagramFraming';

// IG variant of buildClipFfmpegArgs. Pipeline:
//   crop(zoom) → scale(srcW:srcH) → markers
//     → crop(igX(t), igY(t), igW(t), igH(t))   // smoothed, time-varying
//     → scale(IG_W:IG_H)
//     → watermark (sized for IG canvas)
//     → setpts → [v]
//
// The IG crop expressions are piecewise functions of `t` (clip-relative
// seconds) — `crop` re-evaluates per frame, so this works directly. Coords
// in `framingSamples` are SOURCE-PIXEL coords (matching marker.x/y); we
// map them into post-zoom space the same way buildMarkerFilters does.
export function buildInstagramClipFfmpegArgs(
  clip: Clip,
  source: SourceMeta,
  framingSamples: IgFramingSample[],
  outputPath: string,
): string[] {
  const z = clip.zoom;
  const sx = source.width / z.width;
  const sy = source.height / z.height;
  // Map source-space framing samples into post-zoom space.
  const cxPts = framingSamples.map(s => ({ t: s.t, v: (s.cx - z.x) * sx }));
  const cyPts = framingSamples.map(s => ({ t: s.t, v: (s.cy - z.y) * sy }));
  const wPts  = framingSamples.map(s => ({ t: s.t, v: s.w * sx }));
  const hPts  = framingSamples.map(s => ({ t: s.t, v: s.h * sy }));
  // crop's x/y/w/h are top-left, so xExpr = cx - w/2, yExpr = cy - h/2.
  const wExpr = piecewiseExpr(wPts);
  const hExpr = piecewiseExpr(hPts);
  const xExpr = `(${piecewiseExpr(cxPts)})-(${wExpr})/2`;
  const yExpr = `(${piecewiseExpr(cyPts)})-(${hExpr})/2`;

  const setpts = clip.speed === 1 ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${fmt(clip.speed)}`;
  const markerFilters = buildMarkerFilters(clip, source);
  const igWatermark = instagramWatermarkFilter(INSTAGRAM_REEL_WIDTH, INSTAGRAM_REEL_HEIGHT);

  const filter = `[0:v]crop=${fmt(z.width)}:${fmt(z.height)}:${fmt(z.x)}:${fmt(z.y)}`
    + `,scale=${source.width}:${source.height}`
    + (markerFilters ? `,${markerFilters}` : '')
    + `,crop=w='${wExpr}':h='${hExpr}':x='${xExpr}':y='${yExpr}'`
    + `,scale=${INSTAGRAM_REEL_WIDTH}:${INSTAGRAM_REEL_HEIGHT}`
    + `,${igWatermark}`
    + `,setpts=${setpts}[v]`;

  const head = ['-y', '-ss', fmt(clip.in), '-to', fmt(clip.out), '-i', source.path];
  const audioInput = clip.speed === 1 ? [] : ['-f', 'lavfi', '-i', 'anullsrc=cl=stereo:r=48000'];
  const fc = ['-filter_complex', filter];
  const map = clip.speed === 1
    ? ['-map', '[v]', '-map', '0:a?']
    : ['-map', '[v]', '-map', '1:a', '-shortest'];
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

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- tests/unit/command.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full unit suite (regression check)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/ffmpeg/command.ts tests/unit/command.test.ts
git commit -m "feat(ffmpeg): buildInstagramClipFfmpegArgs with smoothed crop"
```

---

### Task 11: Exporter — `format` and IG outro fallback

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/ffmpeg/exporter.ts`

- [ ] **Step 1: Extend `ExportClipArgs` and `ExportSequenceArgs`**

In `src/shared/types.ts`, modify the export args interfaces:

```ts
export type ExportFormat = 'standard' | 'instagram';

export interface ExportClipArgs {
  runId: string; clip: Clip; source: SourceMeta; outputPath: string;
  outro?: OutroSpec;
  format?: ExportFormat;            // default 'standard'
  instagramOutroPath?: string;      // optional; preferred over `outro` when format === 'instagram'
}
export interface ExportSequenceArgs {
  runId: string; clips: Clip[]; sequence: SequenceEntry[]; source: SourceMeta; outputPath: string;
  outro?: OutroSpec;
  format?: ExportFormat;
  instagramOutroPath?: string;
}
```

- [ ] **Step 2: Branch `exportClip` on format**

In `src/main/ffmpeg/exporter.ts`, modify the top-level `exportClip` and the helpers it calls. The change has three parts:

(a) Extend the option type on `exportClip` and pass the new fields down:

```ts
export async function exportClip(opts: {
  runId: string;
  clip: Clip;
  source: SourceMeta;
  outputPath: string;
  outro?: OutroSpec;
  format?: ExportFormat;
  instagramOutroPath?: string;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  // ... existing body, with two branch points below ...
}
```

(b) Where `runSinglePassClip` and `renderClipPart` build their ffmpeg args via `buildClipFfmpegArgs`, branch on `format`:

```ts
import { buildClipFfmpegArgs, buildOutroFfmpegArgs, buildInstagramClipFfmpegArgs, buildInstagramOutroFfmpegArgs } from './command';
import { computeInstagramFraming } from '../../shared/instagramFraming';

function buildArgsForClip(clip: Clip, source: SourceMeta, outputPath: string, format: ExportFormat): string[] {
  if (format === 'instagram') {
    const framing = computeInstagramFraming(clip, source);
    return buildInstagramClipFfmpegArgs(clip, source, framing.samples, outputPath);
  }
  return buildClipFfmpegArgs(clip, source, outputPath);
}
```

Replace the two existing `buildClipFfmpegArgs(clip, source, outputPath)` calls (in `runSinglePassClip` and `renderClipPart`) with `buildArgsForClip(clip, source, outputPath, format)`. Plumb the `format` arg through both functions' option types and through their callers in `exportClip`.

(c) Add an outro-resolution helper that picks between `instagramOutroPath` (preferred when format=instagram), the standard `outro` letterboxed, or no outro at all:

```ts
async function resolveOutroForFormat(opts: {
  format: ExportFormat;
  outro?: OutroSpec;
  instagramOutroPath?: string;
  onWarning?: (msg: string) => void;
}): Promise<
  | { ok: true; spec: OutroSpec; durationMs: number; hasAudio: boolean; useIgEncoder: boolean }
  | { ok: true; none: true }
  | { ok: false; error: string }
> {
  const { format, outro, instagramOutroPath, onWarning } = opts;
  if (format === 'instagram') {
    // Prefer instagramOutroPath; if missing/unprobeable, fall back to standard outro letterboxed.
    if (instagramOutroPath) {
      const r = await resolveOutro({ path: instagramOutroPath });
      if (r.ok) return { ok: true, spec: { path: instagramOutroPath }, durationMs: r.durationMs, hasAudio: r.hasAudio, useIgEncoder: true };
      onWarning?.('Instagram outro file not found — using standard outro letterboxed.');
    }
    if (!outro) return { ok: true, none: true };
    const r = await resolveOutro(outro);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, spec: outro, durationMs: r.durationMs, hasAudio: r.hasAudio, useIgEncoder: true };
  }
  // Standard format
  if (!outro) return { ok: true, none: true };
  const r = await resolveOutro(outro);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, spec: outro, durationMs: r.durationMs, hasAudio: r.hasAudio, useIgEncoder: false };
}
```

Then update `exportClip`'s outro path: replace the existing `await resolveOutro(outro)` call (and the `if (!outro) return runSinglePassClip(...)` check above it) with a single call to `resolveOutroForFormat`. When `useIgEncoder` is true, replace `renderOutroPart`'s call to `buildOutroFfmpegArgs` with `buildInstagramOutroFfmpegArgs`.

The cleanest way is to extend `renderOutroPart` to take a `format` param and switch internally:

```ts
async function renderOutroPart(opts: {
  outro: OutroSpec;
  source: SourceMeta;
  outputPath: string;
  durationMs: number;
  hasAudio: boolean;
  format: ExportFormat;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { outro, source, outputPath, durationMs, hasAudio, format, signal, onProgress } = opts;
  const args = format === 'instagram'
    ? buildInstagramOutroFfmpegArgs(outro.path, source, outputPath, hasAudio)
    : buildOutroFfmpegArgs(outro.path, source, outputPath, hasAudio);
  const r = await runFfmpeg({ args, totalDurationMs: durationMs, signal, onProgress });
  if (!r.ok) {
    return { ok: false, error: r.stderrTail || `Outro render failed (exit ${r.exitCode})` };
  }
  return { ok: true };
}
```

Pass `format` from `exportClip` and `exportSequence` into every internal call.

The `concatToOutput` `source` parameter is used by `buildFilterConcatFfmpegArgs` (in `concatList.ts`) to set the output canvas. When format=instagram, that canvas needs to be IG dims. For now, keep concat working by passing a synthetic `SourceMeta` with `width/height` set to the IG dims when format=instagram:

```ts
const concatSource: SourceMeta = format === 'instagram'
  ? { ...source, width: INSTAGRAM_REEL_WIDTH, height: INSTAGRAM_REEL_HEIGHT }
  : source;
// ...pass concatSource to concatToOutput.
```

Import `INSTAGRAM_REEL_WIDTH`, `INSTAGRAM_REEL_HEIGHT` at the top of `exporter.ts`.

(d) Default `format` to `'standard'` when undefined:

```ts
const format: ExportFormat = opts.format ?? 'standard';
```

near the top of both `exportClip` and `exportSequence`.

- [ ] **Step 3: Type-check + run unit tests (no behaviour change for standard exports)**

Run: `npm run build:main && npm test`
Expected: build succeeds; existing tests pass; the snapshot test from Task 10 still confirms standard byte-identity.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/ffmpeg/exporter.ts
git commit -m "feat(exporter): branch on export format and resolve IG outro fallback"
```

---

### Task 12: Plumb `format` and `instagramOutroPath` through IPC

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/preload.ts`
- Modify: `src/shared/window.d.ts`

- [ ] **Step 1: Update IPC handlers to forward the new fields**

In `src/main/ipc.ts`, update both export handlers to forward `format` and `instagramOutroPath`:

```ts
ipcMain.handle('app:exportClip', async (_e, args: ExportClipArgs) => {
  const ctrl = new AbortController();
  const work = (async () => {
    try {
      return await exportClip({
        runId: args.runId, clip: args.clip, source: args.source, outputPath: args.outputPath,
        outro: args.outro,
        format: args.format,
        instagramOutroPath: args.instagramOutroPath,
        onProgress: sendProgress, signal: ctrl.signal,
      });
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    } finally {
      activeRuns.delete(args.runId);
    }
  })();
  activeRuns.set(args.runId, { ctrl, finished: work });
  return work;
});
```

(Same edit for `app:exportSequence`.)

- [ ] **Step 2: Confirm preload + window.d.ts already cover the new fields**

Both `preload.ts` and `window.d.ts` use the `ExportClipArgs`/`ExportSequenceArgs` types directly, so the new fields are already in scope. **No code changes needed here** — but type-check to confirm:

Run: `npm run build:main`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat(ipc): forward format and instagramOutroPath to exporter"
```

---

## Phase 4: Renderer state + settings

### Task 13: Add `instagramOutroPath` to settings store

**Files:**
- Modify: `src/renderer/state/settings.ts`

- [ ] **Step 1: Extend `Settings` and persistence**

In `src/renderer/state/settings.ts`:

```ts
export interface Settings {
  bookmarkRewindSeconds: number;
  skipSeconds: number;
  trackingPlaybackRate: number;
  // Optional path to a 9:16 outro to append to Instagram exports. When unset,
  // the standard outro (if any) is rescaled with black bars top/bottom.
  instagramOutroPath?: string;
}

const defaults: Settings = {
  bookmarkRewindSeconds: 10,
  skipSeconds: 5,
  trackingPlaybackRate: 0.5,
  // instagramOutroPath: undefined
};

function loadSaved(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      bookmarkRewindSeconds: numberOr(parsed.bookmarkRewindSeconds, defaults.bookmarkRewindSeconds),
      skipSeconds: numberOr(parsed.skipSeconds, defaults.skipSeconds),
      trackingPlaybackRate: numberOr(parsed.trackingPlaybackRate, defaults.trackingPlaybackRate),
      instagramOutroPath: typeof parsed.instagramOutroPath === 'string' ? parsed.instagramOutroPath : undefined,
    };
  } catch {
    return defaults;
  }
}
```

And update the `update` function to persist the new field:

```ts
update: (patch) => set(state => {
  const next: Settings = {
    bookmarkRewindSeconds: patch.bookmarkRewindSeconds ?? state.bookmarkRewindSeconds,
    skipSeconds: patch.skipSeconds ?? state.skipSeconds,
    trackingPlaybackRate: patch.trackingPlaybackRate ?? state.trackingPlaybackRate,
    instagramOutroPath: 'instagramOutroPath' in patch ? patch.instagramOutroPath : state.instagramOutroPath,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  return next;
}),
```

(Note `'instagramOutroPath' in patch` — required so the user can clear the path by passing `{ instagramOutroPath: undefined }` rather than the spread keeping the old value.)

- [ ] **Step 2: Type-check**

Run: `npm run build:renderer`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/state/settings.ts
git commit -m "feat(settings): persist instagramOutroPath"
```

---

### Task 14: SettingsModal — IG outro field

**Files:**
- Modify: `src/renderer/components/SettingsModal.tsx`

- [ ] **Step 1: Add a path-picker row to SettingsModal**

In `src/renderer/components/SettingsModal.tsx`, add a new field below the existing three. The Field component takes numeric values, so we'll inline a small `PathField` component for files:

```tsx
function PathField({ label, help, value, onPick, onClear }: {
  label: string;
  help: string;
  value: string | undefined;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, flex: 1 }}>{label}</span>
        <button onClick={onPick}>Browse…</button>
        {value && <button onClick={onClear}>Clear</button>}
      </div>
      <span className="dim" style={{ fontSize: 11, wordBreak: 'break-all' }}>
        {value ?? '(not set)'}
      </span>
      <span className="dim" style={{ fontSize: 11 }}>{help}</span>
    </div>
  );
}
```

Then add a new field to the modal body, after the "Tracking playback speed" field:

```tsx
<PathField
  label="Instagram outro (9:16)"
  help="Optional. If unset, the standard outro is rescaled with black bars when exporting Instagram videos."
  value={settings.instagramOutroPath}
  onPick={async () => {
    const r = await window.reelmagic.chooseOutroFile();
    if (r.ok && r.path) settings.update({ instagramOutroPath: r.path });
  }}
  onClear={() => settings.update({ instagramOutroPath: undefined })}
/>
```

- [ ] **Step 2: Build the renderer + smoke**

Run: `npm run build:renderer`
Expected: succeeds.

Manually: open the app (`npm run dev`), open Settings, confirm the new field appears, picks a file, persists across reload (check localStorage `reelmagic.settings`).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/SettingsModal.tsx
git commit -m "feat(settings-ui): IG outro file picker"
```

---

### Task 15: Project store — `togglePrimaryMarker`

**Files:**
- Modify: `src/renderer/state/projectStore.ts`

- [ ] **Step 1: Locate the project store and find marker-mutation actions**

Read `src/renderer/state/projectStore.ts`. There are existing actions that mutate markers (e.g. add/remove/track). Add a new action alongside them:

```ts
togglePrimaryMarker: (clipId: string, markerId: string) => set(state => {
  if (!state.project) return state;
  const clips = state.project.clips.map(c => {
    if (c.id !== clipId) return c;
    const target = c.focusMarkers.find(m => m.id === markerId);
    if (!target) return c;
    const willBePrimary = !target.primary;
    // Strip primary cleanly rather than writing `primary: false` so the saved
    // project file stays minimal.
    const focusMarkers = c.focusMarkers.map(m => {
      const next: FocusMarker = { ...m };
      delete next.primary;
      if (m.id === markerId && willBePrimary) next.primary = true;
      return next;
    });
    return { ...c, focusMarkers };
  });
  return { ...state, project: { ...state.project, clips }, dirty: true };
}),
```

(The trailing `.map(...)` strips `primary: false` so it's never written to the project file — keeps saved files clean.)

Also add the corresponding type to whatever store-state interface the file declares (e.g. `ProjectStoreState`).

- [ ] **Step 2: Type-check + run unit tests**

Run: `npm test && npm run build:renderer`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/state/projectStore.ts
git commit -m "feat(store): togglePrimaryMarker action"
```

---

### Task 16: Marker UI — primary star toggle

**Files:**
- Modify: `src/renderer/components/ClipFocusMarkers.tsx` (and/or whichever component renders the marker list — locate it via `git grep -nE 'focusMarkers\\.map|removeFocusMarker'`)

- [ ] **Step 1: Locate the marker list rendering**

Run: `git grep -nE 'focusMarkers\.map|removeFocusMarker' src/renderer/components/`

Identify the component that renders the marker list (most likely `ClipFocusMarkers.tsx` or `ClipDetail.tsx`).

- [ ] **Step 2: Render a star button per marker**

In the located component, add a star button beside each marker entry. Determine the implicit-primary marker (first when none flagged):

```tsx
const explicitPrimary = clip.focusMarkers.find(m => m.primary === true);
const implicitPrimaryId = explicitPrimary
  ? explicitPrimary.id
  : (clip.focusMarkers[0]?.id ?? null);

// Then per marker:
function StarButton({ marker }: { marker: FocusMarker }) {
  const explicit = marker.primary === true;
  const implicit = !explicit && marker.id === implicitPrimaryId;
  const togglePrimaryMarker = useProjectStore(s => s.togglePrimaryMarker);
  const title = explicit
    ? 'Primary marker for Instagram framing — click to unset'
    : 'Set as primary marker for Instagram framing';
  return (
    <button
      onClick={() => togglePrimaryMarker(clip.id, marker.id)}
      title={title}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        opacity: explicit ? 1 : implicit ? 0.45 : 0.25,
        fontSize: 14,
        padding: '0 4px',
      }}
    >★</button>
  );
}
```

- [ ] **Step 3: Build + smoke-test manually**

Run: `npm run build:renderer && npm run dev`

Open a project with multiple markers. Verify:
- First marker shows a half-faded star (implicit primary).
- Click another marker's star → it goes filled, the first goes from half-faded to outline.
- Click the filled star again → goes outline; the first marker reverts to half-faded.
- Save and reload — the primary flag persists.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ClipFocusMarkers.tsx  # adjust if a different file
git commit -m "feat(markers): primary star toggle for IG framing driver"
```

---

## Phase 5: Export options modal + preview

### Task 17: ExportOptionsModal — basic shell

**Files:**
- Create: `src/renderer/components/ExportOptionsModal.tsx`

- [ ] **Step 1: Create a minimal modal shell that resolves to a chosen format**

`src/renderer/components/ExportOptionsModal.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import type { ExportFormat } from '../../shared/types';

export interface ExportOptionsResult {
  ok: boolean;
  format?: ExportFormat;
}

export function ExportOptionsModal(props: {
  open: boolean;
  initialFormat?: ExportFormat;
  // Caller knows which clip / sequence is being exported. The modal is
  // format-only; the file dialog and IPC call still happen in the caller.
  context: { kind: 'clip'; clipName: string } | { kind: 'sequence' };
  onResolve: (r: ExportOptionsResult) => void;
}) {
  const { open, initialFormat = 'standard', onResolve } = props;
  const [format, setFormat] = useState<ExportFormat>(initialFormat);

  useEffect(() => { if (open) setFormat(initialFormat); }, [open, initialFormat]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onResolve({ ok: false }); }
    }
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, [open, onResolve]);

  if (!open) return null;

  return (
    <div onClick={() => onResolve({ ok: false })} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--panel)', border: '1px solid var(--accent-glow)',
        borderRadius: 10, padding: 24, width: 520, maxWidth: '92vw',
        display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Export options</h2>
          <button onClick={() => onResolve({ ok: false })}>Cancel</button>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Format</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={format === 'standard' ? 'primary' : ''}
              onClick={() => setFormat('standard')}
            >Standard (16:9)</button>
            <button
              className={format === 'instagram' ? 'primary' : ''}
              onClick={() => setFormat('instagram')}
            >Instagram (9:16)</button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button className="primary" onClick={() => onResolve({ ok: true, format })}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + type-check**

Run: `npm run build:renderer`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ExportOptionsModal.tsx
git commit -m "feat(export-ui): basic ExportOptionsModal with format toggle"
```

---

### Task 18: InstagramPreviewCanvas component

**Files:**
- Create: `src/renderer/components/InstagramPreviewCanvas.tsx`

- [ ] **Step 1: Create the live cropped 9:16 canvas**

`src/renderer/components/InstagramPreviewCanvas.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import type { Clip, SourceMeta } from '../../shared/types';
import { computeInstagramFraming, IgFramingSample } from '../../shared/instagramFraming';

const DISPLAY_W = 270;
const DISPLAY_H = 480;

// Live preview of the IG-cropped output. Reads a private <video> element
// (kept in sync with the user's chosen scrub time) and draws each frame's
// IG crop window into a canvas using `drawImage` source-rectangle args.
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
```

- [ ] **Step 2: Build + type-check**

Run: `npm run build:renderer`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/InstagramPreviewCanvas.tsx
git commit -m "feat(export-ui): InstagramPreviewCanvas with live drawImage cropping"
```

---

### Task 19: ExportOptionsModal — wire IG canvas + driver summary

**Files:**
- Modify: `src/renderer/components/ExportOptionsModal.tsx`

- [ ] **Step 1: Show preview canvas + summary line when Instagram selected**

Update `ExportOptionsModal` to optionally accept the clip(s) and source for preview, and render the canvas + summary when `format === 'instagram'`:

```tsx
import { InstagramPreviewCanvas } from './InstagramPreviewCanvas';
import { computeInstagramFraming } from '../../shared/instagramFraming';
import type { Clip, SourceMeta } from '../../shared/types';

export function ExportOptionsModal(props: {
  open: boolean;
  initialFormat?: ExportFormat;
  context:
    | { kind: 'clip'; clip: Clip; source: SourceMeta }
    | { kind: 'sequence'; firstClip?: Clip; source: SourceMeta };
  onResolve: (r: ExportOptionsResult) => void;
}) {
  // ... existing state ...

  // Sample preview clip: for sequence export, preview the first clip in order.
  const previewClip: Clip | undefined =
    props.context.kind === 'clip' ? props.context.clip : props.context.firstClip;

  function driverSummary(clip: Clip): string {
    const r = computeInstagramFraming(clip, props.context.source);
    if (!r.driverMarkerId) return 'No focus marker — using focus box centre. Tracking will be static.';
    const m = clip.focusMarkers.find(fm => fm.id === r.driverMarkerId);
    const label = m?.label ?? `marker ${r.driverMarkerId}`;
    const tracked = m?.path && m.path.length > 0 ? `tracked, ${(m.path[m.path.length - 1]!.t - m.path[0]!.t).toFixed(1)}s` : 'static';
    return `Following marker: '${label}' (${tracked})`;
  }

  // ...inside the modal body, after the format toggle, when format === 'instagram':
  {format === 'instagram' && previewClip && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="dim" style={{ fontSize: 12 }}>{driverSummary(previewClip)}</div>
      <InstagramPreviewCanvas clip={previewClip} source={props.context.source} />
    </div>
  )}
```

(For sequence preview, the user only previews the first clip's framing in v1 — the spec didn't promise per-clip preview through the entire sequence. If the sequence is empty, the preview is hidden.)

- [ ] **Step 2: Build + type-check**

Run: `npm run build:renderer`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ExportOptionsModal.tsx
git commit -m "feat(export-ui): preview canvas and driver summary in ExportOptionsModal"
```

---

### Task 20: Wire ExportOptionsModal into App.tsx

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Replace direct `chooseExportPath` calls with the modal flow**

In `App.tsx`, modify `runClipExport` and `runSequenceExport` to first open `ExportOptionsModal`, then proceed with the save dialog and IPC export — passing `format` and (if IG) `instagramOutroPath` from settings:

```tsx
import { ExportOptionsModal, ExportOptionsResult } from './components/ExportOptionsModal';

// Inside `App`:
const [exportOpts, setExportOpts] = useState<{
  context: ExportOptionsModal['props']['context'];
  initialFormat: ExportFormat;
  next: (result: ExportOptionsResult) => void;
} | null>(null);

function openOptionsModal(
  context: ExportOptionsModal['props']['context'],
  initialFormat: ExportFormat,
): Promise<ExportOptionsResult> {
  return new Promise(resolve => {
    setExportOpts({
      context, initialFormat,
      next: r => { setExportOpts(null); resolve(r); },
    });
  });
}

async function runClipExport(clipId: string, presetFormat: ExportFormat = 'standard') {
  if (!project) return;
  const clip = project.clips.find(c => c.id === clipId);
  if (!clip) return;
  const opts = await openOptionsModal({ kind: 'clip', clip, source: project.sourceVideo }, presetFormat);
  if (!opts.ok || !opts.format) return;
  const suffix = opts.format === 'instagram' ? '_reel' : '';
  const out = await window.reelmagic.chooseExportPath(`${clip.name}${suffix}.mp4`);
  if (!out.ok || !out.path) return;
  const runId = 'r_' + Math.random().toString(36).slice(2, 10);
  startRun(runId);
  const r = await window.reelmagic.exportClip({
    runId, clip, source: project.sourceVideo, outputPath: out.path,
    format: opts.format,
    instagramOutroPath: useSettings.getState().instagramOutroPath,
  });
  setExportResult(r.ok ? { ok: true, outputPath: r.outputPath } : { ok: false, error: r.error });
}

async function runSequenceExport(presetFormat: ExportFormat = 'standard') {
  if (!project) return;
  if (project.sequence.length === 0) return;
  const firstClipId = project.sequence[0]!.clipId;
  const firstClip = project.clips.find(c => c.id === firstClipId);
  const opts = await openOptionsModal({ kind: 'sequence', firstClip, source: project.sourceVideo }, presetFormat);
  if (!opts.ok || !opts.format) return;
  const suffix = opts.format === 'instagram' ? '_reel' : '';
  const out = await window.reelmagic.chooseExportPath(`sequence${suffix}.mp4`);
  if (!out.ok || !out.path) return;
  const runId = 'r_' + Math.random().toString(36).slice(2, 10);
  startRun(runId);
  const r = await window.reelmagic.exportSequence({
    runId, clips: project.clips, sequence: project.sequence,
    source: project.sourceVideo, outputPath: out.path,
    format: opts.format,
    instagramOutroPath: useSettings.getState().instagramOutroPath,
  });
  setExportResult(r.ok ? { ok: true, outputPath: r.outputPath } : { ok: false, error: r.error });
}
```

And mount the modal in the JSX before `<ExportProgressModal />`:

```tsx
{exportOpts && (
  <ExportOptionsModal
    open
    initialFormat={exportOpts.initialFormat}
    context={exportOpts.context}
    onResolve={exportOpts.next}
  />
)}
```

Update the `RightPanel` and `Sequence` props/callsites to pass through the format param (default 'standard'). Existing callers continue to work because the param has a default.

- [ ] **Step 2: Build + dev smoke-test**

Run: `npm run build:renderer && npm run dev`

Click Export on a clip → ExportOptionsModal opens → pick Standard → save dialog → progress modal → standard mp4 produced.

Click Export on a clip → pick Instagram → preview canvas appears → Continue → save dialog (filename has `_reel` suffix) → progress modal → 1080×1920 mp4 produced.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(export-ui): route exports through ExportOptionsModal with format choice"
```

---

### Task 21: Dedicated "Export for Instagram" buttons

**Files:**
- Modify: `src/renderer/components/RightPanel.tsx` and/or `src/renderer/components/ClipDetail.tsx` (whichever renders the clip Export button)
- Modify: `src/renderer/components/Sequence.tsx`

- [ ] **Step 1: Locate the existing Export buttons**

Run: `git grep -nE 'onExport|onExportSequence' src/renderer/components/`

The clip-level Export button is in either `RightPanel.tsx` or a child it renders; the sequence-level button is in `Sequence.tsx`.

- [ ] **Step 2: Add a new "Export for Instagram" button alongside each existing Export button**

Where the existing button calls `onExport(clipId)`, add:

```tsx
<button onClick={() => onExportInstagram(clip.id)}>📸 Reel</button>
```

Extend the prop type:

```ts
interface Props {
  onExport: (clipId: string) => void;
  onExportInstagram: (clipId: string) => void;
}
```

For the sequence panel (`Sequence.tsx`), do the same with `onExportSequence` / `onExportSequenceInstagram`.

- [ ] **Step 3: Wire from App.tsx**

In `App.tsx`, change `<RightPanel onExport={runClipExport} />` to also pass an IG variant:

```tsx
<RightPanel
  onExport={(id) => runClipExport(id, 'standard')}
  onExportInstagram={(id) => runClipExport(id, 'instagram')}
/>
<Sequence
  onExportSequence={() => runSequenceExport('standard')}
  onExportSequenceInstagram={() => runSequenceExport('instagram')}
/>
```

- [ ] **Step 4: Build + smoke**

Run: `npm run build:renderer && npm run dev`

Confirm the new buttons appear and pre-set Instagram in the modal. Confirm the original Export buttons still default to Standard.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/components/RightPanel.tsx src/renderer/components/Sequence.tsx
git commit -m "feat(export-ui): dedicated Export for Instagram buttons"
```

---

### Task 22: InstagramCropOverlay + preview toggle

**Files:**
- Create: `src/renderer/components/InstagramCropOverlay.tsx`
- Modify: `src/renderer/components/Preview.tsx`

- [ ] **Step 1: Create the overlay component**

`src/renderer/components/InstagramCropOverlay.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import type { Clip, SourceMeta } from '../../shared/types';
import { computeInstagramFraming, IgFramingSample } from '../../shared/instagramFraming';
import { previewClock } from '../state/previewClock';

// Overlay that draws the IG-format crop rectangle on top of the main preview
// with a dim outside region. Coordinates here are SOURCE pixels — the
// containing element is positioned over the preview <video>, which is shown
// at source resolution scaled-to-fit.
export function InstagramCropOverlay(props: {
  clip: Clip;
  source: SourceMeta;
  // The displayed video's pixel size (what the parent renders the <video> at).
  displayWidth: number;
  displayHeight: number;
}) {
  const { clip, source, displayWidth, displayHeight } = props;
  const samplesRef = useRef<IgFramingSample[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    samplesRef.current = computeInstagramFraming(clip, source).samples;
  }, [clip, source]);

  // Drive a 30fps refresh while overlay is visible.
  useEffect(() => {
    let raf = 0;
    function loop() {
      setTick(n => n + 1);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const t = previewClock.currentTime - clip.in;
  const s = sampleFraming(samplesRef.current, t);
  if (!s) return null;

  // Map source-space rect onto the displayed video element.
  const sx = displayWidth / source.width;
  const sy = displayHeight / source.height;
  const x = (s.cx - s.w / 2) * sx;
  const y = (s.cy - s.h / 2) * sy;
  const w = s.w * sx;
  const h = s.h * sy;

  return (
    <svg
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      width={displayWidth}
      height={displayHeight}
      viewBox={`0 0 ${displayWidth} ${displayHeight}`}
    >
      {/* Dim region outside the crop using a mask. */}
      <defs>
        <mask id="reel-mask">
          <rect x="0" y="0" width={displayWidth} height={displayHeight} fill="white" />
          <rect x={x} y={y} width={w} height={h} fill="black" />
        </mask>
      </defs>
      <rect x="0" y="0" width={displayWidth} height={displayHeight} fill="black" opacity="0.45" mask="url(#reel-mask)" />
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="white" strokeWidth={2} />
      <text x={x + 8} y={y + 18} fill="white" fontSize="12" fontWeight="bold">REEL</text>
    </svg>
  );
}

// Re-uses the same lerp-sampler from InstagramPreviewCanvas. Could be moved
// to instagramFraming.ts as a public helper if it's needed elsewhere; keep it
// duplicated for now to avoid coupling the framing module to UI concerns.
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
```

- [ ] **Step 2: Mount the overlay in `Preview.tsx` behind a toggle**

In `src/renderer/components/Preview.tsx`:

1. Add a local `useState<boolean>(false)` for `showReelFrame`.
2. Add a button to the preview chrome:

```tsx
<button onClick={() => setShowReelFrame(v => !v)} title="Show 9:16 Reel framing">
  {showReelFrame ? '◻ Hide Reel frame' : '▭ Show Reel frame'}
</button>
```

3. Wrap the `<video>` element in a positioned div, and (when `showReelFrame` and a current clip is selected) render `<InstagramCropOverlay>` over it. The component needs the displayed video element's pixel size — read it via a `ResizeObserver` or `videoEl.getBoundingClientRect()` in a `useLayoutEffect`. (Existing `ZoomRegionOverlay` is a working reference — match the same coordinate-scale approach.)

- [ ] **Step 3: Build + smoke**

Run: `npm run build:renderer && npm run dev`

Open a project, load a clip with a tracked focus marker. Toggle "Show Reel frame" → a 9:16 rectangle appears, follows the player as you scrub. Open the export modal → the canvas in the modal frames the same content as the rectangle on the main preview.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/InstagramCropOverlay.tsx src/renderer/components/Preview.tsx
git commit -m "feat(preview): InstagramCropOverlay with toggle"
```

---

## Phase 6: Integration tests + smoke checklist

### Task 23: Integration test — exportClipInstagram

**Files:**
- Create: `tests/integration/exportClipInstagram.test.ts`

- [ ] **Step 1: Write integration tests**

`tests/integration/exportClipInstagram.test.ts`:

```ts
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exportClip } from '../../src/main/ffmpeg/exporter';
import { probeVideo } from '../../src/main/ffmpeg/probe';
import { INSTAGRAM_REEL_WIDTH, INSTAGRAM_REEL_HEIGHT } from '../../src/shared/instagramFormat';

jest.setTimeout(120000);

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'test-pattern.mp4');

test('exportClip in instagram format produces a 1080x1920 file', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-ig-${Date.now()}.mp4`);
  const r = await exportClip({
    runId: 'tig1',
    clip: {
      id: 'c1', name: 'A', in: 1, out: 3, speed: 1,
      zoom: { x: 0, y: 0, width: source.width, height: source.height },
      focusMarkers: [{
        id: 'm1', x: 40, y: 40, width: 80, height: 80,
        in: 1, out: 3, color: 'yellow',
        path: [
          { t: 0, cx: source.width * 0.3, cy: source.height * 0.5 },
          { t: 2, cx: source.width * 0.7, cy: source.height * 0.5 },
        ],
      }],
    },
    source,
    outputPath: out,
    format: 'instagram',
  });
  expect(r.ok).toBe(true);
  expect(fs.existsSync(out)).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(INSTAGRAM_REEL_WIDTH);
  expect(probed.height).toBe(INSTAGRAM_REEL_HEIGHT);
  expect(probed.duration).toBeGreaterThan(1.5);
  expect(probed.duration).toBeLessThan(2.5);
  fs.unlinkSync(out);
});

test('exportClip in instagram format with no focus marker uses focus-box centre fallback', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-ig-fb-${Date.now()}.mp4`);
  const r = await exportClip({
    runId: 'tig2',
    clip: {
      id: 'c1', name: 'A', in: 1, out: 3, speed: 1,
      zoom: { x: 0, y: 0, width: source.width, height: source.height },
      focusMarkers: [],
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

test('exportClip in instagram format falls back to standard outro letterboxed when IG outro file is missing', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-ig-missingoutro-${Date.now()}.mp4`);
  const r = await exportClip({
    runId: 'tig3',
    clip: {
      id: 'c1', name: 'A', in: 1, out: 2, speed: 1,
      zoom: { x: 0, y: 0, width: source.width, height: source.height },
      focusMarkers: [],
    },
    source,
    outputPath: out,
    format: 'instagram',
    outro: { path: FIXTURE }, // pretend the standard outro is the fixture itself
    instagramOutroPath: '/path/that/does/not/exist.mp4',
  });
  expect(r.ok).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(INSTAGRAM_REEL_WIDTH);
  expect(probed.height).toBe(INSTAGRAM_REEL_HEIGHT);
  // 1s clip + standard outro (~5s for the test pattern, depending on fixture).
  expect(probed.duration).toBeGreaterThan(1);
  fs.unlinkSync(out);
});
```

- [ ] **Step 2: Run integration tests**

Run: `npm run test:integration -- tests/integration/exportClipInstagram.test.ts`
Expected: PASS (each test renders a small fixture clip via real ffmpeg; should complete within the 120s timeout per test).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/exportClipInstagram.test.ts
git commit -m "test(integration): exportClip in instagram format"
```

---

### Task 24: Integration test — exportSequenceInstagram

**Files:**
- Create: `tests/integration/exportSequenceInstagram.test.ts`

- [ ] **Step 1: Write integration test**

`tests/integration/exportSequenceInstagram.test.ts`:

```ts
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exportSequence } from '../../src/main/ffmpeg/exporter';
import { probeVideo } from '../../src/main/ffmpeg/probe';
import { INSTAGRAM_REEL_WIDTH, INSTAGRAM_REEL_HEIGHT } from '../../src/shared/instagramFormat';

jest.setTimeout(180000);

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'test-pattern.mp4');

test('exportSequence in instagram format concatenates a tracked clip and an untracked clip', async () => {
  const source = await probeVideo(FIXTURE);
  const out = path.join(os.tmpdir(), `rm-test-igseq-${Date.now()}.mp4`);
  const r = await exportSequence({
    runId: 'tigs1',
    clips: [
      {
        id: 'c1', name: 'tracked', in: 1, out: 2, speed: 1,
        zoom: { x: 0, y: 0, width: source.width, height: source.height },
        focusMarkers: [{
          id: 'm1', x: 40, y: 40, width: 80, height: 80, in: 1, out: 2, color: 'yellow',
          path: [
            { t: 0, cx: source.width * 0.4, cy: source.height * 0.5 },
            { t: 1, cx: source.width * 0.6, cy: source.height * 0.5 },
          ],
        }],
      },
      {
        id: 'c2', name: 'untracked', in: 1, out: 2, speed: 1,
        zoom: { x: 0, y: 0, width: source.width, height: source.height },
        focusMarkers: [],
      },
    ],
    sequence: [{ clipId: 'c1' }, { clipId: 'c2' }],
    source,
    outputPath: out,
    format: 'instagram',
  });
  expect(r.ok).toBe(true);
  expect(fs.existsSync(out)).toBe(true);
  const probed = await probeVideo(out);
  expect(probed.width).toBe(INSTAGRAM_REEL_WIDTH);
  expect(probed.height).toBe(INSTAGRAM_REEL_HEIGHT);
  // ~2s total (1s + 1s).
  expect(probed.duration).toBeGreaterThan(1.5);
  expect(probed.duration).toBeLessThan(3);
  fs.unlinkSync(out);
});
```

- [ ] **Step 2: Run integration test**

Run: `npm run test:integration -- tests/integration/exportSequenceInstagram.test.ts`
Expected: PASS within the 180s timeout.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/exportSequenceInstagram.test.ts
git commit -m "test(integration): exportSequence in instagram format"
```

---

### Task 25: Smoke checklist update

**Files:**
- Modify: `docs/smoke-checklist.md`

- [ ] **Step 1: Append IG smoke items**

Append a new section to `docs/smoke-checklist.md`:

```markdown
## Instagram export

- [ ] In a project with at least one focus marker that has a recorded path, toggle "Show Reel frame" on the preview. The 9:16 rectangle should follow the marker centre as you scrub and play.
- [ ] Click Export for a tracked clip → ExportOptionsModal opens. Pick Instagram. The driver-summary line should read "Following marker: '<label>' (tracked, <duration>s)". The IG preview canvas should play the cropped output, centred on the marker.
- [ ] Click "Export for Instagram" (the dedicated button) — the modal opens with Instagram pre-selected.
- [ ] Toggle the primary star on a non-first marker — the IG preview's driver summary should update to that marker's label.
- [ ] Save the project, reload it. The primary marker flag persists.
- [ ] Settings → set an Instagram outro file to a missing path. Run an IG export → it should succeed with a warning toast and use the standard outro letterboxed.
- [ ] Run an IG export with no markers on the clip → succeeds; framing is the focus-box centre, static.
```

- [ ] **Step 2: Commit**

```bash
git add docs/smoke-checklist.md
git commit -m "docs: add IG export smoke checklist items"
```

---

## Plan complete

Run the full test suite to confirm everything is green:

```bash
npm test && npm run test:integration
```

Then run through the smoke checklist manually to verify the UI flows.
