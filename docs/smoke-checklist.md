# Smoke Checklist

Run before each release.

## Setup
- [ ] `npm install` succeeds.
- [ ] `npm test` passes (unit tests).
- [ ] `npm run test:integration` passes.

## Manual flow
- [ ] Launch with `npm run dev`.
- [ ] Click "Open video…" and pick an `.mp4`. Confirm preview plays.
- [ ] Drag on timeline to select 2–3 seconds. Click "Add Clip".
- [ ] Add a second clip a few seconds later.
- [ ] Select the second clip. Slow to 0.5×. Confirm preview plays slower and audio is muted.
- [ ] Click "Set zoom region". Drag a rectangle. Confirm preview now shows zoomed view.
- [ ] Click "Reset zoom". Confirm full frame returns.
- [ ] Click "Duplicate" on the second clip. Confirm new "(copy)" clip appears.
- [ ] Drag the original second clip into Sequence, then drag the duplicate. Reorder. Click "Play sequence".
- [ ] Click "Export clip…" on the duplicate. Pick output. Confirm progress reaches 100% and file plays.
- [ ] Click "Export sequence". Pick output. Confirm output is concatenation of all sequence entries.
- [ ] Save Project. Quit app. Reopen. Open Project. Confirm state is restored.
- [ ] Move source `.mp4` to a different location. Open Project. Confirm relink prompt.
- [ ] Cancel an export mid-run. Confirm modal closes and no partial output remains.

## Nudge controls

- [ ] Open a clip. Press `,` and `.` repeatedly. Playhead advances/retreats by ~1 frame each press, clamped at clip in/out.
- [ ] Press `Shift+,` and `Shift+.`. Playhead moves by 1 second each press, clamped at clip in/out.
- [ ] Click the new buttons (`−1s`, `◀`, `▶`, `+1s`) under the preview. Playhead moves by the matching amount.
- [ ] Existing `←` / `→` still skip by `skipSeconds`.

## Pre-click nudge in track mode

- [ ] Find or create a clip whose tracked player isn't visible at `clip.in`.
- [ ] Add a focus marker. Click "Track". Confirm phase = `waiting-start` and the nudge button row appears under the status bar.
- [ ] Press `.` / `Shift+.` / `→` (or click corresponding buttons) until the player is in frame.
- [ ] Left-click on the player. Confirm playback starts at `trackingPlaybackRate` and the nudge row disappears.
- [ ] Mouse-follow the player. Left-click again to stop. Confirm `marker.in` is at the nudged source-time (the marker is invisible before that, then animates).
- [ ] Save the project. Reload it. Confirm `marker.in` is preserved.

## Instagram export

- [ ] In a project with at least one focus marker that has a recorded path, toggle "Reel" on the preview chrome. The 9:16 white rectangle should follow the marker centre as you scrub and play.
- [ ] Click Export clip… for a tracked clip → ExportOptionsModal opens. Pick Instagram. The driver-summary line should read "Following marker: '<label>' (tracked, <duration>s)". The IG preview canvas should play the cropped output, centred on the marker.
- [ ] Click 📸 Reel… (the dedicated button) — the modal opens with Instagram pre-selected.
- [ ] Toggle the primary star on a non-first marker — open the IG export modal again and confirm the driver summary updates to that marker's label.
- [ ] Save the project, reload it. The primary marker flag persists.
- [ ] Settings → set an Instagram outro file to a missing path. Run an IG export → it should succeed (with the standard outro letterboxed if one is set, else single-pass IG render).
- [ ] Run an IG export with no markers on the clip → succeeds; framing is the focus-box centre, static.
- [ ] Verify the IG output file is 1080×1920 (right-click → Properties on Windows, or `ffprobe`).
