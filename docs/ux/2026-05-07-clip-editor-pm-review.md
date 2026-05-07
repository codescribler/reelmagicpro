# Clip-editor panel PM review — making "track + zoom + slow" obvious

**Date:** 2026-05-07
**Goal of the panel:** the user has a clip and wants to (1) track the player, (2) optionally zoom in, (3) optionally slow it down, then export. The panel today doesn't communicate that ordering or the connection between tracking and zooming.

## The journey today

User has just landed in clip detail. Their actual goal:
1. Track their kid through the clip.
2. Maybe zoom in.
3. Maybe slow it down.
4. Export.

To get there now they have to:

1. Notice "Player tags" header buried below `ClipEditor`. Click "+ Tag a player".
2. Get pushed into track-marker mode automatically (good!) — click the kid → mouse-follow recording starts.
3. Click again to stop recording. Land back in `ClipDetail`.
4. Now what? They see a dense marker card with **10 controls** (colour swatch, primary-star, in/out mini-timeline, shape select, colour select, label input, size ± buttons, "Follow with mouse", "Clear path", "Delete"). None is highlighted as "done — keep going".
5. Scroll up. See "Set focus box" button in `ClipEditor`. They have **no signal** that the focus box auto-follows the player tag they just made — that connection is the magic of the product but it's only mentioned once, in dim 11px text in the *empty* state of player tags (which they no longer see, since they have a tag).
6. Decide whether to set a focus box. Get into the overlay. Draw a rectangle. Confirm.
7. Adjust the speed slider. No reference points — slo-mo could be 0.5× or 0.25×, no help offered.
8. Export.

## Ranked friction

### 1. The panel is a flat heap, not a narrative
The user's goal has three steps in a known order (track → zoom → speed → export). The panel mixes them: name field at top, then speed slider, then a button row that includes both transport (Replay, −Xs, +Xs) and zoom (Set/Reset focus box), then a long block of player tags below. Nothing tells the user "do this, then this." Re-ordered as **1. Track → 2. Zoom → 3. Speed**, each visually distinct, a first-timer can walk down it.

### 2. The "focus box follows the primary tag" magic is invisible
This is the headline value of the app, communicated only by 11px dim text in an empty state that disappears as soon as the user does the thing. Recommendation: add permanent one-line subheads — *"The focus box follows the tagged player wherever they move."* under Zoom, and *"Tag your kid so the focus box can follow them."* under Track. Two sentences, total.

### 3. The marker card has 10 controls; 7 of them are tweaks
For a first-time user with one player, **3 of the 10 matter**: label, "Follow with mouse", Delete. The rest are tweaks. Default-view the essentials, collapse colour/shape/size/in-out range/star behind a "More options ▾" disclosure per marker.

### 4. "Follow with mouse" is the core verb but styled like every other button
It's the action that records the path. It IS what tracking means. Promote to `.primary` once a marker exists with no path; tone it down once a path is recorded.

### 5. The transport buttons are duplicated three times
After the transport-bar work, `ClipEditor` still has `Replay` / `−Xs` / `+Xs`. Same actions on the bottom transport bar; same on arrow keys. Drop `−Xs` / `+Xs` from `ClipEditor`. Keep `Replay` since "from the clip's in-point" is a clip-specific behaviour the transport bar can't do.

### 6. The primary-marker star is clutter when there's one marker
Three opacity states, tech-speak tooltip. With one marker, it's automatically primary; the star contributes nothing but a question mark. Hide it entirely until ≥2 markers. Same pattern as the Sequence-bar disclosure.

### 7. Speed slider has no anchors
The football parent's actual choices are: normal, half-speed, quarter-speed, maybe 2× to skip boring bits. Add a row of preset chips: `0.25×  0.5×  1×  1.5×  2×`. Slider stays for in-between values.

### 8. Marker in/out timeline is a power-user feature in beginner real estate
Default is whole clip, which is what almost everyone wants. Demote behind "More options" with the rest of the tweaks.

### 9. The clip `Name` field is the first thing inside `ClipEditor`
"Clip 1" / "Clip 2" defaults are fine for a first reel. The name being top-of-panel implies it's the most important thing — it isn't. Make the clip name in the detail header click-to-edit instead, removing it from the panel body.

### 10. No "you're done — go export" signal
A passive checklist on the right (✓ Player tagged · ✓ Path recorded · ◯ Focus box · ◯ Speed) costs little and gives a sense of progress. Second-pass nice-to-have, not first PR.

## The 80/20 PR

1. **Restructure the panel as 1. Track → 2. Zoom → 3. Speed**, each as its own labelled section. Move Name into the header (click-to-edit). Drop the duplicated transport buttons.
2. **Collapse the per-marker tweak controls behind "More options"** so the default marker card shows label / "Follow with mouse" (primary) / Delete only.
3. **Add the "focus box follows the primary tag" sentence** in two places, plus speed-preset chips.

Tradeoff: power users currently use the in/out marker timeline and the colour/shape selects. Hiding behind a disclosure adds one click to those flows. Worth it — they're a small minority and one-click-deeper is fine; the default panel becomes drastically easier to read.

## Status (2026-05-07)

- Item 1 (panel restructure): **shipped**
- Item 2 (collapse marker tweaks behind "More options"): **shipped**
- Item 3 (magic-line copy + speed preset chips): **shipped**
- Item 10 (export-readiness checklist): deferred — second-pass.
