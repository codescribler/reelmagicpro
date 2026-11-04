# Individual Sequence Export Implementation Plan

> **For agentic workers:** Implement in this session, then request a fresh code review. Steps use checkbox syntax for tracking.

**Goal:** Export the active sequence as separate clip files in landscape, Instagram, or both, inside a new folder at a location chosen by the user.

**Architecture:** Reuse the export-options modal and existing single-clip encoder. A main-process batch exporter creates a unique sequence folder and runs clips sequentially under one cancellable run. Preserve sequence order, repetitions, each clip's source, edits and audio. Individual exports use clip settings; sequence-wide music and brightness remain part of combined-video export.

**Tech Stack:** Existing Electron, React, TypeScript, FFmpeg and Jest; no new dependencies.

**Spec:** User request in this conversation: export all clips from a sequence individually, optionally in both formats, create a containing folder and choose where it goes.

## Global Constraints

- Preserve the existing combined export and the earlier timestamp fix.
- Keep the user's verified MP4 exports and project file.
- Use jCodemunch for all code exploration.
- Native folder picker selects the parent; use the sequence name for the new folder.
- Never overwrite an existing folder; add a numeric suffix on repeat exports.
- Number filenames in sequence order; sanitize Windows filenames and distinguish both formats.
- Cancellation or failure retains completed files and reports them.

## Review Focus

- Duplicate clip names and repeated sequence entries must produce distinct files.
- Invalid or reserved Windows names must not escape the chosen folder.
- Mixed-source clips must use their own source metadata and Instagram framing.
- Cancellation must stop subsequent files and preserve completed exports.
- Missing clips, invalid format, and filesystem failures must return useful errors.

### Task 1: Cancellable batch exporter

**Files:** Create `src/main/ffmpeg/exportSequenceClips.ts`, `tests/integration/exportSequenceClips.test.ts`; modify `src/shared/types.ts`.

**Interfaces:** `exportSequenceClips(opts: ExportSequenceClipsArgs & { signal?: AbortSignal; onProgress?: (p: ExportProgress) => void }): Promise<ExportResult>`; result includes `outputDirectory` and `outputPaths`.

- [x] Write real FFmpeg tests for both formats, ordered duplicates, mixed sources, safe unique folders, validation and cancellation with saved files.
- [x] Run tests and observe failures before implementing.
- [x] Implement validated batch planning, atomic unique-folder creation, existing encoder reuse and aggregate progress.
- [x] Verify the new integration tests.

### Task 2: Export UI and Electron bridge

**Files:** Modify `src/main/ipc.ts`, `src/preload/preload.ts`, `src/shared/window.d.ts`, `src/renderer/App.tsx`, `src/renderer/components/ExportOptionsModal.tsx`, `src/renderer/components/ExportProgressModal.tsx`, `src/renderer/state/projectStore.ts`; create `src/renderer/state/exportSequenceClips.ts` and tests for the renderer workflow.

- [x] Test folder-picker cancellation, batch parameters, error reporting and progress/result setup.
- [x] Add the folder picker and cancellable batch IPC endpoint.
- [x] Add Combined video / Individual clips choices only for sequences, preserving format options and preview.
- [x] Display folder destination, current filename, saved-file count and scrollable results.
- [x] Verify workflow tests, all unit/integration tests and production build.
- [x] Inspect the rendered options UI and request a fresh review; resolve material findings.

## Verification

177 unit tests and 35 FFmpeg integration tests passed. Production build and renderer typecheck passed. Browser inspection exercised the actual React editor against a stubbed Electron boundary: individual clips + Both showed four named files and the destination; combined-video export remained the default and completed. Native directory selection uses Electron's existing dialog API and was tested through the renderer boundary rather than a live OS dialog.

Review found no blocking issues. Optional follow-up: cancellation coverage currently aborts at a completed-file boundary; a longer active-render cancellation fixture could additionally pin partial-file cleanup. Browser inspection caught a clipped footer with the tall Instagram preview; the options body now scrolls independently and the action stays visible.
