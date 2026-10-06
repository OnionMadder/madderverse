# Slip Studio — free download + one-time Pro unlock (DRAFT for Onion)

**Status:** split + price DECIDED by Onion 2026-10-05 (see "Decisions").

**Build progress (2026-10-05):**
- ✅ Phase 1 gating — web v249. `FREE_*` lists + `available*()` above
  `state`; `__slip.simulateFree(true)` + reload previews the free tier.
- ✅ Phase 2 parent gate + Phase 3 billing JS — web v250. "For grown-ups"
  landing link (app-only, hidden until RC answers), Pro card counted from
  the tables, purchase / restore / already-owned auto-restore.
- ✅ Phase 4 native — `SlipInstallPlugin.java` (firstInstallTime) registered
  in `MainActivity`, BILLING permission, `@revenuecat/purchases-capacitor`
  13.7 in `slip-studio-app/` (outside git). Debug build compiles; Billing
  **8.3.0** resolved.
- ✅ Phase 5 store setup (2026-10-06) — RC project **Slip Studio**
  (`0caf9922`), Play Store app `appf0357fc910`, public key in main.js
  (web v251). Play product `slip_studio_pro` $1.99 (purchase option
  `buy`) ACTIVE — Play only allowed creating it after **vc28 / 2.9.0 went
  to Internal testing** with the BILLING permission. RC product
  (non-consumable) → entitlement `pro` → offering `default`
  (`$rc_lifetime` package). Service account
  `revenuecat@pootery.iam.gserviceaccount.com` granted Slip Studio (4 perms).
  Play RTDN on → `projects/pootery/topics/Play-Store-Notifications`, all
  one-time products. JSON key uploaded → RC **Valid credentials**,
  product **Published**; RC connected to the topic and a Play test
  notification was received (2026-10-06 01:58 UTC). ⏳ Remaining: a
  license-tester purchase from the Play-installed internal build.
- ⏳ Phase 6 — set `LEGACY_CUTOFF_MS` to the switch date, re-sync www,
  bump versionCode, build, test a purchase from an internal-testing
  install, release, flip price to Free.

## Why

The numbers on 2026-10-05, same developer account, same no-marketing
posture:

| App | Model | Installed |
|---|---|---|
| Tiny Canvas | free + 99¢ Pro | **42** (doubled in ~5 weeks; Play actively recommending it, 46% store conversion) |
| Pootery | free + paid packs | 3 |
| Slip Studio | **paid 99¢ up front** | **2** |
| Cookie Cache | paid up front | 0 |

Slip Studio is the deepest app in the catalogue and the paid wall means
almost nobody gets far enough to find that out. The web build at
madderverse.org/slip-studio/ is already free and complete — it's the
trial — but nobody on Play sees it.

## The rules (carried over from Tiny Canvas, unchanged)

> "we never ever remove the value from the 'lowest common denominator'
> audience. every kid should be able to play the game, period."

- **Tools, colours and core mechanics are free. Pro is content abundance.**
  Nothing that's free today on the paid app gets *worse* for a free user
  in a way that makes the free app feel like a demo.
- **No padlocks, greyed rows or "Pro" badges in the kid's flow.** Pro
  packs are simply absent from the free app's pickers. The upgrade lives
  behind a **parent gate in Settings**, where a grown-up goes looking.
- **One unlock, one SKU** (`slip_studio_pro`). Every future pack lands in
  Pro automatically; no catalogue to keep in sync.
- **The web build keeps everything**, as now (`isPro()` is true off-native).
- No timers, no nags, no "you've made 5 pots, upgrade!" prompts. Ever.

## Proposed split

| Dimension | Total | **Free** | **Pro adds** |
|---|---|---|---|
| Sculpting — pull, alter, facets, scallop, trim, rim styles (5) | — | **all** | — |
| Handles, lids (4 lid styles), sets | — | **all** | — |
| Decorate tools — brush, splatter, slip, carve, wax resist, motif, overlay, tile, band, undo | — | **all** | — |
| Decoration paint colours (4 packs × 8) | 32 | **all** (colours are tools) | — |
| Finishes — glossy / matte / lustre | 3 | **all** | — |
| Firings — electric, wood, soda, raku; re-fire; kiln loads | — | **all** (it's the replay mechanic) | — |
| Gallery, Display mode, showroom, collections, pot sharing | — | **all** | — |
| Test-tile wall + recipe journal | — | **all** | — |
| Noticeboard letters | 12 | **all** (it's story, not content) | — |
| **Starter shapes** | 11 | vase, bowl, cup, bottle, jar, mug, **teapot** (7) | egg, planter, goblet, bud vase (4) |
| **Glaze packs** (8 each) | 6 / 48 | Studio, Modern, Stoneware (24) | Garden, Jewel, Sorbet (24) |
| **Dip gradient packs** (6 each) | 5 / 30 | Sky, Sea (12) | Ember, Garden, Earth (18) |
| **Motif packs** (6 each) | 7 / 42 | Sumi-e Animals, Dutch Berries (12) | Sumi-e Plants, Dogs, Roman, Egyptian, Mythical (30) |
| **Allover pattern packs** | 4 / 25 | Shima-shima (6) | Enamel, Frescoes, Art Nouveau (19) |
| Band friezes | 1 pack / 6 | **all** (only one pack; the Band tool needs something) | future band packs |
| Study shelf forms | 10 | **all** (it's a system) | — |
| **Backdrops** | 6 cats / 18 | Studio (3, already bundled) | Art, Botanical, Digital, Paper, Motion (the on-demand downloads) |

Roughly **half the content free, all of the craft free.** A free user can
throw, alter, handle, lid, dip, carve, wax, fire in a wood kiln, re-fire,
pack a kiln, answer letters, study forms and share pots — they just have
fewer glazes, motifs and starting shapes to do it with.

**Decisions (Onion, 2026-10-05) — don't relitigate:**
1. **Pro price: $1.99**, one-time.
2. **Teapot is FREE** — the distinctive shape is the hook, not the paywall.
3. **Stoneware glazes are FREE** — they carry most of the named glaze
   chemistry, so the test-tile wall stays rewarding for free players.
4. **Study shelf is ALL FREE** — treated as a system, not content.

## Existing buyers keep everything — the hard part

Play never tells the app who bought a paid app, so after the switch a
past buyer and a new free user look identical. Plan:

- **First-install-time check (primary).** Android records
  `PackageInfo.firstInstallTime`, which survives every update. A few lines
  in `MainActivity.java` hand it to the web layer; if the app was first
  installed **before the switch date**, that device is a buyer → Pro
  unlocked forever (written to the existing local Pro flag + Preferences
  mirror). This works even for buyers who never open the transition build
  before the switch — an update keeps the original install time.
- **Reinstalls / new phones (fallback).** A reinstall after the switch
  gets a fresh install time. Those buyers email support@madderverse.org
  and get a **Play promo code for `slip_studio_pro`** (free to issue).
  With roughly a dozen lifetime sales this is a handful of emails at most.
- **Family Library** members of a buyer also had the paid app; they get
  Pro by the same install-time rule. That's fine.
- A plain note in the vc release notes and listing: *"Bought Slip Studio
  before? Everything you had stays unlocked."*

## Teacher Approved — risk to check first

Changing monetization may send the app back through Teacher Approved
review. In-app purchases are allowed for Families apps **if** they're
parent-gated and not pushed at kids, which this design does. Worth
reading Google's current Families/Teacher Approved IAP rules once before
committing, and keeping the listing's Data safety answers consistent
with Tiny Canvas's (RevenueCat validates purchases server-side).

## Build order (each phase stops cleanly)

1. **Gating layer** — `isPro()` (web: always true), per-pack `free: true`
   flags on the tables above, filter functions that hide Pro packs from
   pickers (Tiny Canvas's `availableStampPacks()` pattern). Saved pots
   that use Pro content still **load and display** on a free install —
   gating only affects what can be *chosen*, never what's already made.
2. **Parent gate** — Slip Studio has none yet. Same two-digit-addition
   gate Tiny Canvas uses; guards the upgrade card and any external link.
3. **Billing** — `@revenuecat/purchases-capacitor` (Capacitor 8 / RC 13,
   matching Pootery + Tiny Canvas, so Billing 8 from day one); one `pro`
   entitlement; Pro card + Restore in Settings.
4. **Legacy buyers** — `firstInstallTime` bridge in `MainActivity.java`,
   cutoff date constant in `main.js`.
5. **RevenueCat + Play setup** — the two steps that silently broke Tiny
   Canvas for six weeks: add Slip Studio to the
   `revenuecat@pootery.iam.gserviceaccount.com` service account in Play
   Console (view financial data + manage orders), upload its JSON key to
   the new RC app, connect RTDN with **all one-time products**. Then a
   real license-tester purchase from a **Play-installed** copy before
   production — never a sideload.
6. **Release + switch** — ship the build, then flip the price to Free in
   Play Console the same day. Listing copy updated to the free + Pro
   framing (and no "free" in the short description).

## Not in scope
- Changing anything about the web build's content.
- itch.io build (stays the paid standalone there).
- Ads, subscriptions, consumables — never.
