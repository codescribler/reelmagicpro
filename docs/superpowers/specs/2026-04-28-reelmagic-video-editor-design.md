# ReelMagic Video Editor — Design

**Date:** 2026-04-28
**Status:** Approved (pending written-spec review)

## Purpose

A desktop application that lets a user load a single `.mp4` source video, define multiple clips from it, edit each clip non-destructively (zoom, slow down), arrange clips into a sequence, and export either an individual clip or the full sequence as `.mp4` files.

## Scope

In scope:

- Loading a single source `.mp4` per project.
- Defining multiple clips by in/out points on the source.
- Per-clip static zoom (one crop rectangle, applied to the whole clip).
- Per-clip constant speed factor (`0.25×` to `4×`); audio is muted on the clip when `speed != 1.0`, kept when `speed == 1.0`.
- Duplicating a clip into an independent copy.
- Arranging clips (including reusing the same clip) into an ordered sequence.
- Exporting a single clip as `.mp4`.
- Exporting the sequence as a single concatenated `.mp4`.
- Saving and loading the project as a JSON file.

Out of scope for v1:

- Multiple source videos per project.
- Keyframed / animated zoom or pan.
- Variable speed ramps.
- Multi-track timelines.
- Audio time-stretching (audio is dropped when speed changes).
- Export presets, resolution scaling, codec choice (always source resolution, H.264).
- Project tabs / multiple projects per window.
- UI / E2E test automation.

## Stack

- **Electron** (Node.js main process + Chromium renderer).
- **TypeScript** for both processes.
- **HTML5 `<video>`** for live preview, with CSS `transform: scale + translate` for zoom and `video.playbackRate` for speed.
- **`ffmpeg-static`** (npm package) bundles per-platform `ffmpeg` binaries with the app.
- **`fluent-ffmpeg`** OR direct `child_process.spawn` to drive ffmpeg from the main process. (Final choice during implementation; the surface is small enough that direct `spawn` is acceptable and keeps dependencies lean.)
- **Jest** for unit and integration tests.

## Architecture

Two processes:

- **Main process (Node).** File system access, project save/load, spawning ffmpeg for export, parsing ffmpeg progress, IPC server.
- **Renderer process (Chromium).** All UI: source preview, timeline, clip list, sequence panel, live preview transforms. No direct `fs` or `child_process` access.

A small IPC API exposed via `contextBridge`:

- `openSourceVideo()` → `{ path, duration, width, height, fps }` (runs ffprobe).
- `saveProject(project, path?)` → `{ path }`.
- `loadProject(path?)` → `{ project, path }`.
- `exportClip(clip, sourcePath, sourceMeta, outputPath)` → progress events, then `{ ok }` or `{ error }`.
- `exportSequence(clips, sequence, sourcePath, sourceMeta, outputPath)` → progress events, then `{ ok }` or `{ error }`.
- `cancelExport(runId)` → kills the active ffmpeg child and cleans up temp files.

Live preview never invokes ffmpeg. Export is the only place ffmpeg runs.

## Data Model

A project is a single JSON file:

```jsonc
{
  "version": 1,
  "sourceVideo": {
    "path": "C:/.../input.mp4",
    "duration": 423.5,
    "width": 1920,
    "height": 1080,
    "fps": 29.97
  },
  "clips": [
    {
      "id": "clip_a1b2",
      "name": "Intro",
      "in": 12.40,
      "out": 18.75,
      "speed": 1.0,
      "zoom": { "x": 0, "y": 0, "width": 1920, "height": 1080 }
    }
  ],
  "sequence": [
    { "clipId": "clip_a1b2" }
  ]
}
```

Rules:

- **Non-destructive.** Clips are metadata only; the source file is never modified.
- **Default zoom = full frame.** A zoom rect equal to the source frame means "no zoom" — no transform is applied at preview or export.
- **Sequence is a list of references.** Same `clipId` may appear multiple times. Editing a clip updates every sequence position that references it. To get "original then zoomed version," duplicate the clip first (creating a second clip with its own `id`) and place both in the sequence.
- **Source path is absolute.** If the source moves, project loads in a "relink" state; the rest of the project remains intact.
- **One project per window.** Opening another project replaces the current one (with an unsaved-changes prompt).

## UI Layout

A single window with four panels:

```
┌──────────────────────────────────────────────────────────────────┐
│  [File ▾]  [Project: untitled *]                    [Export ▾]   │
├──────────────────────────────────────────────┬───────────────────┤
│            PREVIEW                           │   CLIP LIST       │
│        (HTML5 video,                         │                   │
│         zoom + speed                         │   ▸ Intro         │
│         applied live)                        │   ▸ Wide shot     │
│                                              │   ▸ Wide (zoom)   │
│                                              │   [+ Add clip]    │
│                                              │   [Duplicate]     │
│                                              │   [Delete]        │
├──────────────────────────────────────────────┤                   │
│  TIMELINE                                    │                   │
│  ├──────────░░░░░░░░░░──────────────┤        │                   │
│   00:00      [in]      [out]   07:03         │                   │
├──────────────────────────────────────────────┴───────────────────┤
│  SEQUENCE                                                         │
│  [Intro] → [Wide shot] → [Wide (zoom)]              [Export ▸]   │
└──────────────────────────────────────────────────────────────────┘
```

### Preview

Plays whatever is in the active preview mode:

- **Source mode** — playing the raw source, driven by the timeline scrubber.
- **Clip mode** — playing a single clip with that clip's zoom and speed applied (CSS transform + `playbackRate`).
- **Sequence mode** — playing each sequence entry in order.
- **Set-zoom mode** — overlay for drawing a crop rectangle on top of the paused preview frame.

Standard play/pause/scrub controls beneath the video.

### Clip list (right pane)

Vertical list of defined clips. Selecting a clip:

- Switches preview to clip mode for that clip.
- Reveals an inline editor: name field, speed slider (`0.25×–4×`), "Set zoom region" button, "Reset zoom", "Duplicate", "Delete".

"Set zoom region" enters set-zoom mode on the preview: user drags a rectangle (clamped to source frame), confirms, the rect is saved on the clip.

### Timeline (bottom-left)

Always shows the **source video's** full duration. Drag-to-create a region (in/out range), drag handles to fine-tune. "Add Clip" creates a new clip with those in/out points and default zoom/speed. Existing clips shown as dim ranges for reference. (Clip selection from the timeline view itself is not in v1 — selection is via the clip list.)

### Sequence (bottom strip)

Horizontal strip below the timeline. Drag clips from the clip list onto it to append. Reorder by dragging tiles. Click a tile to remove it. "Play sequence" enters sequence mode in the preview. "Export sequence" opens a save dialog and starts export.

## Live Preview Behavior

- **Zoom** — CSS `transform: scale(W / zoom.width) translate(-zoom.x, -zoom.y)` on the `<video>` element, with the container set to `overflow: hidden` and the source resolution. Visual result matches what export will produce.
- **Speed** — `video.playbackRate = clip.speed`. Audio is muted in the renderer when `speed != 1.0`, kept on when `speed == 1.0`. Preview behavior matches export's audio rule.
- **Clip boundaries** — preview `currentTime` is clamped to `[clip.in, clip.out]`. Reaching `clip.out` pauses (clip mode) or advances to the next sequence entry (sequence mode).

## Export Pipeline

### Per-clip ffmpeg command

For one clip with crop rect `(x, y, w, h)`, speed `s`, in `t1`, out `t2`, source `W×H`:

**When `s == 1.0`** (audio kept):

```
ffmpeg -ss <t1> -to <t2> -i <source>
       -filter_complex "[0:v]crop=w:h:x:y,scale=W:H,setpts=PTS[v]"
       -map "[v]" -map 0:a?
       -c:v libx264 -preset medium -crf 18
       -c:a aac -b:a 192k -ar 48000 -ac 2
       -movflags +faststart
       <output>.mp4
```

**When `s != 1.0`** (audio replaced with silence at uniform params):

```
ffmpeg -ss <t1> -to <t2> -i <source> -f lavfi -i anullsrc=cl=stereo:r=48000
       -filter_complex "[0:v]crop=w:h:x:y,scale=W:H,setpts=PTS/s[v]"
       -map "[v]" -map 1:a -shortest
       -c:v libx264 -preset medium -crf 18
       -c:a aac -b:a 192k -ar 48000 -ac 2
       -movflags +faststart
       <output>.mp4
```

Both branches produce output with **identical audio params** (AAC stereo 48kHz 192kbps), which is what makes the sequence concat below work without re-encoding. When speed is not 1.0, the user-visible behavior is still "no audio" (the track is silent) — matching the design decision to mute slowed clips.

### Per-clip export

`exportClip` runs the command above to the user's chosen output path. Returns `{ ok }` on success or `{ error }` on failure.

### Sequence export

Two-pass:

1. For each entry in `sequence`, render its referenced clip to a temp file in `os.tmpdir()/reelmagic-export-<runId>/part-<index>.mp4` using the per-clip command. Render serially (one ffmpeg at a time).
2. Concatenate all temp files:
   ```
   ffmpeg -f concat -safe 0 -i list.txt -c copy <output>.mp4
   ```
   All temp parts share resolution, codec, and audio params (the audio-rule above guarantees it), so `-c copy` works without re-encoding.
3. Delete the temp directory.

### Progress and cancellation

- ffmpeg invoked with `-progress pipe:2`; main process parses key=value lines and emits IPC progress events `{ phase, currentItem, totalItems, percent }`.
- Renderer shows a modal: "Exporting clip 2 of 5 — 47%", with a Cancel button.
- `cancelExport` kills the active child, deletes the temp dir, and leaves no partial output at the user's chosen path.
- App-quit during export kills the child and cleans up temp.

## Errors and Edge Cases

| Case | Handling |
|---|---|
| Source missing on project load | Show "Source not found at `<path>`. Relink?" dialog. Project stays loaded but disabled until source is provided. |
| Source unreadable / unsupported codec | ffprobe fails on open → show "Couldn't read this file" → refuse to load. |
| Clip `out` > source duration after reload | Clamp `out` to `min(out, sourceDuration)`. If `in >= out` after clamping, mark clip invalid (greyed in list, can't export, can't add to sequence). |
| Zoom rect out of frame | UI clamps during draw. On load, clamp any out-of-bounds rect to source frame. |
| Empty sequence | "Export Sequence" button disabled. |
| Output file exists | OS save dialog handles overwrite. |
| Disk full / write denied during export | ffmpeg exit code caught → "Export failed: `<message>`" → temp cleaned → no partial output. |
| App close during export | Kill child, clean temp, don't block shutdown. |
| Unsaved changes on close / new / load | Save / Don't save / Cancel dialog. |
| Speed input out of range | UI slider clamped to `[0.25, 4.0]`. Loaded value clamped on load. |
| Invalid clip in sequence (after clamping made it invalid) | Sequence entry shown greyed; "Export Sequence" disabled until fixed or removed. |

## Testing Strategy

- **Unit tests (Jest, plain Node):**
  - Project (de)serialization round-trip.
  - Clip and zoom-rect clamping on load (out-of-bounds, in >= out, etc.).
  - ffmpeg command-string generation from a clip's parameters (per-clip command, audio flag selection, concat list).
  - Sequence-export item planning (temp paths, list.txt contents).
- **Integration tests (Jest + bundled `ffmpeg-static`):**
  - Single-clip export against a small fixture video (a few seconds of test pattern committed to the repo). Assert output exists, exit code 0, expected duration within fps tolerance, expected resolution.
  - Sequence export of two clips. Assert concatenated duration and resolution.
  - Zoom: export a clip with a crop rect, assert output dimensions match source resolution.
  - Speed: export a clip at `0.5×`, assert duration is approximately doubled.
- **No UI/E2E automation in v1.** Renderer is thin glue over the IPC API; we keep renderer code small and rely on manual smoke testing.
- **Manual smoke checklist** lives at `docs/smoke-checklist.md`: open video → add clip → zoom → slow → duplicate → build sequence → export clip → export sequence. One human pass before each release.

## File and Module Structure (Initial)

```
reelmagic/
├── package.json
├── tsconfig.json
├── electron-builder.yml          # packaging config
├── src/
│   ├── main/
│   │   ├── main.ts               # app entry, window creation
│   │   ├── ipc.ts                # IPC handler registration
│   │   ├── ffmpeg/
│   │   │   ├── command.ts        # build per-clip ffmpeg arg list
│   │   │   ├── runner.ts         # spawn, parse progress, kill
│   │   │   ├── probe.ts          # ffprobe wrapper
│   │   │   └── exporter.ts       # exportClip, exportSequence orchestration
│   │   └── project/
│   │       ├── schema.ts         # types + zod (or hand-rolled) validation
│   │       └── io.ts             # save/load JSON, clamp on load
│   ├── preload/
│   │   └── preload.ts            # contextBridge, narrow API surface
│   ├── renderer/
│   │   ├── index.html
│   │   ├── index.tsx             # React (or plain TS — TBD during plan; React likely)
│   │   ├── state/                # project state store
│   │   ├── components/
│   │   │   ├── Preview.tsx
│   │   │   ├── Timeline.tsx
│   │   │   ├── ClipList.tsx
│   │   │   ├── ClipEditor.tsx
│   │   │   ├── Sequence.tsx
│   │   │   └── ExportDialog.tsx
│   │   └── styles/
│   └── shared/
│       └── types.ts              # types shared between main and renderer
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│       └── test-pattern.mp4      # small fixture for integration tests
└── docs/
    └── smoke-checklist.md
```

(Renderer framework — React vs plain TS — to be confirmed during plan-writing. React is the working assumption.)

## Open Questions

None at design time. Items deferred for the implementation plan to settle:

- React vs plain TS in renderer.
- `fluent-ffmpeg` vs direct `child_process.spawn`.
- State management library in renderer (Zustand / Redux / plain React state).
- App icon and branding.
