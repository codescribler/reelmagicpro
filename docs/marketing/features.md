# ReelMagicPro — Feature Reference

**Date:** 2026-05-12 (Instagram 9:16 export marked hidden again 2026-05-12 PM)
**App version covered:** 0.2.0 (released 2026-05-12)
**Audience:** Marketing site copywriters, founder, anyone updating reelmagicpro.co.uk
**Source:** Direct read of the shipping app + release notes through v0.2.0
**Sister docs:**
- `docs/marketing/buyer-profile.md` — who the buyer is and what hurts
- `docs/marketing/homepage-copy.md` — the current StoryBrand page

This file is the **source of truth for what the product actually does today**. Copy on the site should be derivable from here. If you find yourself writing a claim the site is going to make, it has to be substantiated by a feature in this document. If it isn't, either the feature ships first or the copy comes out.

Use gender-neutral player language throughout (*your child / them / the player* — not *your son / him / boys*). Do not write testimonials in the founder's voice or imagined customers — see the *No-Fakes Pledge* at the bottom.

---

## TL;DR — the elevator pitch (rewritten for v0.2.0)

ReelMagicPro turns the wide-angle Veo match download into a scout-ready showreel without any timeline / codec / audio-panel knowledge. Mark moments with bookmarks during a single playback. Cut clips. Track the player and the frame follows them across the pitch. Crop tight, slow the skill moments down, add a backing track, dial the brightness, export as a single mp4 ready for WhatsApp, email, the scout's inbox, or any social channel. Footage stays on your machine.

**One-liner:** *Built for football, not Hollywood — every feature exists to make a 60-second clip a scout will watch.*

---

## How features map to the buyer's workflow

The app is organised around the parent's actual sequence of decisions on match day:

1. **Get the match in.** Open the Veo download.
2. **Find the moments.** Scrub once; bookmark anything worth a look.
3. **Cut the clips.** Mark in/out on each moment. Fine-tune later.
4. **Make each clip land.** Track the player, crop tight, slow the skill bit down, add music.
5. **Assemble the reel.** Drag clips into a sequence; reorder; preview.
6. **Polish.** Dial brightness on the whole reel. Add a sequence-wide song. Append a brand outro.
7. **Export.** A single 16:9 mp4 for WhatsApp / email / the scout's inbox / Instagram / wherever the reel needs to go.

The clip editor surfaces the per-clip work as a numbered strip: **1. Track → 2. Zoom → 3. Slow-mo → 4. Sound**, with an *Advanced* drawer at the bottom for power users. The sequence bar at the foot of the window carries all the reel-level controls: music, brightness, length info, playback, export.

---

## Feature catalogue

Each entry: **what it is** · **what it solves for the buyer** · **headline phrasing you can use**.

### Section A — Get the match in

#### A1. Open a video
- **What:** File-pick any `.mp4 / .mov / .mkv / .webm`. No project wizard, no codec/framerate prompts. The app probes the file and lands the parent on a clean playback screen with the timeline below and an empty clip list on the right.
- **Solves:** *"You end up with poor quality and you don't know why."* The DaVinci first-screen overwhelm is gone.
- **Headline phrasing:** *Drop in the match. One file. No setup.*

#### A2. `.rmproj` project files
- **What:** Save / load the editing state to a single `.rmproj` file on the parent's disk. Includes clips, sequence, bookmarks, music choices, brightness — everything except the source video, which is referenced by path. Opens on next launch via Recent or double-click in Explorer.
- **Solves:** Half-finished reels can be parked and resumed across the season without re-marking from scratch.
- **Headline phrasing:** *Pick it up where you left off — every match, every season.*

### Section B — Find the moments

#### B1. Bookmarks (single-pass scrub)
- **What:** Press `B` during playback and the current moment is bookmarked. Bookmark list lives in the right panel; click one to jump the playhead back to that frame. Bookmarks are not clips — they're sticky-notes for the moments you'll cut from.
- **Solves:** *"Bookmarking interesting plays"* — the buyer's own phrase. Replaces the *"watch the match three times to find the moments"* pattern.
- **Headline phrasing:** *Scrub once. Bookmark anything that matters. Come back and cut.*

#### B2. Frame and second nudges on the playhead
- **What:** Step the playhead forward or back by exactly one frame, or one second, while paused. Buttons in the timeline; also keyboard.
- **Solves:** Lands on the exact frame the contact starts / the ball leaves the boot — without scrubbing approximation.
- **Headline phrasing:** *Step a single frame at a time. Cut on the moment, not near it.*

### Section C — Cut the clips

#### C1. `[` and `]` marking
- **What:** While playing, `[` marks the start of a clip; `]` marks the end and saves it. Each marked clip lands in the clip list on the right and opens automatically in the editor so the parent can name it and refine. Alternatively, drag a range on the timeline.
- **Solves:** Cuts come out of the playthrough itself — no separate timeline-stacking step.
- **Headline phrasing:** *Mark the start. Mark the end. You've got a clip.*

#### C2. Frame-accurate nudge of in / out points *(new in 0.2.0)*
- **What:** When a clip is selected, the timeline shows `‹ in 0:01.23 ›  ‹ out 0:05.34 ›` with small back/forward buttons. Each click moves the boundary one frame; **Shift+click** moves ten frames. The preview seeks to the new boundary and pauses so the parent can see the exact frame they're cutting on. The clip's focus markers re-clamp into the new range automatically.
- **Solves:** *"I wanted to start the clip three frames earlier and there was no way to do it without remarking the whole thing."*
- **Headline phrasing:** *Fine-tune the in and out points one frame at a time.*

#### C3. Clip list and reselection
- **What:** Every cut clip is a row in the right panel with its name, duration, and quick-actions (export, duplicate, delete). Click to load it into the editor.
- **Solves:** Multiple clips per match without losing track of which is which.

#### C4. Rename clips
- **What:** Auto-named *Untitled clip 1*, *Untitled clip 2*… (italicised so the parent knows to replace). Click to rename inline. Multi-line names supported.
- **Solves:** *"Which one was the goal?"* — clips are findable in the list by name.

### Section D — Make each clip land

This is the per-clip editor, presented as a numbered four-step strip at the top of the clip-detail panel:

```
Tag a player, crop in, slow it down, add music. Each step builds on the last.
[ 1 Track ]  →  [ 2 Zoom ]  →  [ 3 Slow-mo ]  →  [ 4 Sound ]
```

Each step lights up green with a ✓ once it's been done. Click a step to jump to its panel.

#### D1. Step 1 — Track player(s) (focus markers with motion tracking)
- **What:** Drop a marker on the player and follow them across the pitch with the cursor while the video plays slow (default 0.5×). The marker's path is recorded; the outline animates along that path in the preview *and* the export.
- **Markers can be:**
  - **Rectangle or oval** outline
  - **Any of seven colours** (yellow / red / lime / cyan / magenta / orange / white)
  - **Optionally labelled** with the player's name or number — burned in beneath the outline at export
  - **Time-windowed** — appear and disappear at specific moments within the clip
- **Multiple markers per clip:** highlight goalscorer + assist; defender + striker. Each gets its own colour, shape, label, and visibility window.
- **Primary marker:** in clips with more than one marker, one is the **primary**, signalled in the UI with a star. (Drove the 9:16 auto-crop while that export was exposed; preserved in the data model for when it's re-enabled.)
- **Solves:** The buyer's strongest stated pain — *"tracking a moving player is extremely complicated"* in DaVinci. ReelMagicPro reduces it to "follow with the mouse."
- **Headline phrasing:** *Drop a marker. The frame follows them.*

#### D2. Step 2 — Zoom in (focus box)
- **What:** Draw a rectangle on the source frame; only that region appears in the export, rescaled to fill. Pulls a single player out of a 60-yard-wide wide-angle. If the clip also has a tracked marker, the focus box can follow the marker (so the crop tracks the player instead of staying static).
- **Solves:** Veo's wide angle reduces every kid to a dot. The focus box fixes that without a separate cropping tool.
- **Headline phrasing:** *Pull the action out of the wide angle.*

#### D3. Step 3 — Slow-mo
- **What:** Speed slider 0.25× → Normal (1×). Presets at 0.25×, 0.5×, Normal. Below 1× the source audio is silenced (because pitch-shifted slow audio sounds wrong) — clearly stated in the UI.
- **Note on naming:** The control was previously called *Speed* and included faster-than-1× presets. Renamed to **Slow-mo** in 0.2.0 with the >1× options removed, since the use-case is always "make the moment land," never "speed it up."
- **Solves:** Skill moments get the breathing room a scout needs to see them.
- **Headline phrasing:** *Slow the moment down so it lands.*

#### D4. Step 4 — Sound (per-clip backing track) *(new in 0.2.0)*
- **What:** Drop an MP3 / M4A / WAV / AAC / OGG over a clip. Three controls:
  - **Volume** (0–100%; defaults to 60%)
  - **Mute source video sound** (default on — typical use is "replace the pitch noise with music")
  - **Hint:** at slow-mo speeds the mute is forced on (source is already silent), with a line in the UI explaining why
- **The track fades out cleanly in the final half-second of the export** so it never ends on a hard cut.
- **Preview audio:** When you hit Replay, the music plays in sync with the video at the right speed — what you hear is what the export will produce.
- **Solves:** Most match audio is unusable (wind, crowd, parents). A backing track turns a clip from rough into shareable.
- **Headline phrasing:** *Add music. Mute the sideline. The track fades out at the end.*

#### D5. Advanced — Brightness *(new in 0.2.0)*
- **What:** A collapsible *Advanced* drawer at the bottom of the clip editor. Currently holds a brightness slider (–50% → +50%). Applies to the preview and the exported clip.
- **Why a drawer:** First-run parents shouldn't have to think about colour correction. The drawer stays closed until they need it; when an adjustment is in place, the closed drawer's pill shows e.g. `brightness +20%` so they know it's in play.
- **Solves:** Veo recordings shot under floodlights, in fog, or against the sun frequently need a small lift before they look like a finished reel.
- **Headline phrasing:** *Dial the picture brighter or darker without leaving the app.*

#### D6. Replay clip
- **What:** Top-right of the clip editor (next to **Export clip**). Rewinds to the in-point and plays — including the backing track at full volume — so the parent can verify the clip end-to-end before exporting.
- **Solves:** "Did I actually get the in-point right?" without committing to an export.

#### D7. Duplicate / Delete
- **What:** Inline buttons in the clip-controls box. Duplicate is useful when the parent wants two angles or two versions (e.g. slow-mo and full-speed) of the same moment.

### Section E — Assemble the reel

#### E1. Sequence builder (drag-to-build, drag-to-reorder)
- **What:** A horizontal strip across the bottom of the window. Drag clips onto it to build a reel. Drag chips inside it to reorder. Click any chip to start sequence playback from that point. The little × on each chip removes it from the sequence (the clip itself stays in the library).
- **Solves:** A reel is a sequence, not a single clip. Building it should feel like arranging photos.

#### E2. Sequence length info *(new in 0.2.0)*
- **What:** A small label on the sequence bar showing total playback duration (e.g. `0:42.3 total`). Sums each clip's *output* duration — so a 10-second source segment at 0.5× speed counts as 20s, matching what the export will produce.
- **Solves:** *"How long is my reel?"* — visible at a glance, no maths.

#### E3. Active-clip spotlight in sequence playback *(new in 0.2.0)*
- **What:** When the sequence is playing, the currently-playing chip glows with a slow radiating halo behind it (a soft pulse, accent-green). A small `▶ Clip 3 / 5` indicator appears alongside the total-length label.
- **Solves:** *"Which one am I watching right now?"* — the parent can follow the playhead through the reel without watching the timeline.
- **Headline phrasing:** *See exactly where you are in the reel.*

#### E4. Click-to-play-from-here
- **What:** Click any chip in the sequence to start playback from that clip.
- **Solves:** Reviewing the middle of the reel without sitting through the start.

#### E5. Clear sequence
- **What:** Removes all chips from the sequence in one click. Clips themselves are kept in the library — the operation is non-destructive.

### Section F — Polish the whole reel (sequence-level)

These all live on the sequence bar so they apply to the reel as a whole.

#### F1. Sequence-wide backing track *(new in 0.2.0)*
- **What:** A small **+ Music** pill on the sequence bar. Click it to pick an audio file; click again (when set) to open a popover with **Change…**, **Remove**, **Volume**, and **Mute source video sound**. The track plays continuously across every clip in the reel — *not* restarting at each clip boundary — and fades out in the final half-second.
- **Overrides per-clip music** when set, so the user gets one song for the whole reel rather than jarring cuts between per-clip tracks.
- **Live preview:** the track plays during sequence playback at the chosen volume, exactly as it will in the export. Drag the slider while playing — the volume updates live.
- **Solves:** Most reels want one song over the whole thing. Per-clip music is for one-off social clips; sequence music is for the showreel.
- **Headline phrasing:** *One song. The whole reel. Fades out at the end.*

#### F2. Sequence-wide brightness *(new in 0.2.0)*
- **What:** A small **⚙** gear pill on the sequence bar opens a popover with a brightness slider (–50% → +50%). Applies to the entire export, stacked on top of any per-clip brightness. Live preview.
- **Solves:** *"All the matches I shot this week were lit weirdly."* Lift the whole reel without touching each clip.
- **Headline phrasing:** *Adjust the picture across the whole reel in one move.*

#### F3. Brand outro append
- **What:** Optional outro video file (set in Settings) is appended to every export — at the chosen aspect ratio. Lets the parent put a sign-off card or contact slate at the end of every reel.
- **Solves:** Reels need a sign-off. Burning one in by hand for every export doesn't happen; an automated append does.

### Section G — Export

#### G1. Single-clip export (16:9)
- **What:** **Export clip…** from the top of the clip editor opens a save-as dialog. The clip is rendered with the parent's chosen zoom, tracking, slow-mo, music, and brightness, plus the brand outro if set. Output is a standalone `.mp4` ready for WhatsApp, email, Drive — the scout's inbox.
- **Solves:** One clip, one share. Doesn't require building a sequence.

#### G2. Sequence export (16:9)
- **What:** **Export sequence** on the sequence bar renders the whole reel — every clip in order, plus the optional outro, all in a single `.mp4`. Per-clip backing tracks and brightness are baked in; the sequence-wide music and brightness apply on top.
- **Solves:** The full showreel as a single file.

#### G3. Instagram (9:16) export with auto-tracking *(currently hidden in the UI)*
- **Status:** **Hidden in the shipping UI as of 2026-05-12 PM.** The pipeline is built and functional, but the export option is not exposed in the current build. **Do not reference in marketing or guide copy** until re-enabled.
- **What it does when enabled:** One click exports the clip — or the whole sequence — as a vertical 1080×1920 Reel. The 9:16 crop **auto-follows the marked player** across the clip with a smoothed pan and zoom, computed from the marker's path. No manual keyframing. A live preview inside the export modal shows the framing before render so the parent can verify nothing important is being cropped out.
- **Optional 9:16 outro:** a separately-specified vertical outro can be set in Settings; if absent, the standard outro is rescaled and letterboxed.
- **Solves (when re-enabled):** Instagram is where per-child accounts post; a horizontal reel doesn't fit. Auto-framing is what makes this not a chore.
- **Headline phrasing (when re-enabled):** *Same clip, vertical, auto-framed.*

#### G4. Progress + cancel
- **What:** Exports show live progress (rendering parts, concatenating). The Cancel button stops cleanly — no half-files left behind.
- **Solves:** *"How long is this going to take?"* with an honest answer, and the ability to back out if needed.

#### G5. Watermark
- **What:** Every export carries a small *"Made with reelmagicpro.co.uk"* product credit (top-left, ~2% of frame height).
- **Marketing decision pending:** the founding-member / paid tier may export without it. See `homepage-copy.md` open item 4.

### Section H — Trust, infrastructure, account

These don't sell features but they substantiate the buyer's *"runs on my machine / footage stays local"* criterion.

#### H1. Local-first processing
- **What:** All editing and rendering happens on the parent's machine. The source video never leaves the device. The only data that travels off-device is licence-server traffic (account, activation, export-count, referral credit) — never the footage itself.
- **Marketing phrasing:** *Your child's match never leaves your machine.*

#### H2. Licence + activation
- **What:** Email-only signup. Activation via the licence server. The app continues to work in a grace period if the licence check is offline. Past-due grace state is signalled with a non-blocking banner; the editor stays fully usable.
- **Solves:** *"Account / login required for value delivery"* is an anti-feature (per buyer profile). The freemium + magic-link-light approach softens it; the first reel is genuinely free.

#### H3. Auto-update
- **What:** electron-updater. Releases ship as a Windows installer (`ReelMagic-Setup-X.Y.Z.exe`) and update manifest (`latest.yml`); installed copies pick up new versions on the next launch. Mac and Linux are not yet built (see `docs/RELEASING.md`).

#### H4. `.rmproj` file association on Windows
- **What:** Installer registers `.rmproj` so double-click opens the project in ReelMagic. Custom icon for the file type.

### Section I — Veo paste-link (currently hidden)

- **What:** A "Paste a Veo link" flow that fetches the page, scrapes the video URL, downloads the recording, and probes it as a source. **Hidden in the UI as of v0.1.3** (commit `9937933 chore(ui): hide Veo paste-link and Instagram export options`). The Instagram 9:16 export was briefly un-hidden post-v0.1.3 but has been hidden again as of 2026-05-12 PM (see G3). The Veo paste-link remains parked pending validation that Veo URLs are stable enough to rely on.
- **Status:** Built, not exposed. Mention in copy only if the founder decides to re-enable.

---

## Feature → buyer-pain mapping (for headline drafting)

A copy-friendly cross-reference. Pick the buyer-quote and pair it with the feature that defeats it.

| Buyer quote / pain (from `buyer-profile.md`) | Feature that defeats it | Suggested copy hook |
|---|---|---|
| *"Tracking a moving player is extremely complicated."* | D1. Focus markers with motion tracking | *Drop a marker. The frame follows.* |
| *"You end up with poor quality and you don't know why."* | A1. Open a video / no codec exposure | *No timelines. No codecs.* |
| *"It took me hours and the output was poor."* | C1, D1–D4 — purpose-built clip editor | *Built for the job. Not for everything else.* |
| *"Bookmarking interesting plays."* | B1. Bookmarks | *Scrub once. Bookmark anything.* |
| *"Only 3 or 4 the entire season."* | Whole product positioning | *Every Veo deserves a showreel.* |
| *"It's been so hard to do that it just doesn't get done."* | Whole product positioning | (Hero pull-quote.) |
| *"You've struggled to get something made then discovered you can't export."* | G1–G3 — exports are free at the free tier | *The free reel is genuinely free.* |
| *"Cloud upload of kids' footage"* (anti-feature) | H1. Local-first | *Your child's match never leaves your machine.* |
| *"Bait-and-switch on export"* (anti-feature) | G1–G3 + transparent pricing | *No surprise paywalls. Pricing visible upfront.* |

---

## What's new in 0.2.0 (use this for the release-announcement post)

Headline (one line): *Music, brightness, frame-accurate cuts, and a much clearer clip editor.*

In order of likely interest:

1. **Backing tracks** — per-clip and sequence-wide. Volume, mute-source toggle, half-second fade at the end of the export. The sequence track plays continuously across every clip.
2. **Brightness adjustment** — per-clip and sequence-wide. Stacks. Applies to preview and export.
3. **Frame-accurate in/out nudge** — `‹ ›` buttons on the selected clip's boundaries in the timeline. Shift+click for ten frames. Preview seeks to the new boundary so you can verify the exact frame.
4. **Clearer clip editor** — new `Track → Zoom → Slow-mo → Sound` progress strip at the top of the editor with check marks for what you've done. *Track your kid* renamed to *Track player(s)*. *Speed* renamed to *Slow-mo* with the unhelpful fast-forward options removed.
5. **Sequence reel signals** — total length info above the action buttons, and a glowing halo behind the currently-playing chip so you can see exactly where you are in the reel.
6. **Critical export fix** — installed copies were exporting with *"ffmpeg exited with code null"*. Fixed (was a packaged-app file-path issue).

---

## Wishlist features — **NOT yet built**

Do not write site copy that implies these exist. Keep this list separate from anything customer-facing.

From `buyer-profile.md` and conversation since:
- **Title / intro card** — name, age/DOB, position, jersey number, height, school year. Burned into the start of the export.
- **Outro / contact card** — coach name, club, contact email. Beyond the current "append a video file" outro feature.
- **Position-specific reel templates** — defender / midfielder / striker / GK.
- **Square (1:1) and Portrait (4:5) feed exports** — pipeline is already aspect-aware; adding presets is mechanical.
- **Per-clip Instagram framing override** — manually nudge the auto-track when it gets a moment wrong.
- **macOS and Linux installers** — Windows-only at present. Mac path needs Apple Developer ID + notarisation.
- **In-app re-enablement of the Veo paste-link** — built, hidden.

---

## No-Fakes Pledge (carry this through to every piece of copy)

The buyer's anti-feature list (per `buyer-profile.md`) includes pre-ticked marketing checkboxes, bait-and-switch, and AI features the user didn't ask for. The site copy and marketing material must extend that to:

- **No fabricated testimonials.** Real quotes only, with consent. Use the founder's own words (he is the buyer) where useful, but framed as a founder voice, never as a "happy customer."
- **No fake user counts.** *"Used by 5,000 football dads"* — do not write until it's true.
- **No fake urgency.** *"Only 3 founding-member spots left."* No.
- **No fabricated scout endorsements.** Until a real scout is on record.
- **Feature claims must point to this document.** If a claim is not substantiated here, it doesn't ship.

---

## Open questions to settle before the next site refresh

1. **Watermark** — does the paid tier export clean, or does the credit stay? The current homepage copy commits to *free tier carries credit, paid tier exports clean* (homepage-copy.md, open item 4). Lock or revisit.
2. **Backing-track music licensing** — the site should clarify that the user supplies their own audio file. *We don't ship a music library.* This avoids any rights ambiguity.
3. **Sequence-wide brightness vs. per-clip stacking** — the current UI describes this with the line *"Stacks on top of any per-clip brightness"*. Worth a tiny illustration in the marketing copy: a brightened clip + a brightened sequence = doubly brightened.
4. **Veo paste-link** — re-enable for the marketing site's *"From Veo to Instagram in 30 minutes"* educational content (per buyer-profile distribution plan), or leave hidden? Locked code, business decision.
5. **Mac/Linux mention** — current homepage says *"Runs locally on Windows, Mac, and Linux."* Only Windows ships today. Either soften to *"Windows today; Mac and Linux coming"* or build Mac before the next refresh.

---

## Where this file should drive a site update

If the marketing site is being refreshed against v0.2.0, the priority changes are:

1. **Add the new marquee features to *Section 3: What You'll Get* in `homepage-copy.md`:**
   - A music card (per-clip + sequence-wide, fades out)
   - A brightness card *(or fold into a single "Polish" card alongside slow-mo)*
   - Frame-accurate nudge *(optional — probably a power-user feature for the FAQ rather than the homepage)*
2. **Update the 3-step plan (Section 5)** to mention the music step explicitly — current copy is *clip, mark, zoom, slow it down, export* and should become *clip, mark, zoom, slow it down, add music, export* (or roll it under "polish").
3. **Soften the Mac/Linux mention** until those installers actually ship.
4. **Refresh the screenshots / hero image** to include the new clip-editor stepper strip — it's the most obviously "purpose-built" piece of UI the parent will see in the first minute.
5. **Resolve the watermark line in pricing copy** when pricing is reintroduced.

End of feature reference.
