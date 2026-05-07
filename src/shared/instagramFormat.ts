// Single source of truth for the Instagram Reels output canvas. Used by the
// ffmpeg arg builder, the framing module's aspect default, and the preview
// canvas size calculations. If we ever add Square (1:1) or Portrait (4:5)
// presets, they can live alongside as additional constants — the framing
// module already takes targetAspect as an option.
export const INSTAGRAM_REEL_WIDTH = 1080;
export const INSTAGRAM_REEL_HEIGHT = 1920;
export const INSTAGRAM_REEL_ASPECT = INSTAGRAM_REEL_WIDTH / INSTAGRAM_REEL_HEIGHT; // 9/16 ≈ 0.5625
