import type { Clip, FocusMarker } from './types';

// Pick the marker that drives Instagram framing. Explicit primary wins; if
// none flagged, fall back to the first marker. Returns null when the clip has
// no markers — callers fall back to the focus-box centre in that case.
export function pickDrivingMarker(clip: Clip): FocusMarker | null {
  if (clip.focusMarkers.length === 0) return null;
  const explicit = clip.focusMarkers.find(m => m.primary === true);
  return explicit ?? clip.focusMarkers[0]!;
}
