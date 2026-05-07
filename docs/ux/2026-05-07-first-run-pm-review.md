# First-run PM review — making "dad creates a reel on first install" likely

**Date:** 2026-05-07
**Audience target:** UK football academy parent installing ReelMagic for the first time, with a multi-minute training/match video on disk, wanting a short Instagram-shaped clip of their kid.

## The journey today

A first-time user goes through this to land a single saved reel:

1. Find "Open video…" in a row of 5 equally-styled buttons (`src/renderer/App.tsx:182`).
2. Realise the thin 32px black bar in the timeline is draggable (`src/renderer/components/Timeline.tsx:143`) — instruction is in dim 13px text.
3. Drag a region, then notice "Add Clip" is now enabled (`src/renderer/components/Timeline.tsx:178`).
4. Click the resulting row in the right panel to drill into it (`src/renderer/components/RightPanel.tsx:37`).
5. Decide between "Export clip…" and "📸 Reel…" (`src/renderer/components/ClipDetail.tsx:53`).
6. Pick a format in another modal.
7. Pick a save path.

That's seven decisions and at least four pieces of unfamiliar vocabulary (project, sequence, zoom region, focus marker). Most first-timers will stall at step 2 or 3.

## What's working against the user (ranked)

### 1. The "make a clip" verb is buried in a drag-then-click-Add three-step
The single highest-leverage fix: a prominent "Start clip" / "End clip" pair, with `[` / `]` shortcuts. Mirrors how `B`-bookmarks already work (`src/renderer/App.tsx:72`). Keeps timeline-drag as a power-user shortcut. Collapses 3 steps to 2 and removes the "what does Add Clip do" puzzle.

### 2. The empty state is flat — five enabled buttons, no hero CTA
New / Open Project / Save / Save As / Open video / ⚙ Settings are all visually equal (`src/renderer/App.tsx:181-187`). On first run only "Open video" matters. Recommendation: when `!project`, render a centred hero with a single big "Open a video" panel; hide New/Save/Save As/Open Project until a video loads. Project save/load is a returning-user concept the buyer doesn't have yet.

### 3. "Open video" vs "Open Project" reads as duplicates to a non-editor
A dad will click "Open Project" first, get a `.reelmagic` file picker that rejects his `.mp4`, lose confidence. Recommendation: collapse project actions into a single "⋯ File" menu, and auto-save as `Untitled.reelmagic` next to the video so Save never needs to be confronted on first run.

### 4. Two export verbs × two scopes = four similar buttons; the right default is hidden
"Export clip…", "📸 Reel…", "Export sequence", "📸 Reel sequence" (`src/renderer/components/ClipDetail.tsx:53-56`, `src/renderer/components/Sequence.tsx:107-115`). Per the buyer profile, almost all first-time users want 9:16 Instagram. Recommendation: make Reel the default primary button — "Make Instagram Reel" — and demote standard export to a secondary "Other formats…" link. (Note: held back pending Instagram upload-quality bug fix.)

### 5. The Sequence bar (96px, 1/8 of vertical) is empty on first run and duplicates exports
It's a power feature shown before the user has anything to sequence (`src/renderer/App.tsx:31` grid-rows). Recommendation: collapse it to a "+ Stitch clips together" strip until ≥2 clips exist, then expand. The "Reel sequence" button only appears once a sequence exists.

### 6. Vocabulary mismatch
The user calls the zoom rectangle "the focus box", but the UI says "Set zoom region" / "Focus markers" / "Track marker" (`src/renderer/components/ClipEditor.tsx:43`, `src/renderer/components/ClipFocusMarkers.tsx:64`). Rename to: "Set focus box", "Track your kid" or "Player tags", and "Follow with mouse" on the Track button. The "📸 Reel…" button doesn't read as Instagram either — most users won't connect 📸 with reels.

### 7. The preview has two control layers fighting
Native `<video controls>` plus our own button strip (−Xs / −1s / ◀ / ▶ / +1s / +Xs / ▭ Reel) overlap the picture exactly where you want to watch (`src/renderer/components/Preview.tsx:337-381`). Recommendation: replace native controls with a single slim custom transport bar at the bottom; drop −1s/+1s (arrow keys cover that for the few who need it); move "▭ Reel" toggle to a corner icon.

### 8. No first-run coachmarks
Once a video loads, nothing tells the user "drag here, or hit Start clip." A two-line dismissable callout on the timeline area solves this with no architectural changes.

### 9. Two different "Backs" in the same panel
"Back to source" on the clip list returns the *preview*; "← Back to clips" on the detail returns the *list* (`src/renderer/components/ClipList.tsx:46`, `src/renderer/components/ClipDetail.tsx:36`). Same word, different action. Rename the first to "Stop preview" or "View full video".

### 10. No undo
Delete-clip / delete-marker are one-click destructive (`src/renderer/components/ClipDetail.tsx:52`, `src/renderer/components/ClipFocusMarkers.tsx:254`). For a fragile first-time user this is risky. At minimum a 5-second undo toast.

## The 80/20 PR

Pick three, ship them:

1. **`[` / `]` Start clip / End clip buttons + shortcuts.** The single biggest first-clip unblocker.
2. **Empty-state hero**: hide everything except a centred "Open a video" CTA when no project is loaded.
3. **Make Instagram Reel the default export** (one primary button, "Other formats…" as a secondary link). Defer Sequence until 2+ clips exist.

That cuts the path from install → saved reel from ~12 clicks across 4 unfamiliar concepts to ~5 clicks across 1 (just "clip"). Every existing power-user path stays intact behind disclosures — no functionality lost.

The main tradeoff: returning users lose the always-visible Save / Open Project buttons. Mitigated by a `⋯` menu on the menubar and auto-naming so Save rarely needs to be hit.

## Status (2026-05-07)

- Item 1 (`[` / `]` Start/End clip): **shipped**
- Item 2 (empty-state hero): **shipped**
- Item 3a (Reel-as-default): **deferred** — held back pending Instagram upload-quality bug fix.
- Item 3b (hide Sequence until ≥2 clips, with thin discovery stripe at 1 clip): **shipped**
- Vocabulary rename (zoom region → focus box, focus markers → player tags, Track → Follow with mouse): **shipped**
