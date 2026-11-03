# Named Sequences Implementation Plan

**Goal:** Save several named, editable sequences inside one project, as the user confirmed.

**Architecture:** Optional named sequences store ids, names, ordered clip references, music and brightness. Existing top-level sequence fields remain the active working sequence for preview/export compatibility. Shared helpers synchronize them and migrate the legacy sequence only when the user starts naming/creating sequences. Clips remain a shared project library. Project save persists all sequences and the active selection.

**Tech stack:** Existing React, Zustand, TypeScript, Zod and project JSON. No dependencies.

## Tasks

- [x] Persistence and model: add named-sequence helpers and schema/serializer support; test old-project preservation, two-sequence save/reload, active selection and independent music/brightness.
- [x] State: add create, copy, rename, switch and delete operations in a focused module. Synchronize active edits and remove deleted clips from all sequences. Test duplicate names, repeated clips, sequence isolation and source deletion.
- [x] Editor: add a sequence selector, naming form, New/Copy/Rename/Delete and Save project controls above the sequence strip. Stop old preview when switching, retain drag/drop, show the bar for saved empty sequences and use the active name for export filenames.
- [x] Verification: browser-test switching/editing/naming/save/reload and drag/drop; run the full tests and build, then an independent review.

## Decisions and constraints

- Legacy projects retain their current sequence and settings as “Sequence 1”. Existing projects without named sequences keep their old file shape until naming/creating sequences is used.
- New sequences start empty; copies retain order and sequence settings. Names must be nonempty, at most 80 characters and unique ignoring case.
- Switching retains all edits in project memory. Save project explicitly writes every sequence to disk; there is no implied disk autosave.
- A sequence can reference a clip more than once. Edits to a shared clip affect its appearances in all sequences.
- At least one sequence remains. Deleting a sequence removes its arrangement/settings, not clips; the UI confirms this operation.
- Clip/source removal cleans references from every sequence so saved arrangements cannot resurrect deleted clips.

## Review focus

Legacy round trips, stale active mirrors, empty saved sequences, repeated clip references, per-sequence audio/brightness, switching during playback, save errors/cancellation and deletions while another sequence is inactive.

## Verification record

All 201 tests across 28 suites passed, including an actual project-file save/reopen and save cancellation/pending-edit checks. Production build and renderer TypeScript checks passed. Browser checks covered naming, copy isolation, settings retention, duplicate-name rejection, save/reopen across a page reload, active selection restoration, deleting an arrangement while keeping library clips and native drag reordering. Layout was visually checked. Independent review reported no important issues.
