# Plan — Multi-source projects

**Date:** 2026-05-12
**Author:** Claude (design proposal — review required before build)
**Status:** Draft for sign-off
**Touches:** types, schema, project store, preview, clip list, bookmark list, timeline, sequence bar, ffmpeg pipeline, IPC, App.tsx
**Estimated scope:** Largest change since the Instagram-export work — comparable to v0.2.0's combined feature set.

> The user wants to assemble sequences from multiple source videos in a single project, with clear UI signals so it's always obvious which video each clip / bookmark / sequence chip belongs to. Legacy projects (single-source) must keep working without conversion — any clip / bookmark that doesn't specify a source resolves to the first source in the project.

This document captures the design decisions and the open ones before any code is written. Each section flags choices that need a yes/no.

---

## 1. Data model

### Today (single source)

```ts
interface Project {
  version: 1;
  sourceVideo: SourceMeta;
  clips: Clip[];
  sequence: SequenceEntry[];
  bookmarks: Bookmark[];
  ...
}
interface Clip { id; name; in; out; ... /* no sourceId */ }
interface Bookmark { id; time; ... /* no sourceId */ }
interface SequenceEntry { clipId; /* no sourceId */ }
```

### Proposed (multi-source)

```ts
interface SourceVideo extends SourceMeta {
  id: string;        // e.g. "src_a8x39q"
  // SourceMeta already carries path, duration, width, height, fps
}

interface Project {
  version: 1 | 2;
  sourceVideo: SourceMeta;          // KEPT for back-compat read path; never written in v2
  sources: SourceVideo[];           // NEW — canonical list. sources[0] is the default.
  clips: Clip[];
  sequence: SequenceEntry[];
  bookmarks: Bookmark[];
  ...
}

interface Clip {
  id; name; in; out; ...
  sourceId?: string;   // undefined ⇒ sources[0]
}
interface Bookmark {
  id; time; ...
  sourceId?: string;   // undefined ⇒ sources[0]
}
// SequenceEntry stays { clipId } — the source comes from the clip, not the entry.
```

**Resolution rule (single line, repeated everywhere):**

> `resolveSource(project, sourceId?) = project.sources.find(s => s.id === sourceId) ?? project.sources[0]`

### Migration (load-time, in `parseAndClampProject`)

- If `sources` is present → use it.
- Else if `sourceVideo` is present → synthesise `sources = [{ id: newId(), ...sourceVideo }]` and call that the default. Bump in-memory `version` to 2 *but write the project back as v1 only if no second source is ever added.* (Avoids writing v2 to a project that never used multi-source — minimises diff for existing users.)
- Clips with no `sourceId` stay that way after migration. The resolution rule catches them.

### Why a `sources: SourceVideo[]` array (not `additionalSources`)

- Cleaner long-term: every source goes through the same code path.
- Reordering is easy (drag the source headers).
- Removal is just a `splice`.
- `sources[0]` is the natural "default source" the user asked for.

The `sourceVideo` field is **read on load** for back-compat and **never written** in v2 projects. Old projects stay loadable indefinitely.

### Decisions to lock

- ✅ **`sources` as the canonical array.**
- ✅ **`sourceId` IDs, not indices** (stable across reorder/delete).
- ✅ **Missing `sourceId` resolves to `sources[0]`.**
- ❓ **Project version bump to `2`?** Probably yes, gated on the project actually having a second source — keeps existing single-source `.rmproj` files identical on save. Worth confirming.

---

## 2. Project-store changes

New actions:

```ts
addSource(source: SourceMeta): void           // pushes onto sources, returns id
removeSource(sourceId: string, opts?: { cascade?: boolean }): { ok: boolean; reason?: string }
renameSource(sourceId: string, name: string): void   // optional friendly name override
reorderSources(from: number, to: number): void
setActiveSource(sourceId: string): void        // switches preview mode to source-mode
```

The store also gets:

```ts
selectors:
  getSource(sourceId?: string): SourceVideo | null
  getSourceForClip(clipId): SourceVideo | null
  getSourceForBookmark(bookmarkId): SourceVideo | null
```

`removeSource`:
- If `cascade: false` (default) and the source has any clip or bookmark referencing it → return `{ ok: false, reason: 'in_use' }`. UI shows a confirm dialog.
- If `cascade: true` → also removes referencing clips, their sequence entries, and bookmarks. Triggers an `invalidClipIds` recompute.

`addBookmark` and `addClip` need to learn about the "active source." The store already tracks `previewMode`; we add an explicit `activeSourceId: string` that reflects whichever source is loaded into the preview. New clips / bookmarks bind to that.

### Preview mode tweaks

`PreviewMode` currently has `{ kind: 'source' }` (no source id) — that's fine, but the underlying "which source is showing in the preview" needs a separate field on the store. The active source is independent of preview mode: even when previewing a clip, we know which source it's playing from.

Add `activeSourceId: string | null` to the store. Updated whenever:
- `setSource` (legacy single-source path) or `addSource` returns a new id
- `selectClip(clipId)` — if the clip's source differs, switch active
- `requestSeek(time, sourceId?)` — if the seek targets a different source, switch
- `setPreviewMode({ kind: 'sequence', index })` — if the entry's clip has a different source, switch
- `setActiveSourceId(id)` — explicit user click

---

## 3. UI design

The hardest piece. Three things to handle: **the clip list, the bookmark list, the sequence chips**, and **how the user adds / switches / removes sources**.

### 3.1 Source switcher

Three options considered:

**Option A — Tab strip across the top of the right panel.**

```
┌────────────────────────────────────────────────────────────┐
│ [ Watford v Bristol ] [ Sunday Final ] [ + Add video ]    │
├────────────────────────────────────────────────────────────┤
│ Clips ▼     Bookmarks                                      │
├────────────────────────────────────────────────────────────┤
│  - Goal 1                                                  │
│  - Assist                                                  │
└────────────────────────────────────────────────────────────┘
```

- Active tab = active source.
- Clicking switches the preview and the clip/bookmark lists.
- `+` adds another.
- Right-click tab → rename / remove.

**Option B — Dropdown above the lists.**

```
┌────────────────────────────────────────────────────────────┐
│ Source: [ Watford v Bristol ▼ ]    [ + Add video ]         │
├────────────────────────────────────────────────────────────┤
│ Clips                                                      │
│  - Goal 1                                                  │
│  - Assist                                                  │
└────────────────────────────────────────────────────────────┘
```

- Cleaner with many sources.
- Less obvious that multi-source is supported until the user clicks.

**Option C — Grouped clip list (no switcher; one unified list).**

```
┌────────────────────────────────────────────────────────────┐
│ ▼ Watford v Bristol (3 clips)                              │
│    - Goal 1                                                │
│    - Assist                                                │
│    - Skill move                                            │
│ ▼ Sunday Final (2 clips)                                   │
│    - Goal 2                                                │
│    - Defensive header                                      │
│ [ + Add video ]                                            │
└────────────────────────────────────────────────────────────┘
```

- Everything visible at once.
- Clicking a clip auto-switches the active source.
- Bookmarks need a similar grouping in the Bookmarks tab.

**Recommendation: Option A (tab strip)** for the right panel, **plus a small "source: …" chip in the timeline header** so it's clear what's loaded in the preview/timeline even when the user is in the clip-editor view (which replaces the list).

Reasoning:
- A tab strip is the most discoverable affordance for "this app has multiple things you can switch between." A parent who has one source sees a single tab with the filename — it's immediately clear what they'd get by clicking `+`.
- Tabs avoid the option-C problem where bookmarks have to be grouped too (and a timeline can only show one source's bookmarks).
- The "active source" rule is built into the tab UI — no separate mental model.

### Decisions to lock

- ❓ **Tab strip vs dropdown vs grouped.** Pick one. I'd go tab strip.
- ❓ **Source rename** — does the tab show the filename always, or can the user rename? I'd allow rename (double-click the tab); display the filename by default.
- ❓ **"+ Add video" placement** — last position in the tab strip, or a button next to it? Last-position-in-strip is cleaner.

### 3.2 Clip list — source signalling

Even with tabs, every clip row should carry a small **source badge** (a coloured square or initial) so a clip dragged onto the sequence at the bottom remains identifiable as Match 1 vs Match 2. Each source gets an assigned colour from a small palette (lime / cyan / magenta / orange / red / yellow — same palette as focus markers).

```
┌─────────────────────────────────────┐
│ ▌ Goal 1                            │   ← left edge: source-colour stripe
│   0:34 → 0:41 · 0.5×                │
└─────────────────────────────────────┘
```

The same stripe shows on:
- Clip rows in the right-panel list (always)
- Sequence chips at the bottom (always — different colours = different sources in the same reel)
- The clip-detail header next to the clip name

### 3.3 Bookmark list

Same approach: each bookmark row carries the source-colour stripe. Filtering: by default the Bookmarks tab shows **bookmarks for the active source** (timeline only displays one source). A small toggle at the top — `[ Active source ▼ ] / [ All sources ]` — lets a power user see everything.

### 3.4 Sequence bar

Each sequence chip already has a coloured background. Add a small **source-colour dot** to the left of the chip's number badge — so the parent can see at a glance that the reel pulls from two different matches.

The "Total: 0:42.3" info stays as-is. The "Clip 3 / 5" indicator while playing also stays.

### 3.5 Timeline

The timeline shows the active source's duration and its clips/bookmarks. **It only ever shows one source at a time.** Switching the active source rewrites the timeline.

Above the timeline we add a small source label:

```
Source: Watford v Bristol (1:23:45)    [ ‹ in ›  ‹ out › ]   ...
```

(Combines naturally with the existing clip-name display when a clip is selected.)

### 3.6 Empty state

Unchanged. Once at least one source exists, the editor opens. The empty-state CTA "Open video" calls `addSource` instead of the legacy `setSource` (which we keep as an alias that wraps `addSource` for the renderer's existing call sites).

---

## 4. Preview playback across sources

This is where the architecture gets interesting.

### 4.1 Clip preview and source preview

`<video src>` is bound to `resolveSource(project, activeSourceId).path`. When the active source changes, React re-renders with a new `src` — the `<video>` element reloads (brief flash). Acceptable.

### 4.2 Sequence preview

The hard case. A sequence containing clips from Source A and Source B requires the `<video>` element's `src` to change mid-playback.

**Behavior:**
- On advancing to a sequence entry, check the entry's clip's source. If it differs from the currently-loaded source, swap `<video>.src`, wait for `loadedmetadata`, then `currentTime = clip.in` and `play()`.
- The src-swap is visible as a brief black frame. Acceptable for v1 of this feature — note in the release notes.
- The backing-track `<audio>` element is **unaffected** by the swap (separate element). The sequence music plays continuously across the boundary.

**Edge case:** the very first sequence entry's source might differ from the active source. Same handling — swap then play.

**Implementation:** Preview.tsx already has the seq-advance effect at line 67. It needs to learn the source-swap pattern. Likely a small helper:

```ts
async function loadAndPlay(src: string, time: number) {
  const v = videoRef.current; if (!v) return;
  if (v.src !== src) {
    v.src = src;
    await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true }));
  }
  v.currentTime = time;
  v.play().catch(() => {});
}
```

### 4.3 Source switching from clip preview

`selectClip(otherSourceClipId)` already triggers `setPreviewMode({ kind: 'clip', clipId })`. The Preview effect that seeks-to-in-on-clip-change needs to also do the loadAndPlay dance if the source differs.

### Decisions to lock

- ❓ **Black-frame between sources in sequence playback.** OK for v1, or do we go further (preload next source ahead of time in a hidden video tag)? The preload approach is doable but doubles the video memory footprint. Recommend v1 ships with the simple black-frame; revisit if it bothers users.

---

## 5. Export pipeline

### 5.1 Per-clip export

`exportClip` already takes `source: SourceMeta`. The renderer resolves the clip's source and passes it directly. Trivial.

### 5.2 Sequence export

Today: `exportSequence({ source, clips, sequence, ... })` — a single `source` shared by all parts.

Tomorrow: each clip part needs to render from its OWN source. Two options for the IPC shape:

**Option E1 — `sources: SourceMeta[]` array passed through.**

```ts
interface ExportSequenceArgs {
  ...
  sources: SourceMeta[];     // canonical
  // (drop `source` — or keep as backward-compat alias for sources[0])
}
```

Renderer side: pass all sources. Exporter side: per clip, resolve via the same rule (`clip.sourceId ?? sources[0].id`).

**Option E2 — annotate each clip with its source before passing.**

```ts
interface RenderClipSpec { clip: Clip; source: SourceMeta }
interface ExportSequenceArgs { items: RenderClipSpec[]; ... }
```

Cleaner data on the wire — every part is self-describing. Slightly bigger payload but the renderer already has it all.

**Recommendation: Option E1.** Mirrors the project shape; the resolution logic is well-defined; it leaves room for a future "swap source for all clips" operation that just changes one entry in the array.

### 5.3 ffmpeg builders

`buildClipFfmpegArgs(clip, source, outputPath, opts?)` and the IG variant already take a per-call `source`. No change needed at the builder level. The exporter just calls the builder with the right source per part.

### 5.4 Concat output canvas

Today: `buildFilterConcatFfmpegArgs` takes `source: SourceMeta` and scales every input to `source.width × source.height`. This is the **output canvas size**. With multi-source, what should it be?

**Recommendation:** use `sources[0]` (the project's primary source) as the output canvas. If sources have different dimensions, each clip part is normalised to `sources[0]`'s dimensions during clip render — so by the time they reach concat, they're all the same shape. (This is already how it works for sources at different aspect ratios — `crop=width:height:0:0,scale=W:H` in `buildClipFfmpegArgs` snaps each clip's output to its OWN source's dimensions.)

Wait — that's the bug. Each clip currently scales to ITS OWN source's dimensions. In multi-source sequences, parts could differ in dimensions before they reach the concat filter, and the concat's per-input `scale=W:H,setsar=1` already handles that. So technically it works. But there's a subtle quality cost: scaling 1080p down to 720p in one part, then back up to 1080p at concat, is wasteful.

**Decision:** for v1 of multi-source, accept the small scale-and-rescale cost. If sources turn out to be commonly different dimensions, a future optimisation can pre-compute the output canvas size at render-spec time and pass it down to each clip part.

### 5.5 Outro

The brand outro is sequence-wide. It's already a separate render path (`renderOutroPart`). Unchanged.

### 5.6 Sequence backing track + brightness

Both are sequence-wide and applied at concat time. They're independent of the per-clip source. No change required.

### Decisions to lock

- ✅ **Option E1** — pass `sources: SourceMeta[]` through IPC; exporter resolves per part.
- ❓ **Output canvas size** — accept the v1 cost of per-clip rescaling, or pre-resolve a canvas from sources[0]? Recommend ship v1, optimise later.

---

## 6. Migration story (single-source projects)

Concrete steps when an existing `.rmproj` is opened:

1. Schema parser: `sources` is missing, `sourceVideo` is present → migrate to `sources = [{ id: 'src_<generated>', ...sourceVideo }]`. Keep `sourceVideo` for back-compat read path.
2. Clips and bookmarks have no `sourceId` — they implicitly bind to `sources[0]`.
3. On save: if `sources.length === 1` and **no clip / bookmark has an explicit `sourceId`**, write the project back in **v1 shape** (single `sourceVideo`, no `sources`, no `sourceId`s on clips/bookmarks). Keeps existing files identical byte-for-byte.
4. Once the user adds a second source, future saves write the project in **v2 shape**: `sources` is canonical, `sourceVideo` field is omitted, clips/bookmarks get explicit `sourceId`s when needed.

This means a single-source user upgrading to v0.3.0 sees their project save back in v1 format until they actually use the new feature. No silent format change.

### Decisions to lock

- ❓ **Quiet v1 round-tripping.** Worth doing — keeps `.rmproj` files stable for users who never use the new feature. Confirm.

---

## 7. Other touches

### 7.1 Clip duplication across sources

`duplicateClip` copies a clip. With multi-source, the duplicate inherits the original's `sourceId`. Optionally we could expose a "duplicate to other source" action — but that doesn't make sense because clip.in/out are source-time and don't translate. Skip.

### 7.2 Drag a clip from list → sequence

Already supported. The clip's `sourceId` carries over implicitly via `clipId`. The sequence chip picks up the source colour automatically.

### 7.3 Project save / load tests

`tests/unit/schema.test.ts` needs new cases:
- v1 project with single source → loads, `sources` populated from `sourceVideo`
- v2 project with multiple sources → loads
- v2 project with clip referencing missing source → clip flagged invalid
- Round-trip: v1 in / v1 out when no multi-source usage
- Round-trip: v1 in / v2 out when a second source is added

### 7.4 Integration tests

Two new test fixtures (two short MP4s). Tests:
- `exportSequence` across two sources → output plays both segments
- IG sequence export across two sources → output is 9:16 with correct auto-framing per source

### 7.5 The Veo paste-link (still hidden)

It already calls `setSource` directly, expecting a single-source flow. Once exposed, it should call `addSource` instead — appending to the existing project rather than replacing. Not in scope for this plan.

---

## 8. Implementation order (phased)

The change is sized to ship in three commits / two PRs. Each phase keeps tests green.

### Phase 1 — Data model + migration (no UI change)
- Types: `SourceVideo`, `Clip.sourceId?`, `Bookmark.sourceId?`, `Project.sources`.
- Schema: validator accepts both shapes; load-time migration; round-trip preservation.
- Store: `addSource`, `removeSource`, `renameSource`, `reorderSources`, `activeSourceId`, source-resolver selectors.
- Renderer: replace `project.sourceVideo` reads with `resolveSource(...)` everywhere. Tests pass; no UI difference.
- Preview: `<video src>` reads the active source.

### Phase 2 — UI for source management
- Tab strip in the right panel.
- Source-colour stripes on clip rows, bookmark rows, sequence chips, clip-detail header.
- Empty-state CTA wired to `addSource`.
- Timeline shows the active source's name.
- Add the `+ Add video` flow (file picker → probe → addSource → setActiveSource).
- Remove flow (with cascade confirmation).

### Phase 3 — Export pipeline + sequence playback
- IPC: `sources: SourceMeta[]` through `ExportSequenceArgs`.
- `exportSequence` resolves per-clip source.
- Preview sequence advance does the `loadAndPlay` source swap.
- Tests: new schema cases, new integration tests for cross-source sequence export.

Each phase is self-contained enough that the build stays green between them.

---

## 9. Things I'm explicitly NOT doing in this feature

- Cross-source clip stitching (e.g. half a clip from source A blended into source B). Out of scope.
- Multi-source bookmark merging into a unified timeline. Bookmarks remain per-source.
- A separate audio source — i.e. take video from source A and audio from source B. Out of scope (the backing-track feature covers the related use case).
- Veo paste-link integration. Stays hidden.
- Mac/Linux installer expansion. Separate work.

---

## 10. Open questions for sign-off

Before I touch code, confirm:

1. **`sources: SourceVideo[]` as the canonical model, sourceId IDs, missing sourceId resolves to sources[0].** → expect yes.
2. **Tab strip in the right panel** (Option A) for source switching. → preferred; happy to do dropdown or grouped-list if you'd rather.
3. **Per-source colour stripes** on clip rows, bookmark rows, and sequence chips. → expect yes.
4. **Quiet v1 round-trip** — existing single-source projects save back in v1 format until a second source is added. → expect yes.
5. **Black-frame between sources during sequence playback** is acceptable for v1. → expect yes; revisit later if needed.
6. **Option E1 for the export IPC** — `sources: SourceMeta[]` array, exporter resolves per clip. → expect yes.
7. **Output canvas = sources[0] dimensions for sequence export.** Different-dimension sources are rescaled at the concat pass. → expect yes.
8. **Cascade-remove behaviour** when removing a source that has clips/bookmarks: prompt with `n clips, m bookmarks will be removed — proceed?`. → expect yes.
9. **Source rename** via double-click on the tab. Display the source's basename as the default name. → expect yes.

Once these are locked I'll start with Phase 1.
