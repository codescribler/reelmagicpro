# Reel Framing — Design

**Date:** 2026-06-03
**Status:** Approved (design); pending implementation plan

## Problem

Today the Instagram (9:16) reel crop is *derived* from a clip's focus marker: the
crop **centre** comes from the marker's mouse-tracked path, and the crop **size**
comes from `marker.height × 2.5`. That derived size produces an unpredictable
("odd") crop and couples reel framing to the highlight-marker feature.

We want **direct, what-you-see-is-what-you-get reel framing**: the user drags a
reel-shaped box over the normal landscape preview and pans it left/right through
the clip (using the same mouse-tracking mechanism as the existing marker
tracker), deciding exactly what stays in frame and what is cropped.

## Geometry (fixed — no zoom control)

For each clip the reel output is built as:

1. Take a **full-height, square slice** of the source: `srcH × srcH`, at
   horizontal centre `x(t)`. Vertical position is always centred (full source
   height is always kept; the video is never cropped top or bottom).
2. Scale that square to the reel width → `1080 × 1080`.
3. Centre it in the `1080 × 1920` reel canvas → **black bars top and bottom**
   (~420 px each for a 16:9 source).

Properties:

- **What you see is what comes out.** The on-screen box *is* the reel frame; the
  source under the box is rendered, the area above/below the source becomes black
  bars.
- **No zoom knob.** The slice size is dictated entirely by the reel aspect ratio
  and the source height — the user never chooses a size.
- **Resolution-independent.** Because the slice is defined by the source's own
  height (`srcH × srcH`), the result is visually consistent across 1080p, 4K,
  etc. For standard 16:9 1080p footage the box is `1080 px` wide in source pixels,
  i.e. a literal 1:1 (no-scaling) crop.
- **Pan is horizontal only.** The box is taller than the (landscape) source, so
  vertical movement cannot reveal more detail; vertical is locked to centre and
  the user pans left/right to follow the action.

On the preview the box is a 9:16 rectangle whose top and bottom spill beyond the
video frame (matching "you can't see the top and bottom of the box when
centred"), and whose width is narrower than the video so it slides left/right.

## Data Model (Approach C — replace marker-derived framing)

New field on `Clip`:

```ts
export interface ReelPanPoint {
  t: number;   // clip-relative seconds (0 = clip.in)
  cx: number;  // box centre x in source pixels
}

export interface ReelFraming {
  panPath: ReelPanPoint[]; // sorted by t ascending; cy is always source centre
}

// added to Clip:
//   reelFraming?: ReelFraming;
```

Removed / changed:

- **Remove** the marker-derived reel framing: `pickDrivingMarker` and the
  `marker.height × paddingFactor` sizing logic in `instagramFraming.ts`. The
  framing pipeline no longer reads focus markers at all.
- The `FocusMarker.primary` flag stays *readable* for back-compat when loading
  old projects, but is **ignored** by framing.
- **Focus markers remain unchanged as on-screen highlight boxes.** Their drawbox
  rendering in both standard and Instagram export is untouched; only their
  framing role is removed.

Defaults & back-compat:

- **Un-framed clips** (no `reelFraming`) export with a *static, centred* square
  band — no panning. Reels work before any framing is done.
- **Existing saved projects' reels will render differently** — they switch from
  the old marker-zoom crop to this centred letterbox until re-framed. This is the
  accepted trade-off of replacing the old behaviour (Approach C).

## Interaction — `ReelFrameOverlay`

A new component, sibling of `TrackMarkerOverlay`, reusing its proven mechanism.

- A **"Frame reel"** button in the clip editor enters a new `frame-reel` preview
  mode. The video seeks to `clip.in`, paused, playback rate set to the configured
  tracking rate.
- A tall 9:16 reel box follows the cursor's **X** position, vertically centred.
  The black-bar zones (above/below the source) are shaded so the user sees what
  is cropped vs. kept.
- **First click**: record a starting pan point at the cursor X, set playback to
  `trackingPlaybackRate` (default 0.5×), start a `requestAnimationFrame` loop that
  samples cursor X against the current video time each frame (catches the
  "holding still while following" case).
- **Second click, or playback reaching `clip.out`**: stop the loop, smooth and
  decimate the path (reusing `smoothPath` / `decimatePath`), save it to
  `clip.reelFraming`, return to clip mode, and auto-replay so the user sees the
  result.
- A **"Clear framing"** action removes `reelFraming` and reverts the clip to the
  centred default.
- Nudge controls (frame/second stepping) are available during the
  waiting-to-start phase, mirroring the marker tracker, so the user can advance to
  a good starting frame before the first click.

## Preview & Export

- **Preview:** `InstagramPreviewCanvas` / `InstagramCropOverlay` update to render
  the new letterbox (square band + black bars) and show the box panning along the
  saved path during clip playback.
- **Export (`command.ts`):** the Instagram filter chain becomes:

  ```
  crop = srcH : srcH : x(t) : 0      # full-height (cropH = srcH) square slice; y=0
  scale = 1080 : 1080
  pad   = 1080 : 1920 : 0 : 420 : black   # (1920-1080)/2 = 420
  ```

  where `x(t)` is a piecewise-linear ffmpeg expression built from the (thinned)
  pan path — the same thinning/expression approach already used for marker paths,
  keeping the command line within OS argv limits. For un-framed clips, `x(t)` is
  the constant centred value `(srcW - srcH)/2`.
- **Standard (non-reel) export is untouched.** Focus-marker highlight drawing is
  untouched in both paths.
- Vertical centring clamps so the square slice stays within the source for any
  aspect ratio; horizontal centre `x(t)` is clamped to `[0, srcW - srcH]`.

## Edge Cases

- **Source narrower than tall slice** (`srcW < srcH`, i.e. portrait/near-square
  source): the square slice would exceed source width; clamp slice width to
  `srcW` and pan range collapses to centred. (Rare for football footage.)
- **Source height ≠ 1080**: handled by the square-slice rule; bars scale
  proportionally.
- **Very short pan path / single sample**: treated as a static centred-on-that-x
  framing.

## Testing

- **Unit:**
  - Square-band geometry: pan path → crop expression (`x(t)`), including thinning
    and clamping to `[0, srcW - srcH]`.
  - Default centred case (no `reelFraming`).
  - Schema round-trip for `reelFraming` (save/load, and old-project load with no
    field and with a legacy `primary` marker).
- **Integration:**
  - Instagram clip export with a pan path.
  - Instagram sequence export where clips have pan paths.

## Affected Files (anticipated)

- `src/shared/types.ts` — add `ReelPanPoint`, `ReelFraming`, `Clip.reelFraming`.
- `src/shared/instagramFraming.ts` — replace marker-derived logic with reel-path
  geometry (square band + pan path).
- `src/main/ffmpeg/command.ts` — new Instagram filter chain.
- `src/main/ffmpeg/exporter.ts` — wiring for the new framing source.
- `src/main/project/schema.ts` — validate/serialise `reelFraming`.
- `src/renderer/state/projectStore.ts` — `frame-reel` preview mode + actions to
  set/clear `reelFraming`.
- `src/renderer/components/ReelFrameOverlay.tsx` — new overlay component.
- `src/renderer/components/Preview.tsx` — mount the overlay in `frame-reel` mode.
- `src/renderer/components/ClipEditor.tsx` — "Frame reel" / "Clear framing"
  buttons.
- `src/renderer/components/InstagramPreviewCanvas.tsx` /
  `InstagramCropOverlay.tsx` — render the letterbox + pan path.
- Tests under `tests/unit` and `tests/integration`.
