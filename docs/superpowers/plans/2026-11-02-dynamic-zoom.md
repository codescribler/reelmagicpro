# Dynamic Zoom Implementation Plan

**Goal:** Record pointer-following zoom during clip playback, gently smooth it, and reproduce it in previews, projects and exports.

**Architecture:** Store clip-relative camera samples (source centre and magnification) on each clip. Apply frame-rate-independent exponential easing while recording, then interpolate those same samples in both previews and FFmpeg. A recorded path takes precedence over the fixed focus box; clearing it restores that box. No dependencies are added.

**Confirmed interaction:** Follow the pointer with gentle smoothing. Scroll up to zoom towards detail; scroll down to restore game context. Left-click the video to start, left-click again to save and replay, or press Escape to cancel without moving off the action. Replace or clear the take from the clip editor.

**Implementation decisions:** Record from clip start at the existing tracking playback rate. Maintain source aspect ratio, limit zoom to 1–6× and clamp to source bounds. Pointer coordinates select a source position within the currently visible view. Use about 180 ms of source time for easing; store the resulting camera path at up to 30 samples per source second. Hold the final view if recording ends early. Cancel preserves the previous take. Preview and export linearly interpolate the already eased path without a second smoothing pass.

## Tasks

- [x] Camera model and persistence: test wheel normalization, frame-rate-independent easing, bounded crops, path interpolation and project round trips. Add shared camera helpers, types and schema.
- [x] Recording and previews: add Record zoom / Re-record / Clear controls, a recording overlay with Start, Save and Cancel, pointer following and wheel capture. Apply shared crops to clip/sequence and reel previews. Preserve source selection, playback speed and existing markers.
- [x] Export: add a dedicated dynamic zoom filter helper using FFmpeg zoompan, draw markers in source space before the camera transform, then retain branding and reel composition. Prove zoom changes and pointer movement with decoded pixel integration tests, including slow motion.
- [x] Verify: run unit tests, TypeScript/build and relevant FFmpeg integration tests; review the complete change and record any limits.

## Review focus

Check recording cleanup/cancel and clip switching, source edges/full-frame recovery, differing source sizes, timestamps under slow motion, and marker/reel composition. Older projects retain their existing fixed crop behaviour.

## Execution notes

The user confirmed the interaction in chat. Implement in this session on `feat/dynamic-zoom`; no publication or remote check-in is requested.

The independent review found two issues, both repaired and rechecked: normalize variable-frame-rate input before zoompan to preserve duration, and prevent replay from rewinding an active take. Clip boundary changes retime the path to keep it aligned with the original action. A temporary browser harness confirmed pointer pan, wheel zoom in/out, save/replay, cancellation preserving the previous take, automatic completion and clear. Decoded-frame tests verify standard and Instagram composition, slow motion and return to full frame. Long paths of up to 3,000 samples were parsed successfully through FFmpeg filter scripts.
