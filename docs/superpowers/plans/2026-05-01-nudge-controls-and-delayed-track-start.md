# Nudge Controls and Pre-Click Nudging in Track Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user advance/rewind the playhead with frame and 1-second granularity (in addition to the existing configurable `skipSeconds`), and allow the same nudge controls to work in track-marker mode during the `waiting-start` phase, so a player who isn't visible at `clip.in` can be brought into frame before the first tracking click.

**Architecture:** A small set of pure utilities (`clampPlayhead`, `frameStepSeconds`, `snapToFrame`, `keyToNudgeDelta`) goes in a new `src/renderer/state/playhead.ts`, fully unit-tested. `App.tsx`'s global keyboard handler gains `,` / `.` / `Shift+,` / `Shift+.` shortcuts via `keyToNudgeDelta`; existing arrow handling is left untouched. `Preview.tsx` extends its existing `±skipSeconds` overlay row with four new buttons, and its `skipRequest` handler clamps to `[clip.in, clip.out]` when an active clip exists. `TrackMarkerOverlay.tsx` registers its own keyboard handler and renders its own button row during the `waiting-start` phase only. No data-model change. No export-pipeline change.

**Tech Stack:** TypeScript, React 18, Zustand store, Jest, Electron renderer.

**Spec:** `docs/superpowers/specs/2026-05-01-nudge-controls-and-delayed-track-start.md`.

---

### Task 1: `clampPlayhead` utility

**Files:**
- Create: `src/renderer/state/playhead.ts`
- Test: `tests/unit/playhead.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/playhead.test.ts`:

```typescript
import { clampPlayhead } from '../../src/renderer/state/playhead';

test('clampPlayhead returns t when within range', () => {
  expect(clampPlayhead(5, 0, 10)).toBe(5);
});

test('clampPlayhead clamps to lo when t is below', () => {
  expect(clampPlayhead(-3, 0, 10)).toBe(0);
});

test('clampPlayhead clamps to hi when t is above', () => {
  expect(clampPlayhead(15, 0, 10)).toBe(10);
});

test('clampPlayhead returns lo when range is inverted (hi < lo)', () => {
  expect(clampPlayhead(5, 10, 0)).toBe(10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- playhead`
Expected: FAIL — module `src/renderer/state/playhead` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/state/playhead.ts`:

```typescript
// Clamp a playhead time `t` into the inclusive range `[lo, hi]`. If the range
// is inverted (`hi < lo`), returns `lo` — this happens transiently during clip
// edits and we'd rather hold at the start than jump past the end.
export function clampPlayhead(t: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, t));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- playhead`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/state/playhead.ts tests/unit/playhead.test.ts
git commit -m "feat(playhead): add clampPlayhead utility with tests"
```

---

### Task 2: `frameStepSeconds` and `snapToFrame` utilities

**Files:**
- Modify: `src/renderer/state/playhead.ts`
- Modify: `tests/unit/playhead.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/playhead.test.ts`:

```typescript
import { frameStepSeconds, snapToFrame } from '../../src/renderer/state/playhead';

test('frameStepSeconds returns 1/30 at 30 fps', () => {
  expect(frameStepSeconds(30)).toBeCloseTo(1 / 30);
});

test('frameStepSeconds handles 29.97 fps', () => {
  expect(frameStepSeconds(29.97)).toBeCloseTo(1 / 29.97);
});

test('frameStepSeconds handles 60 fps', () => {
  expect(frameStepSeconds(60)).toBeCloseTo(1 / 60);
});

test('snapToFrame snaps mid-frame time to nearest frame at 30 fps', () => {
  // 0.04 sits between frame 1 (0.0333…) and frame 2 (0.0666…); snaps to frame 1.
  expect(snapToFrame(0.04, 30)).toBeCloseTo(1 / 30);
});

test('snapToFrame preserves exact frame boundaries at 30 fps', () => {
  expect(snapToFrame(15 / 30, 30)).toBeCloseTo(15 / 30);
});

test('snapToFrame is stable on round-trips at 29.97 fps', () => {
  const fps = 29.97;
  const exact = 10 / fps;
  expect(snapToFrame(exact, fps)).toBeCloseTo(exact);
});
```

Update the existing import line to:
```typescript
import { clampPlayhead, frameStepSeconds, snapToFrame } from '../../src/renderer/state/playhead';
```
(and remove the duplicate import added above).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- playhead`
Expected: FAIL — `frameStepSeconds` and `snapToFrame` not exported.

- [ ] **Step 3: Add the implementations**

Append to `src/renderer/state/playhead.ts`:

```typescript
// Seconds per source frame at the given fps. Used to size the ±frame nudge.
export function frameStepSeconds(fps: number): number {
  return 1 / fps;
}

// Snap a playhead time to the nearest source-frame boundary. Avoids the
// playhead drifting off-grid after several nudges due to floating-point drift.
export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- playhead`
Expected: PASS — all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/state/playhead.ts tests/unit/playhead.test.ts
git commit -m "feat(playhead): add frameStepSeconds and snapToFrame"
```

---

### Task 3: `keyToNudgeDelta` utility

**Files:**
- Modify: `src/renderer/state/playhead.ts`
- Modify: `tests/unit/playhead.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/playhead.test.ts`:

```typescript
import { keyToNudgeDelta, type NudgeKeyEvent } from '../../src/renderer/state/playhead';

const ev = (overrides: Partial<NudgeKeyEvent> = {}): NudgeKeyEvent => ({
  code: '', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
  ...overrides,
});

test('keyToNudgeDelta: Comma without shift -> -1 frame at 30 fps', () => {
  expect(keyToNudgeDelta(ev({ code: 'Comma' }), 30)).toBeCloseTo(-1 / 30);
});

test('keyToNudgeDelta: Period without shift -> +1 frame', () => {
  expect(keyToNudgeDelta(ev({ code: 'Period' }), 30)).toBeCloseTo(1 / 30);
});

test('keyToNudgeDelta: Shift+Comma -> -1 second', () => {
  expect(keyToNudgeDelta(ev({ code: 'Comma', shiftKey: true }), 30)).toBe(-1);
});

test('keyToNudgeDelta: Shift+Period -> +1 second', () => {
  expect(keyToNudgeDelta(ev({ code: 'Period', shiftKey: true }), 30)).toBe(1);
});

test('keyToNudgeDelta: Ctrl+Period -> null (modifier rejects)', () => {
  expect(keyToNudgeDelta(ev({ code: 'Period', ctrlKey: true }), 30)).toBeNull();
});

test('keyToNudgeDelta: Alt+Comma -> null', () => {
  expect(keyToNudgeDelta(ev({ code: 'Comma', altKey: true }), 30)).toBeNull();
});

test('keyToNudgeDelta: Meta+Period -> null', () => {
  expect(keyToNudgeDelta(ev({ code: 'Period', metaKey: true }), 30)).toBeNull();
});

test('keyToNudgeDelta: ArrowLeft -> null (left to existing handler)', () => {
  expect(keyToNudgeDelta(ev({ code: 'ArrowLeft' }), 30)).toBeNull();
});

test('keyToNudgeDelta: KeyA -> null', () => {
  expect(keyToNudgeDelta(ev({ code: 'KeyA' }), 30)).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- playhead`
Expected: FAIL — `keyToNudgeDelta` and `NudgeKeyEvent` not exported.

- [ ] **Step 3: Add the implementation**

Append to `src/renderer/state/playhead.ts`:

```typescript
// Subset of KeyboardEvent we actually look at. Lets us unit-test the function
// without constructing a full DOM event.
export interface NudgeKeyEvent {
  code: string;       // KeyboardEvent.code (physical key, e.g. 'Comma')
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

// Returns the nudge delta in seconds for the new fine-grained shortcuts
// (`,` / `.` with optional Shift), or null if the event doesn't match. Existing
// arrow shortcuts (±skipSeconds) keep their current handling in App.tsx — this
// function intentionally returns null for ArrowLeft/ArrowRight so callers can
// fall through.
export function keyToNudgeDelta(e: NudgeKeyEvent, fps: number): number | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  switch (e.code) {
    case 'Comma':
      return e.shiftKey ? -1 : -frameStepSeconds(fps);
    case 'Period':
      return e.shiftKey ? +1 : +frameStepSeconds(fps);
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- playhead`
Expected: PASS — 19 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/state/playhead.ts tests/unit/playhead.test.ts
git commit -m "feat(playhead): add keyToNudgeDelta for frame/second shortcuts"
```

---

### Task 4: Clamp `Preview.tsx`'s skipRequest handler to clip range

**Files:**
- Modify: `src/renderer/components/Preview.tsx`

The existing handler clamps to `[0, source.duration]` regardless of mode, which means a frame-step in clip mode could land outside the clip. With an active clip, clamp to `[clip.in, clip.out]`.

- [ ] **Step 1: Add the import**

At the top of `src/renderer/components/Preview.tsx`, alongside the other state imports:

```typescript
import { clampPlayhead, snapToFrame } from '../state/playhead';
```

- [ ] **Step 2: Update the skipRequest useEffect**

Find this block (around lines 103-109):

```typescript
const skipRequest = useProjectStore(s => s.skipRequest);
useEffect(() => {
  if (!skipRequest) return;
  const v = videoRef.current;
  if (!v || !project) return;
  v.currentTime = Math.max(0, Math.min(project.sourceVideo.duration, v.currentTime + skipRequest.delta));
}, [skipRequest?.token]);
```

Replace the body with:

```typescript
const skipRequest = useProjectStore(s => s.skipRequest);
useEffect(() => {
  if (!skipRequest) return;
  const v = videoRef.current;
  if (!v || !project) return;
  const target = snapToFrame(v.currentTime + skipRequest.delta, project.sourceVideo.fps);
  const lo = activeClip ? activeClip.in : 0;
  const hi = activeClip ? activeClip.out : project.sourceVideo.duration;
  v.currentTime = clampPlayhead(target, lo, hi);
}, [skipRequest?.token]);
```

- [ ] **Step 3: Verify build**

Run: `npm run build:renderer`
Expected: build succeeds; no TypeScript errors.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`
- Open a source video.
- Add a clip from t=10 to t=15.
- Select the clip (clip mode). Press `→` repeatedly. Confirm the playhead never goes past t=15.
- Press `←` repeatedly from t=10. Confirm it never goes below t=10.
- Switch to source mode (deselect clip). Press `→` past the clip's range. Confirm the playhead can move freely up to source duration.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Preview.tsx
git commit -m "fix(preview): clamp skipRequest to clip range when clip is active"
```

---

### Task 5: Add `,` / `.` / `Shift+,` / `Shift+.` shortcuts in `App.tsx`

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add the import**

At the top of `src/renderer/App.tsx`, alongside the other state imports:

```typescript
import { keyToNudgeDelta } from './state/playhead';
```

- [ ] **Step 2: Add the new key handling**

In the `onKey` function inside the `useEffect` near the top of `App`, add a new branch *after* the existing `ArrowLeft` / `ArrowRight` blocks (around lines 71-80). The full updated branch looks like:

```typescript
if (e.key === 'ArrowLeft') {
  e.preventDefault();
  st.requestSkip(-useSettings.getState().skipSeconds);
  return;
}
if (e.key === 'ArrowRight') {
  e.preventDefault();
  st.requestSkip(+useSettings.getState().skipSeconds);
  return;
}
const nudgeDelta = keyToNudgeDelta(
  { code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey },
  st.project.sourceVideo.fps,
);
if (nudgeDelta !== null) {
  e.preventDefault();
  st.requestSkip(nudgeDelta);
  return;
}
```

Note: the surrounding `if (e.ctrlKey || e.metaKey || e.altKey) return;` early-return at the top of `onKey` already filters non-shift modifiers, so the `keyToNudgeDelta` modifier checks are belt-and-braces.

- [ ] **Step 3: Verify build**

Run: `npm run build:renderer`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`. Open a source video, select a clip:
- Press `.` repeatedly. Playhead advances ~1/fps seconds per press.
- Press `,` repeatedly. Playhead retreats by the same amount.
- Press `Shift+.` (`>`). Playhead advances by 1 second.
- Press `Shift+,` (`<`). Playhead retreats by 1 second.
- Verify clamping at clip boundaries (combined with Task 4).
- Verify existing `←` / `→` still skip by `skipSeconds`.
- Open Settings, focus the skipSeconds input, press `,`. Confirm the input receives the keystroke and the playhead does not move (existing `isTyping()` gate).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(shortcuts): add comma/period frame and 1s nudge keys"
```

---

### Task 6: Add UI nudge buttons to `Preview.tsx`

**Files:**
- Modify: `src/renderer/components/Preview.tsx`

- [ ] **Step 1: Add the import**

Update the existing `playhead` import in `Preview.tsx` from Task 4:

```typescript
import { clampPlayhead, frameStepSeconds, snapToFrame } from '../state/playhead';
```

- [ ] **Step 2: Replace the existing two-button row with the six-button row**

Find this block (around lines 320-338):

```tsx
{!suspendZoom && (
  <div
    onMouseDown={e => e.stopPropagation()}
    style={{
      position: 'absolute', top: 8, left: 8,
      display: 'flex', gap: 4, zIndex: 5,
    }}>
    <button
      onClick={e => { e.stopPropagation(); requestSkip(-skipSeconds); }}
      title={`Skip back ${skipSeconds} seconds (← arrow)`}>
      − {skipSeconds}s
    </button>
    <button
      onClick={e => { e.stopPropagation(); requestSkip(+skipSeconds); }}
      title={`Skip forward ${skipSeconds} seconds (→ arrow)`}>
      + {skipSeconds}s
    </button>
  </div>
)}
```

Replace it with:

```tsx
{!suspendZoom && (
  <div
    onMouseDown={e => e.stopPropagation()}
    style={{
      position: 'absolute', top: 8, left: 8,
      display: 'flex', gap: 4, zIndex: 5,
    }}>
    <button
      onClick={e => { e.stopPropagation(); requestSkip(-skipSeconds); }}
      title={`Skip back ${skipSeconds} seconds (← arrow)`}>
      − {skipSeconds}s
    </button>
    <button
      onClick={e => { e.stopPropagation(); requestSkip(-1); }}
      title="Step back 1 second (Shift+,)">
      −1s
    </button>
    <button
      onClick={e => { e.stopPropagation(); requestSkip(-frameStepSeconds(project.sourceVideo.fps)); }}
      title="Step back 1 frame (,)">
      ◀
    </button>
    <button
      onClick={e => { e.stopPropagation(); requestSkip(+frameStepSeconds(project.sourceVideo.fps)); }}
      title="Step forward 1 frame (.)">
      ▶
    </button>
    <button
      onClick={e => { e.stopPropagation(); requestSkip(+1); }}
      title="Step forward 1 second (Shift+.)">
      +1s
    </button>
    <button
      onClick={e => { e.stopPropagation(); requestSkip(+skipSeconds); }}
      title={`Skip forward ${skipSeconds} seconds (→ arrow)`}>
      + {skipSeconds}s
    </button>
  </div>
)}
```

- [ ] **Step 3: Verify build**

Run: `npm run build:renderer`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`. Open a source video, select a clip:
- The button row now shows six buttons in order: `−Ns · −1s · ◀ · ▶ · +1s · +Ns`.
- Click each button. Confirm the playhead moves by the expected amount and clamps at clip boundaries.
- Hover each button. Confirm the tooltip shows the matching keyboard shortcut.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Preview.tsx
git commit -m "feat(preview): add 1s and frame nudge buttons alongside skipSeconds"
```

---

### Task 7: Allow nudging in `TrackMarkerOverlay` during `waiting-start`

**Files:**
- Modify: `src/renderer/components/TrackMarkerOverlay.tsx`

`App.tsx`'s global handler bails out in `track-marker` mode (its existing behaviour, kept). `TrackMarkerOverlay` registers its own keyboard handler and renders its own button row, both active only during the `waiting-start` phase.

- [ ] **Step 1: Add the imports**

In `src/renderer/components/TrackMarkerOverlay.tsx`, alongside the existing imports:

```typescript
import { useProjectStore } from '../state/projectStore';
import { clampPlayhead, frameStepSeconds, snapToFrame, keyToNudgeDelta } from '../state/playhead';
```

(`useProjectStore` is already imported; only the `playhead` import is new.)

- [ ] **Step 2: Read fps from the store**

Inside `TrackMarkerOverlay`, after the existing `useProjectStore` selectors (near the top of the component body), add:

```typescript
const fps = useProjectStore(s => s.project?.sourceVideo.fps ?? 30);
const skipSeconds = useSettings(s => s.skipSeconds);
```

(`useSettings` is already imported; only the `skipSeconds` selector is new.)

- [ ] **Step 3: Add a shared nudge helper**

Inside the component, add a small helper that nudges the video's currentTime, clamped to the clip range:

```typescript
function nudge(delta: number) {
  const v = videoRef.current;
  if (!v) return;
  const target = snapToFrame(v.currentTime + delta, fps);
  v.currentTime = clampPlayhead(target, clip.in, clip.out);
}
```

Place this above the existing `localXY` helper.

- [ ] **Step 4: Register a phase-gated keyboard handler**

Add this `useEffect` after the existing on-mount seek effect (around line 55):

```typescript
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
    if (e.code === 'ArrowLeft' && !e.shiftKey) {
      e.preventDefault();
      nudge(-skipSeconds);
      return;
    }
    if (e.code === 'ArrowRight' && !e.shiftKey) {
      e.preventDefault();
      nudge(+skipSeconds);
      return;
    }
    const delta = keyToNudgeDelta(
      { code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey },
      fps,
    );
    if (delta !== null) {
      e.preventDefault();
      nudge(delta);
    }
  }
  document.addEventListener('keydown', onKey, { capture: true });
  return () => document.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
}, [phase, skipSeconds, fps, clip.in, clip.out]);
```

- [ ] **Step 5: Render the nudge button row during `waiting-start`**

Inside the JSX returned by `TrackMarkerOverlay`, add this block right after the existing status-text bar and before the live preview box (around line 203):

```tsx
{phase === 'waiting-start' && (
  <div
    onMouseDown={e => e.stopPropagation()}
    onClick={e => e.stopPropagation()}
    style={{
      position: 'absolute', top: 40, left: 8,
      display: 'flex', gap: 4, zIndex: 5,
    }}>
    <button onClick={() => nudge(-skipSeconds)} title={`Skip back ${skipSeconds}s (←)`}>− {skipSeconds}s</button>
    <button onClick={() => nudge(-1)} title="Step back 1s (Shift+,)">−1s</button>
    <button onClick={() => nudge(-frameStepSeconds(fps))} title="Step back 1 frame (,)">◀</button>
    <button onClick={() => nudge(+frameStepSeconds(fps))} title="Step forward 1 frame (.)">▶</button>
    <button onClick={() => nudge(+1)} title="Step forward 1s (Shift+.)">+1s</button>
    <button onClick={() => nudge(+skipSeconds)} title={`Skip forward ${skipSeconds}s (→)`}>+ {skipSeconds}s</button>
  </div>
)}
```

- [ ] **Step 6: Verify build**

Run: `npm run build:renderer`
Expected: build succeeds.

- [ ] **Step 7: Manual smoke check**

Run: `npm run dev`. Open a source video where you can find a clip with a player that isn't at the in-point.
- Add a clip. Add a focus marker on the clip (place-focus mode), confirm marker exists.
- Click the marker's "Track" button. Phase = `waiting-start`. Video at `clip.in`.
- Press `→` (or click the `+ Ns` button). Playhead advances by `skipSeconds`.
- Press `.` repeatedly. Playhead advances by ~1 frame.
- Press `Shift+.`. Playhead advances by 1 second.
- Verify clamping at clip in/out (you can't nudge past either end).
- Once the player is in frame, click on the player. Phase = `recording`. Confirm the button row disappears and arrow keys / `,.` no longer move the playhead. Playback continues at `trackingPlaybackRate`.
- Continue tracking; click again to stop. Confirm `marker.in` is set to the source-time of the first click (the nudged position), not `clip.in`.
- Replay the clip. Confirm the marker is invisible from `clip.in` until the nudged-to time, then animates along the recorded path.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/TrackMarkerOverlay.tsx
git commit -m "feat(track-marker): allow nudge controls during waiting-start phase"
```

---

### Task 8: Update the smoke checklist

**Files:**
- Modify: `docs/smoke-checklist.md`

- [ ] **Step 1: Append a new section**

Append the following to `docs/smoke-checklist.md`:

```markdown

## Nudge controls

- [ ] Open a clip. Press `,` and `.` repeatedly. Playhead advances/retreats by ~1 frame each press, clamped at clip in/out.
- [ ] Press `Shift+,` and `Shift+.`. Playhead moves by 1 second each press, clamped at clip in/out.
- [ ] Click the new buttons (`−1s`, `◀`, `▶`, `+1s`) under the preview. Playhead moves by the matching amount.
- [ ] Existing `←` / `→` still skip by `skipSeconds`.

## Pre-click nudge in track mode

- [ ] Find or create a clip whose tracked player isn't visible at `clip.in`.
- [ ] Add a focus marker. Click "Track". Confirm phase = `waiting-start` and the nudge button row appears at top-left of the overlay.
- [ ] Press `.` / `Shift+.` / `→` (or click corresponding buttons) until the player is in frame.
- [ ] Left-click on the player. Confirm playback starts at `trackingPlaybackRate` and the nudge row disappears.
- [ ] Mouse-follow the player. Left-click again to stop. Confirm `marker.in` is at the nudged source-time (the marker is invisible before that, then animates).
- [ ] Save the project. Reload it. Confirm `marker.in` is preserved.
```

- [ ] **Step 2: Commit**

```bash
git add docs/smoke-checklist.md
git commit -m "docs: extend smoke checklist with nudge and pre-click track tests"
```

---

## Self-review notes (for the implementer)

- **Spec coverage check:** Tasks 1-3 deliver the utilities the spec calls out; Task 4 ships the clamping rule from the "Errors and Edge Cases" table; Tasks 5-6 deliver the keyboard shortcuts and UI buttons section; Task 7 delivers "Allow nudging in track-marker mode during the `waiting-start` phase only"; Task 8 ships the manual smoke additions.
- **Type consistency:** `clampPlayhead`, `frameStepSeconds`, `keyToNudgeDelta`, and `NudgeKeyEvent` are introduced in Task 1-3 and re-used identically by Tasks 4-7. No drift in names or signatures.
- **No data-model or export-pipeline change:** confirmed by spec; no tasks touch `src/shared/types.ts`, `src/main/project/schema.ts`, or `src/main/ffmpeg/command.ts`.
