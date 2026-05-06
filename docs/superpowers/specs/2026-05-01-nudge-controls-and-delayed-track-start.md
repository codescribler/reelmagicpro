# Nudge Controls and Pre-Click Nudging in Track Mode — Design

**Date:** 2026-05-01 (revised after code exploration)
**Status:** Revised draft (awaiting written-spec re-review)
**Extends:** `docs/superpowers/specs/2026-04-28-reelmagic-video-editor-design.md`

## Purpose

Solve the "player not visible at the in-point" friction in the focus-marker tracking workflow. Today, when the user enters track-marker mode, the video seeks to `clip.in` and they must left-click immediately to start tracking. If the player isn't yet in frame at `clip.in`, the user has nothing to click on. This spec adds:

1. Finer-grained playhead nudging (frame, 1-second) on top of the existing configurable `skipSeconds`.
2. Allowing those nudge controls to work in track-marker mode during the `waiting-start` phase, so the user can advance to the frame where the player is visible before clicking.

The existing tracking interaction is otherwise untouched. The marker's `in` time is already set to the source-time of the user's first click (`TrackMarkerOverlay.stopAndSave`: `newIn = clip.in + path[0].t`). Once the user can nudge before clicking, *the tracking-start time naturally lands on the nudged frame.*

## In Scope

- New keyboard shortcuts for ±1 frame and ±1 second.
- Matching new UI buttons under the source preview.
- Existing `←` / `→` shortcuts (configurable `skipSeconds`) preserved unchanged.
- Nudging works in track-marker mode during the `waiting-start` phase only. Once recording starts (after the first click), all nudge inputs are ignored.
- Nudge controls also work in clip, place-focus, and source modes (where `←` / `→` already work for `±skipSeconds`).

## Out of Scope

- Changes to the data model, the tracking export pipeline, or the tracking interaction itself.
- Rewinding within a tracking session after recording has begun.
- Variable-speed nudge (hold-to-advance, scrub wheel).
- Frame thumbnails on the timeline.
- User-rebindable shortcuts.

## User-Facing Behaviour

### Keyboard shortcuts

| Action | Keyboard | Notes |
|---|---|---|
| Skip backward N seconds | `←` | Existing. N = configured `skipSeconds`, default 5. |
| Skip forward N seconds | `→` | Existing. |
| Step backward 1 second | `Shift+,` (`<`) | New. |
| Step forward 1 second | `Shift+.` (`>`) | New. |
| Step backward 1 frame | `,` | New. Frame = `1 / source.fps` seconds. |
| Step forward 1 frame | `.` | New. |

Comma and period are the standard video-editor frame-step keys (Final Cut, DaVinci, Premiere). Detection uses `e.code === 'Comma'` / `'Period'` plus `e.shiftKey` so the bindings are unambiguous regardless of keyboard layout.

### UI buttons

A new horizontal row sits with (or beside) the existing `±skipSeconds` overlay buttons in `Preview.tsx`. Left-to-right order:

```
−Ns · −1s · ◀ · ▶ · +1s · +Ns
```

`N` is the configured `skipSeconds`. The existing `−Ns / +Ns` buttons keep their current behaviour and position; the four new buttons (`−1s`, `◀`, `▶`, `+1s`) sit alongside.

The row is hidden in `set-zoom` and `place-focus` modes (existing behaviour). In `track-marker` mode, the row is hidden during `recording` and `done` phases, but shown during `waiting-start`.

### Track-marker mode

Today's flow (unchanged in steps 1, 3, 4):

1. User presses Track. Phase becomes `waiting-start`. Video seeks to `clip.in`, paused, with `playbackRate` set to `trackingPlaybackRate` (default 0.5×).
2. **(NEW)** During `waiting-start`, the user may use any of the six nudge controls (keyboard or UI) to advance or rewind the playhead within `[clip.in, clip.out]`.
3. User left-clicks over the player. First path sample is recorded at `t = currentTime − clip.in`. Phase becomes `recording`. Playback starts.
4. User left-clicks again, or playback reaches `clip.out`. Phase becomes `done`. Path is smoothed, decimated, and saved on the marker; `marker.in = clip.in + path[0].t` and `marker.out = clip.in + path[path.length-1].t`.

If the user does not nudge before left-clicking, behaviour is identical to today: `path[0].t == 0`, so `marker.in == clip.in`.

During `recording` and `done`, the global keyboard handler in `App.tsx` continues to bail out (its existing behaviour for `track-marker` mode), and the UI nudge row is hidden.

## Implementation Notes

These are informational; the plan resolves them with concrete tasks.

### Where the new keyboard handling lives

Two viable options for the plan to pick:

- **Option A:** keep `App.tsx`'s global keyboard handler authoritative; add the new `,` / `.` and `Shift+,` / `Shift+.` keys; lift the `track-marker` early-return when the active marker overlay is in `waiting-start` phase. Phase needs to be visible to `App.tsx` — either via the project store or by wiring through a ref.
- **Option B (working assumption):** `App.tsx` keeps its existing `track-marker` early-return as-is. `TrackMarkerOverlay` registers its own keyboard handler on mount, active only while `phase === 'waiting-start'`, with the same six nudge bindings. Outside `track-marker` mode, the global handler in `App.tsx` carries the new shortcuts.

Option B is simpler — phase is already local state in `TrackMarkerOverlay`, no store plumbing needed.

### How nudges actually move the video

Existing pattern: `App.tsx` calls `useProjectStore.getState().requestSkip(delta)`, which bumps a token; `Preview.tsx` watches the token and updates `videoRef.current.currentTime` clamped to `[0, sourceDuration]`.

For the new shortcuts, `requestSkip(delta)` is reusable as-is (frame step is just a smaller `delta`). Inside `TrackMarkerOverlay` (Option B), nudges can either go through `requestSkip` or update `video.currentTime` directly via the ref it already holds.

### Where the new buttons render

Two viable placements:

- Extend the existing `±skipSeconds` button container in `Preview.tsx` (lines ~320-338). Visible whenever `!suspendZoom`. Add a separate render path so the row also appears during `track-marker` `waiting-start`.
- Render an independent nudge row inside `TrackMarkerOverlay` for the `waiting-start` phase, mirroring the design of the global row.

The plan picks one; either is small.

## No Data Model Change

The clip schema (`src/shared/types.ts`) is unchanged. The existing `FocusMarker` already carries:

- `in` / `out` — the marker's visibility window in source-time.
- Optional `path: FocusMarkerPathPoint[]` — clip-relative `t`, source-pixel `cx`/`cy`.

Today's tracking flow already sets `marker.in` from the first sample's source-time. With pre-click nudging, that source-time lands on the nudged frame. No new field, no new clamping rule, no project-version bump.

## No Export Pipeline Change

`buildClipFfmpegArgs` (`src/main/ffmpeg/command.ts`) renders animated paths via per-segment `drawbox` stamps with `enable='between(t,segStart,segEnd)'`, where segment times are clip-relative and derived from `path[i].t`. Marker visibility uses `[m.in, m.out]` in source-time during preview, and the same range converted to clip-relative `[m.in - clip.in, m.out - clip.in]` for the export's `enable` expressions. Nothing in this pipeline depends on tracking starting at `clip.in` — the existing logic already handles arbitrary marker `in`/`out`.

## Errors and Edge Cases

| Case | Handling |
|---|---|
| Nudge past `clip.out` (clip / track-marker modes) | Clamp to `clip.out`. Further presses are no-ops. |
| Nudge before `clip.in` (clip / track-marker modes) | Clamp to `clip.in`. |
| Nudge in source mode | Clamp to `[0, source.duration]` — matches existing `requestSkip` clamping in `Preview.tsx`. |
| Source `fps` non-integer (29.97) | Frame delta is `1 / fps` seconds. After applying, snap `currentTime` to the nearest source frame (`Math.round(t * fps) / fps`). |
| User holds `,` or `.` | OS keyboard repeat handles cadence; clamping holds the playhead at boundaries. |
| User presses `,` while typing in a Settings input | Skip — `isTyping()` gate in `App.tsx` (existing). |
| User presses Track again while in `waiting-start` after nudging | Existing behaviour: `TrackMarkerOverlay` re-mounts (new mode), seeks to `clip.in`. Nudge progress is discarded. |
| User clicks a UI nudge button while a focused video element exists | Click handler `e.stopPropagation()` already used by the existing `±skipSeconds` buttons; new buttons follow the same pattern. |

## Testing

- **Unit tests (`tests/unit/`):**
  - Pure-function tests for frame-step delta and snap across fps values 24, 25, 29.97, 30, 60.
  - Clamp helper: `(playhead, delta, lo, hi) → clamp(playhead + delta, lo, hi)` covers the clip / source clamping rules.
- **Integration tests:** none new — no export-pipeline change to verify.
- **Manual smoke checklist additions** (`docs/smoke-checklist.md`):
  - Open a clip whose player isn't visible at `clip.in`. Press Track. Nudge forward (mix of `→`, `Shift+.`, `.`) until the player is in frame. Left-click. Mouse-follow. Left-click to stop. Verify the marker is invisible before the nudged frame and animates from there onward.
  - In clip mode, nudge with each shortcut and each button. Verify clamping at clip in/out.
  - In source mode, nudge across the whole source. Verify clamping at 0 and source duration.

## Open Questions for the Plan Phase

- Pick between Option A (single global keyboard handler with phase-aware gating) and Option B (TrackMarkerOverlay owns its own handler during `waiting-start`). The plan uses Option B unless the implementation surfaces a reason to switch.
- Pick between the two button-rendering placements (extend existing row vs. dedicated row inside `TrackMarkerOverlay`).
- Confirm the new shortcuts bail when no project is open and when typing — both should match existing-shortcut behaviour in `App.tsx`.
