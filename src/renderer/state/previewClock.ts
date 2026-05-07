// Shared mutable holder for the preview video's current playhead time.
// Updated by Preview.tsx on timeupdate; read imperatively by Timeline.tsx
// when the user clicks "Set in / Set out from preview". Lives outside the
// Zustand store so timeupdate writes don't trigger re-renders.
export const previewClock = { currentTime: 0 };
