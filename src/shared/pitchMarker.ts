import type { FocusMarker } from './types';
import { smoothMarkerPath } from './smoothMarkerPath';

// Approximate the ground at the bottom of the player area. Keep the saved
// tracking coordinates intact so switching styles never shifts the track.
export function markerForDisplay(marker: FocusMarker): FocusMarker {
  if (marker.path && marker.smoothing) {
    marker = { ...marker, path: smoothMarkerPath(marker.path, marker.smoothing) };
  }
  if (marker.shape !== 'pitch') return marker;
  const height = marker.width * 0.3;
  const offsetX = marker.pitchOffsetX ?? 0;
  const offsetY = marker.height / 2 + (marker.pitchOffsetY ?? 0);
  return {
    ...marker,
    height,
    x: marker.x + offsetX,
    y: marker.y + marker.height / 2 + offsetY - height / 2,
    path: marker.path?.map(point => ({ ...point, cx: point.cx + offsetX, cy: point.cy + offsetY })),
  };
}
