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
