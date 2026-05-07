# Instagram Export — Design

Date: 2026-05-07
Status: Draft (awaiting user review before plan)

## Goal

Add an "Instagram (9:16) export" alongside the existing standard export. The Instagram output should automatically reframe each clip so the focus player stays in shot — panning and zooming the crop window over time — and offer a preview before export so the framing can be verified without round-tripping through ffmpeg.

The existing standard export must remain bit-for-bit unchanged.

## Scope (v1)

- One Instagram format: **Reels / Stories** at 1080×1920 (9:16). Square (1:1) and Portrait (4:5) deferred.
- Tracking is driven by the clip's existing focus markers — no new tracking layer, no computer vision.
- Smoothing is automatic (no user-facing tuning slider in v1).
- Manual per-clip override of IG framing is **out of scope** for v1; if auto-tracking is wrong, fix the marker path.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | IG framing is driven by the clip's focus marker motion path | Reuses existing player tracking; no duplicated authoring effort |
| 2 | Multi-marker clips: a `primary: true` flag picks the driving marker; falls back to the first marker if none flagged | Predictable, opt-in, backwards-compatible |
| 3 | Crop window panning **and** size are dynamic, both Gaussian-smoothed | Player stays prominently framed regardless of distance from camera; smoothing prevents jitter |
| 4 | Reels-only at launch (9:16, 1080×1920) | Dominant format for football short-form content; other aspects can be added later by adding presets |
| 5 | Preview is **both** a crop-rectangle overlay on the main preview and a side-by-side cropped canvas in the export modal | Overlay shows framing in context; canvas shows what IG will actually look like |
| 6 | IG export is reachable from **both** dedicated "Export for Instagram" buttons and a `Format` toggle in the existing export modal | Quick access for the common case; modal toggle for explicit control |
| 7 | Focus markers are drawn on IG output using the same drawing logic as standard export | Parity, simplest mental model. Note: markers whose source-pixel rect falls outside the IG crop window are naturally not visible in the IG output; that's a property of cropping, not a special-case. |
| 8 | Outros: letterbox the existing outro to 9:16 by default; allow an optional 9:16 outro file in settings to override | Sensible default with no extra setup; clean result for users with a portrait outro |

## Architecture

### Pipeline (Approach 1: extension stage)

The existing pipeline is preserved unchanged. The IG pipeline adds an extra crop+scale stage at the end, before watermarking:

```
Standard:
  [0:v] → crop(zoom) → scale(srcW:srcH) → markers → watermark → setpts → [v]

Instagram:
  [0:v] → crop(zoom) → scale(srcW:srcH) → markers
        → crop(igX(t), igY(t), igW(t), igH(t))   // smoothed, time-varying
        → scale(1080:1920)
        → watermark (positioned for portrait)
        → setpts → [v]
```

Justification: minimum disruption, all existing helpers reused, no risk to the standard pipeline. The crop expressions use the existing `piecewiseExpr` helper — `crop` re-evaluates per frame (unlike `drawbox`), so time-varying expressions work directly.

### New shared module

`src/shared/instagramFraming.ts` — pure function consumed by both renderer (preview) and main (ffmpeg builder), so preview and final render cannot disagree.

```ts
interface IgFramingOpts {
  paddingFactor?: number;       // default 2.5 — crop height = marker height × this
  minHeightFraction?: number;   // default 0.30 — crop never smaller than 30% of source height
  smoothingSigmaSeconds?: number; // default 0.5 — Gaussian σ
  defaultZoomFraction?: number; // default 0.70 — used when no marker
  targetAspect?: number;        // default 9/16
}

interface IgFramingSample {
  t: number;   // clip-relative seconds
  cx: number;  // centre x in SOURCE pixels (same coordinate space as marker.x/y)
  cy: number;  // centre y in source pixels
  w: number;   // crop width in source pixels
  h: number;   // crop height in source pixels
}

function computeInstagramFraming(
  clip: Clip,
  source: SourceMeta,
  opts?: IgFramingOpts,
): { samples: IgFramingSample[]; driverMarkerId: string | null };
```

Steps inside:
1. Pick the **driving marker**: marker with `primary: true`, else first marker, else `null`.
2. Build the **raw centre series** from the marker's `path` (or static centre, or zoom-box centre when no marker).
3. Build the **raw size series**: crop height = `clamp(marker.height × paddingFactor, source.height × minHeightFraction, source.height)`. Crop width = `crop height × targetAspect`, clamped to source width.
4. **Gaussian-smooth** all four series (cx, cy, w, h) with σ ≈ `smoothingSigmaSeconds` at the path's sample rate. Symmetric Gaussian (looks ahead and behind) — viable because the full path is known offline.
5. **Clamp** each frame so the crop rect fits inside the source: `igX = clamp(cx - w/2, 0, source.width - w)`; similarly for y. Smoothing → clamping order is intentional: eased trajectory in unconstrained space, then trimmed at edges.
6. Thin to ≤ 40 segments for compact ffmpeg expressions.

**Coordinate-space convention.** The framing samples are stored in **source pixel coordinates** — the same space `FocusMarker.x/y` and `FocusMarkerPathPoint.cx/cy` use. Consumers convert when they need a different space:
- The **ffmpeg builder** maps source-space framing into post-zoom space the same way `buildMarkerFilters` already maps marker coords: `post = (src - z.{x,y}) × source.{w,h} / z.{width,height}`. The IG `crop` filter runs in post-zoom space (after the existing `crop(zoom) → scale(srcW:srcH)` stage).
- The **preview canvas** uses source-space coordinates directly with `drawImage(video, src_x, src_y, src_w, src_h, 0, 0, canvasW, canvasH)`. This naturally bakes in the clip's zoom (the source-space crop rect is the zoom-restricted IG framing as it lives in the source frame).

### Schema changes

```ts
// src/shared/types.ts
interface FocusMarker {
  // ...existing fields...
  primary?: boolean; // optional; only one per clip
}

// settings.ts (renderer)
interface Settings {
  // ...existing fields...
  instagramOutroPath?: string;
}
```

Both fields are optional — existing project files and settings load without warnings.

### FFmpeg builder

New function `buildInstagramClipFfmpegArgs(clip, source, framingSamples, outputPath)` in `src/main/ffmpeg/command.ts`. Reuses:
- Existing `buildMarkerFilters` (markers are drawn at source resolution before the IG crop).
- `piecewiseExpr` for time-varying crop coordinates.
- A new `instagramWatermarkFilter(width, height)` that calculates watermark size/position from the IG canvas dimensions (1080×1920). To keep the watermark visually consistent with standard exports (where the canvas is landscape), the font size is scaled against the **shorter** canvas dimension: `fontSize = max(14, min(width, height) × 0.022)`. So a 1080×1920 IG canvas yields ~24px (matching a 1920×1080 standard output), rather than ~42px if scaled against height. `x = width × 0.1`, `y = max(12, min(width, height) × 0.02)` for the same reason.

Standard `buildClipFfmpegArgs` is unchanged. The IG builder is invoked only when the export `format === 'instagram'`.

### Outro

`buildInstagramOutroFfmpegArgs(outroPath, outputPath, hasAudio, target = { width: 1080, height: 1920 })` — same as existing `buildOutroFfmpegArgs`, but the scale/pad target dimensions are 1080×1920. Used for both the letterboxed-standard-outro path and the dedicated 9:16 outro path.

Outro resolution rules at IG export time:
1. If `instagramOutroPath` is set and the file exists, use it. Probed for duration/audio as today.
2. Else if a standard outro is set, use that file but render it through `buildInstagramOutroFfmpegArgs` (letterboxed).
3. Else no outro stage runs (single-pass).

If `instagramOutroPath` is set but the file is missing/unprobeable, fall back to (2) and emit a warning toast: *"Instagram outro file not found — using standard outro letterboxed."*

### IPC

The existing `ExportClipArgs` and `ExportSequenceArgs` gain an optional `format?: 'standard' | 'instagram'` (defaulting to `'standard'`). The main process branches on this to invoke `buildInstagramClipFfmpegArgs` and the IG outro path. No new IPC channels.

## UI

### Three surfaces change

**1. Dedicated "Export for Instagram" buttons**
- Clip detail panel: next to existing per-clip Export.
- Sequence panel: next to existing Export Sequence.
- These open the existing export modal with `format` pre-set to `instagram` — they're a shortcut, not a separate flow.

**2. Export modal — `Format` toggle**
- Segmented control: `Standard (16:9)` / `Instagram (9:16)`.
- When `Instagram` selected:
  - The **IG preview canvas** appears (Section 4 below).
  - A read-only **driver summary** line: e.g. *"Following marker: 'Player 7' (tracked, 3.4s)"* or *"No focus marker — using focus box centre"* (warning style for the no-marker case).
  - The save-dialog default filename is suffixed `_reel`.
- When `Standard` selected, the modal looks exactly like today.

**3. Primary marker toggle**
- A small **star icon** on each focus marker in `ClipFocusMarkers` and the marker list.
- Click toggles `primary: true`. Only one primary per clip — flagging another clears the previous.
- Star rendered:
  - **filled** → explicit primary
  - **half-faded** → implicit fallback (first marker, no explicit primary set)
  - **outline** → not primary

### Preview

**A. Crop rectangle overlay (in main `Preview`)**

A new `InstagramCropOverlay` component, modelled on `ZoomRegionOverlay`. Toggled by a "Show Reel frame" button on the preview chrome (off by default).

- Reads `previewClock` and computes the crop rect via `computeInstagramFraming` for the current clip.
- Draws a **white 9:16 rectangle** with semi-transparent dimming outside it, plus a "REEL" badge in the top corner.

**B. Live cropped IG preview canvas (in export modal)**

- A `<canvas>` rendered at small 9:16 (e.g. 270×480 px on screen) inside the export modal when `format === 'instagram'`.
- A hidden `<video>` element shares the source URL and is kept in sync with `previewClock` (same `currentTime`, `playbackRate`, play/pause state as the main preview).
- On each `requestAnimationFrame`, the canvas calls `drawImage(video, igX, igY, igW, igH, 0, 0, canvasW, canvasH)` using the smoothed crop computed for the current time.
- Small play/pause + scrub control above the canvas.
- The canvas does **not** render watermark or markers. A note under the canvas: *"Watermark and markers will appear on export."*

A and B share `computeInstagramFraming` — they cannot disagree.

### Settings

`SettingsModal` gains a new row: **"Instagram outro (9:16)"** with the same UI pattern as the existing outro field (path display + Browse + Clear). Help text: *"Optional. If unset, the standard outro is rescaled with black bars."*

## Edge cases & fallbacks

| Situation | Behaviour |
|---|---|
| Clip has no focus markers | Use focus-box centre as IG crop centre; size = `defaultZoomFraction × source.height`. Modal warns: *"No focus marker — using focus box centre. Tracking will be static."* |
| Marker has no path (static rect) | Use marker static centre and size; no panning, no smoothing. |
| Marker path starts after `clip.in` or ends before `clip.out` | Clamp: hold first/last sample value before/after path range (matches existing `piecewiseExpr` behaviour). |
| Crop rect wider/taller than source at any frame | Clamp size down so it fits inside source. |
| Crop rect outside source bounds | Clamp `igX`/`igY` after smoothing — eased path in unconstrained space, trimmed at edges. |
| IG outro file missing at export time | Fall back to letterboxed standard outro; warning toast. |
| No outro at all | Existing single-pass behaviour, IG filter chain. |
| Sequence has mixed marker availability | Each clip is rendered independently with its own framing fallback; sequence concatenates as today. |
| User cancels mid-export | Existing AbortSignal flow — no change. |
| Settings has corrupt `instagramOutroPath` | Show the path with a "(file not found)" suffix; user can clear or re-pick. |

## Testing

### Unit (Jest, fast — `npm test`)

- `tests/unit/instagramFraming.test.ts` (new)
  - Marker with smooth path → smoothed centres within tolerance of input; no endpoint overshoot.
  - Marker near source edge → crop clamps to bounds; cx/cy continuous (no jumps).
  - Marker box larger than source / smaller than minimum → size clamps.
  - No marker → falls back to focus-box centre with default size.
  - Path length 0 / 1 → static result, no NaNs.
  - Multi-marker, `primary: true` set → that marker is chosen; no primary → first marker chosen.

- `tests/unit/command.test.ts` (extend)
  - `buildInstagramClipFfmpegArgs` snapshot for representative clip.
  - Watermark moves to post-IG-crop only on IG chain; standard chain unchanged (regression guard).
  - Existing `buildClipFfmpegArgs` snapshot for a fixture project is byte-identical (regression guard).

- `tests/unit/schema.test.ts` (extend)
  - `primary?: boolean` round-trips; absent by default.
  - Pre-existing project files load without warnings.

### Integration (slower, real ffmpeg)

- `tests/integration/exportClipInstagram.test.ts` (new)
  - Tracked-marker fixture clip → output is 1080×1920, duration matches, ffprobe confirms aspect.
  - With `instagramOutroPath` set → output ends with the 9:16 outro frame.
  - With `instagramOutroPath` set to a missing file → falls back to letterboxed standard outro; render succeeds.

- `tests/integration/exportSequenceInstagram.test.ts` (new)
  - Mixed sequence (one tracked, one untracked) renders correct concatenated 9:16 file.

### Manual / smoke checklist additions

- IG preview canvas updates as you scrub through a tracked clip.
- Crop rectangle overlay matches the canvas framing exactly.
- Primary marker star toggle persists across save/reload.

## Out of scope (v1)

- Square (1:1) and Portrait (4:5) feed exports — pipeline is the same shape; adding presets later is mechanical.
- User-tunable smoothing slider.
- Manual per-clip framing override (offset / zoom adjustment).
- Computer-vision player auto-detection.
- Per-marker keyframed Instagram-only path separate from the highlight marker path.

## Open follow-ups (note for after v1 lands)

- Watch for cases where Gaussian σ = 0.5s feels too laggy (path that snaps fast) or too jumpy (path with sparse samples) — the constant is a single point of tuning if real footage indicates a different default works better.
- Reconsider whether the IG canvas should also render markers/watermark once we see how users use it; the *"will appear on export"* note may not be enough.
