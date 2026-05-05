import {
  clampPlayhead,
  frameStepSeconds,
  snapToFrame,
  keyToNudgeDelta,
  type NudgeKeyEvent,
} from '../../src/renderer/state/playhead';

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
