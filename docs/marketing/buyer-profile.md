# ReelMagic — Buyer Profile

**Date:** 2026-05-01
**Status:** Initial draft from founder interview (awaiting written review)
**Source:** Founder interview — the founder is the target buyer (parent of two boys at Cassiobury Rangers JPL and top-tier Watford FC PDC, U13 → U14 in 2026-27 season)

## Persona Snapshot

**Archetype:** *"Football Dad with Pathway Boys"*

- Father, ~35-50, embedded in football culture for years
- Multiple sons inside the football pathway:
  - Competitive grassroots (e.g., Cassiobury Rangers in the Junior Premier League)
  - Pre-academy / development programmes (e.g., top tier of Watford FC's PDC)
- **Age band of relevant boys: U9 to U17.** Founder's own boys are U13 → U14 next season — squarely in the **Youth Development Phase (U12-U16)**, the most scout-active window of the pathway.
- Location: UK, weighted toward South East and Midlands where Cat 1/2 academies cluster
- Tech comfort: moderate — installs DaVinci, manages local files, can download club Veo recordings. Not a videographer, and resents being treated like one.
- Spending power: routinely £100s/month on training, kit, travel. A £25/year app is rounding error.
- **Already inside the system** — this is *retention and progression*, not aspirational/hopeful from outside. Different from generic "kid wants to be a footballer" personas.

**Self-identified one-liner:** *"A dad who wants to quickly cut up a video."*

## Job-to-be-Done

> *When my son plays a match (recorded by Veo, occasionally an iPhone), I want to extract the moments that show him at his best, present them as a clean reel a scout would actually watch, and post it where scouts will see it — so my boys get academy opportunities.*

Three layers:
- **Functional** — turn 60-90 minutes of wide-angle Veo footage into a 60-90 second showreel
- **Emotional** — advocacy for my child; doing what I can to support his career
- **Social** — visible to scouts on platforms they actually use (Facebook today; Instagram per-boy planned)

**Source video reality:** Veo recordings are owned by the club. Parents only get the **download** — Veo's editing tools are not available to them. Occasional iPhone footage from the sidelines. ReelMagic's job is to make the parent's downloaded mp4 actually useful.

## Triggers (what makes them seek a solution)

- A great match was filmed and the moment is fresh
- A scout shows interest and a reel is suddenly needed at short notice
- New football season starts — annual mental moment for kit, subscriptions, fresh start
- Frustration peaks after another failed attempt in DaVinci or CapCut
- Seeing other academy parents post polished reels (competitive pressure)

## Current Alternatives & Why They Fail

| Tool | Why the dad-buyer tries it | Why it fails for him |
|------|----------------------------|----------------------|
| **DaVinci Resolve** | Free, "real" editor | Built for trained videographers; timeline stacking, audio panels, codec/framerate exposure all overwhelm; tracking a moving player is *"extremely complicated"*; output can come out poor *"and you don't know why"* |
| **CapCut** | Mobile-first, feature-rich | Overstuffed; bait-and-switch on export (*"you've struggled to get something made then discovered you can't export — it really annoys you"*); not built for long Veo sources |
| **Doing nothing** *(de-facto current solution)* | Fallback when other tools defeat him | The job is abandoned — *"only 3 or 4 the entire season"*; *"it's been so hard to do that it just doesn't get done"* |

**Critical insight:** the real competitor is not a piece of software — it's **inaction**. The buyer isn't slowly making the reels he wants. He isn't making them at all. ReelMagic doesn't win on "faster than DaVinci" — it wins by **unblocking a job that has been completely abandoned**.

## Decision Criteria (what wins the sale, priority order)

1. **"Just works" without video-tech knowledge** — no codec, framerate, or timeline to learn
2. **Built for the specific job** — extracting clips from a long Veo, not a general-purpose editor
3. **Reliably good output** — no opaque failures
4. **Fast workflow** — bookmark plays in one pass, set in/out, add zoom/slow-mo, done
5. **Runs on my machine** — kids' footage stays local; no upload latency
6. **Predictable, fair pricing** — no surprise paywalls

## Anti-Features (purchase-killers)

- **Bait-and-switch on export** — strongest turn-off (the CapCut wound)
- **Cloud upload of match footage** — kids' footage stays local; only export-count metadata may travel for licence checks
- **Account / login required for value delivery** — *softened* by the freemium decision: email-only signup is acceptable for licence tracking and the free tier, but should be the lightest possible (no password if magic-link works, no pre-ticked marketing boxes)
- **Codec / framerate settings exposed** — the DaVinci trap
- **AI features I didn't ask for** — feature bloat
- **Watermarks on the output** — undermines the scout-facing professionalism
- **Surprise paywalls after time invested** — the free first reel is genuinely free; expectations about the second export must be set explicitly during the first one

## Pricing Model & Willingness to Pay

**Decided 2026-05-01: Freemium → flat annual.**

- **Free tier:** First reel is free for any signed-up account. No length cap, no watermark, no quality tax.
- **Referral mechanic:** +5 free reels per parent referred who actually exports their first reel (not just signs up — prevents email-farm abuse).
- **Paid tier:** **£25/year flat** for unlimited reels for the football season. No tiers at launch (founder may add tiers later).
- **Anchor for copy:** *"Dads are often spending a fortune on training"* — £25/year is rounding error against the £100s/month on coaching, kit, travel, club overhead.
- **Critical UX rules:** pricing visible upfront; the free reel is genuinely free with no surprise paywall after time invested; the second-export expectation is set explicitly during the first export.
- **Future tier opportunity:** £40-60/year with **intro/outro cards baked in** (the explicit wishlist feature). Position-specific templates (defender / midfielder / striker / GK) as a future hook.
- **Backend requirement:** licence-checker API for signup, licence issuance, export tracking, and referral credit. Implementation: small backend (Cloudflare Worker + KV or Vercel + Postgres) called by the Electron app at export time.

## Built Feature Set (current as of 2026-05-07)

Features the buyer can rely on today, ordered roughly by importance to the JTBD:

- **Focus markers with player tracking** — drop a marker on a player and follow them across the pitch with the cursor while the video plays at a tunable slow rate (default 0.5×). The outline animates along the recorded path on the preview *and* the exported reel. Each marker can be a rectangle or oval, in any of seven colours, with an optional name label. **This directly replaces the buyer's "extremely complicated" tracking pain in DaVinci.**
- **Multiple markers per clip** — highlight more than one player in the same play (goalscorer + assist; defender + striker). Each marker has its own colour, shape, label, and visibility window.
- **Focus box (static zoom)** — crop a wide Veo frame onto the action when tracking isn't needed; pulls every kid out of the wide-angle dot.
- **Bookmarks** — single-pass scrub: hit B during playback, return later to cut clips from those moments. Maps directly to the buyer's *"bookmarking interesting plays"* phrase.
- **Speed control + frame and second nudges** — slow skill moments down; step the playhead by exactly one frame or one second when marking precise in/out points.
- **Sequence builder + single-file sequence export** — assemble a reel from multiple clips and export as one mp4.
- **Brand outro append** — optional outro file appended to every export.
- **Instagram (9:16 Reels) export with auto-tracking** — the same clip exports as a vertical Reel that auto-follows the marked player the whole way through with smoothed pan and zoom. Live preview canvas inside the export modal so framing is verified before render. Optional separate 9:16 outro file in settings (the standard outro is rescaled if no 9:16 version is provided).

## Wishlist Features (drives next roadmap)

Wanted, not yet built:
- **Title / intro card** — name, age/DOB, position, jersey number, height, school year
- **Outro / contact card** — coach name, club, contact email
- **Position-specific reel templates** — defender / midfielder / striker / GK
- **Square (1:1) and Portrait (4:5) feed exports** — pipeline is already aspect-aware; adding presets is mechanical
- **Per-clip Instagram framing override** — when the auto-track gets a moment wrong, manually nudge the IG crop on a clip without retracking the marker

## Distribution Channels (where to find them)

- **Football parent Facebook groups** — JPL parents, academy parents, Cat 1/2 club fan groups. The buyer publishes here today.
- **Instagram** — per-player accounts and academy-tag content. Clusters: #footballscout, #youthacademy, #JPL, individual club tags.
- **Veo user community** — partnerships and content placement; Veo's user base *is* this buyer's club ecosystem.
- **JPL / Sunday League parent WhatsApp groups and club forums**
- **Grassroots coach networks** — coaches recommending to parents
- **Educational content marketing — the primary wedge.** The user's own admission that *"I don't have a good distribution strategy yet"* is universal among football parents. Topic clusters:
  - *"How to make your son's showreel"*
  - *"What U14-U16 scouts actually look for"*
  - *"From Veo download to Instagram in 30 minutes"*

  Every prospect is in the same gap — content acquires them, and the product enables them.
- **Football agents and intermediaries** — they sit at the scout-flow; pro tier prospect.

## Secondary / Adjacent Personas

1. **Grassroots / Sunday League head coach** — team and player reels for the club; **club tier opportunity**
2. **Older youth player (U16-U18)** — managing their own reels independently of parents
3. **Football agent / intermediary** — packages showreels for client families; **pro tier**
4. **Cat 3-4 academy parents** — same JTBD, earlier in the pathway
5. **Released-from-academy parents** — extreme urgency, highest willingness to pay
6. **Adjacent sports** (rugby, basketball, hockey, lacrosse, netball) — secondary expansion
7. **US showcase-tournament parents** — equivalent dynamic; high WTP; later expansion market

## Marketing-Ready Verbatim Quotes

Preserve exactly — these are headline-grade in the user's own voice. Use for hero copy, ads, testimonials, landing pages:

- *"A dad who wants to quickly cut up a video"* — persona definition
- *"Add the effects that matter in the context of showing to a scout"* — purpose-built positioning
- *"You end up with poor quality and you don't know why"* — opaque-failure pain
- *"Tracking a moving player is extremely complicated"* — competitor weakness
- *"It took me hours and the output was poor"* — current-tool pain
- *"This put me off doing it"* — abandonment narrative
- *"Only 3 or 4 the entire season"* — quantified inaction
- *"It's been so hard to do that it just doesn't get done"* — the killer line for hero
- *"Bookmarking interesting plays"* — natural workflow language
- *"Dads are often spending a fortune on training"* — pricing anchor

## Messaging Hooks (headline candidates)

- **Built for football dads, not videographers**
- **From Veo to scout — in minutes, not hours**
- **Stop letting his best matches go unseen**
- **Every Veo deserves a showreel**
- **The reels you keep meaning to make — finally made**
- **Made for the job. Not for everything else.**
- **U14-U16 is when scouts are watching. Be ready.**

## Open Questions for Validation

To stress-test this profile before scaling marketing spend:

1. Is the £25/year + freemium model converting visitors? Conversion rate from free signup → paid upgrade?
2. Is the referral mechanic generating signups (5-free-per-referral)? Average referral count per active free user?
3. How large is the addressable market (UK U9-U17 academy-pathway parents alone)?
4. Does the "educational content as wedge" theory work — do prospects engage with showreel-tutorial content?
5. Do coaches and clubs become a viable B2B channel, or is direct-to-parent the only route?
6. At what age band does buyer urgency peak? Hypothesis: U13-U16 as the scholarship window approaches.
