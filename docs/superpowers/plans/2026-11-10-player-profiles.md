# Player Profiles Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reuse saved players across videos, bookmark their plays by letter, and choose their names when tagging.

**Architecture:** Persist profiles separately from projects using the existing Zustand/localStorage pattern. Extend bookmarks with optional player identity and a name snapshot; reuse the existing bookmark list for each player. Tags retain their label so exports and older projects continue working.

**Tech Stack:** React, TypeScript, Zustand, Zod, Jest; no new dependencies.

**Spec:** User-approved design in the conversation on 2026-11-10.

## Global Constraints

- Profiles belong to the app; bookmarks belong to their project and source video.
- B remains the ordinary bookmark shortcut; player letters are unique and case insensitive.
- Keep existing bookmark rewind, ordering, highlight, label editing and deletion.
- Tag dropdowns offer saved profiles and a custom name without saving a profile.
- Preserve existing project formats and existing exported tag captions.

## Review Focus

- Profile edits/deletion must not erase existing bookmark or tag names.
- Inputs, dropdowns, dialogs, held keys and recording modes must not create accidental bookmarks.
- Multi-source projects must keep player lists scoped to the active video.
- Older projects must load without requiring player data.
- Invalid/duplicate persisted profiles must not create shortcut collisions.

### Task 1: Profiles and project persistence

Files: `src/renderer/state/playerProfiles.ts`, `src/shared/types.ts`, `src/main/project/schema.ts`, `src/renderer/state/projectStore.ts`, `tests/unit/playerProfiles.test.ts`, `tests/unit/playerBookmarks.test.ts`.

Interfaces: `PlayerProfile { id, name, shortcut }`; profile store `saveProfile(input, id?) -> string | null`, `deleteProfile(id)`; `addBookmark(time, player?)` stores `playerId`/`playerName` snapshots.

- [x] Write tests for app-level persistence, validation, profile editing/deletion, player bookmark round trips and active source identity.
- [x] Run targeted Jest tests and observe missing-feature failures.
- [x] Implement store, optional fields and schema support.
- [x] Run targeted tests and confirm they pass.

### Task 2: Player interface and shortcuts

Files: `PlayerProfilesModal.tsx`, `PlayerNameField.tsx`, `BookmarkList.tsx`, `RightPanel.tsx`, `ClipFocusMarkers.tsx`, `App.tsx`, `playerProfiles.css`.

Interfaces: reusable player name field consumes label/playerId and emits a focus-marker patch. Profile manager adds/edits/deletes app profiles. Bookmark selector reuses existing list rendering for General and each player, including saved names for removed profiles.

- [x] Add manager accessible from the toolbar, bookmark list and empty state.
- [x] Add player list selection and player-aware manual bookmarking.
- [x] Connect assigned letters to bookmark creation and toast feedback, preserving typing/modal/recording guards and ignoring repeat.
- [x] Add saved/custom name choice before tagging and on existing tags.
- [x] Verify the complete interaction in a browser harness, including reopening profiles, custom tags and source switching.

### Task 3: Verification and review

- [x] Run `npm.cmd test -- --runInBand`, renderer typecheck, and `npm.cmd run build`.
- [x] Review the final diff and resolve material issues.
- [x] Report user entry points and validation results; leave changes uncommitted for review.

## Execution record

- Approved design; proceeding inline in the shared workspace. No checkout, commit, push or deployment is needed.
- Tests: 207/207 unit tests passed; renderer typecheck and production build passed.
- Browser checks: multiple profile creation, player/general shortcut separation, per-video ownership, modified/repeated/composing key guards, recording guards, typing/select/dialog guards, saved and custom tags, reload persistence, and management without a project passed.
- Independent read-only review found no concrete correctness bugs. Existing names remain snapshots after profile edits/removal.
- Temporary browser harness removed and isolated browser/server closed. Existing `.export-verification/` left untouched.
