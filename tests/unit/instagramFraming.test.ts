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
