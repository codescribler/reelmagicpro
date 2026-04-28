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
