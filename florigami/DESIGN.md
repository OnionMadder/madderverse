# Florigami — Design & Technical Architecture Spec

> **Renamed 2026-07-25: "Petalcraft" → "Florigami"** (flower + origami, matching the torn-paper art direction). Folder + URL moved `petalcraft/` → `florigami/` with a redirect shim at the old path; the `petalcraft-*` localStorage keys were **kept** so saves survive. This doc was bulk-renamed — §1's collision analysis text is *historical* (it audited the original name "Petalcraft"); Florigami's own name-collision check was done at rename time (no game/app collision; the origami-sculpture exhibition "Florigami in the Garden" owns the term in the art space).

*A cozy, web-based flower-breeding game for The Madderverse.*
*Name confirmed: **Florigami** (was Petalcraft). URL: **madderverse.org/florigami/**. Draft: 2026-07-21. Author: design pass for Onion.*

This is a design document only. **No code has been written and no `florigami/` folder has been created in the repo yet** — that happens in a follow-up session.

The game lives at **`madderverse.org/florigami/`**, following the Madderverse flat-shape convention: `florigami/index.html` + `florigami/game.js` + `florigami/style.css` + `florigami/assets/` at the repo root, matching `cookie-cache/`, `slip-studio/`, `friend-picker/`, `georges-jump/`, `bala-draws/`, and `all-munkis/`.

Design north stars: cozy, hand-curated, no timers or fail states, no ads / no IAP-for-play / no subscriptions (Madderverse Promise), genotype hidden by default (accidental discovery), plays fine in a browser tab and later ships as a paid Android app via Capacitor like Slip Studio.

---

## 1. Name — **Florigami** (confirmed)

Onion picked **Florigami** on 2026-07-21. Everything downstream — folder, package id, keystore filename, listing copy, hub grid slot — keys off this name.

- **Folder / URL:** `florigami/` at the repo root, published at `madderverse.org/florigami/`.
- **Package id (Phase 6 Capacitor):** `org.madderverse.florigami`.
- **App display name:** `Florigami`.
- **Full listing title (Phase 6, if we want a subtitle like *Pootery: Throw, Glaze, Fire*):** to be decided closer to the Play upload — the design doc leaves the plain `Florigami` in place.

### Collision check (2026-07-21)

Search-space audit for `"Florigami"` on Google, Steam, itch.io:

- **PetalCraft (Minecraft server)** — `petalcraftmc.com`. A friendly vanilla-plus survival multiplayer Minecraft server. Different product category (server, not a game), different platform (Java Minecraft, not web/Android), different audience (Minecraft players, not casual/cozy gamers). **Not a competitor for Play Store or hub discoverability, but occupies the top Google result for the bare word "petalcraft."** Practical impact: someone Googling our game may land on the server first for a while. Mitigation: consistent "Florigami — cozy flower breeding game" phrasing in meta descriptions, listing copy, and the hub tile so Google's title tag distinguishes us. Not a blocker.
- **No indie game named "Florigami"** on Steam or itch.io (searched both).
- **Petal by Petal** — a real cozy incremental flower-empire indie on Steam (Orquin Games, 90% Very Positive, released March 2026). Distinct name; adjacent genre. Worth being aware of as a comparable / marketing reference, not a legal or discoverability collision.
- **Verdict:** **clear enough to proceed.** No indie collisions with meaningful audience; the Minecraft-server namespace overlap is a minor SEO nuisance we manage with copy, not a rename.

---

## 2. Core mechanics spec

### 2.1 Genetic system

The engine is a faithful reimplementation of the community-documented Animal Crossing: New Horizons flower-breeding model (see §10 for attribution). It is Mendelian and small — a handful of integers per flower.

**Per-species gene counts:**

- **3 genes:** tulips, pansies, cosmos, lilies, hyacinths, windflowers, mums. Genes are `R` (red), `Y` (yellow), `W` (white).
- **4 genes:** roses only. Additional gene is `S` (shade — modulates red/orange/pink saturation and is required to reach black and blue).

**Alleles.** Each gene is a **pair** of alleles. Each allele is `0` or `1`. The pair aggregates into a **strength** of `0` (both recessive, `00`), `1` (heterozygous, `01`), or `2` (both dominant, `11`).

**Genotype representation in code.** For the 3-gene species, a genotype is stored as three integers in `[0..2]`, e.g. `[2, 0, 1]` (RR yy Ww). For roses it's four. In memory a genotype is a fixed-length `Uint8Array` of length 3 or 4. In save state (JSON) it's a compact string like `"201"` or `"1102"`.

**Breeding trigger.** See §2.2 (water) and §2.4 (adjacency). When triggered, two parent flowers of the same species produce one child.

**Offspring generation.** For each gene:
1. Parent A contributes one of its two alleles, chosen uniformly at random (i.e. if strength is 1, 50/50; if 0 or 2, deterministic).
2. Parent B does the same, independently.
3. The child's allele pair is `[allele_from_A, allele_from_B]`, aggregated to a strength `0/1/2`.

**Phenotype (color) lookup.** A per-species table maps every genotype → a color name. Multiple genotypes almost always map to the same color — that ambiguity IS the accidental-discovery mode. Two red tulips can be genetically different and produce different outcomes; the player only ever sees the color and, over time, the pattern.

The exact tables are copied verbatim from Aeter's data-mined tables and the Wiki. The design doc does not reproduce every row (they're long); the engine loads them from `data/genes.js` as JS objects. Sources:

- **Aiterusawato's simulator + tables:** https://aiterusawato.github.io/satogu/acnh/en-us/flowers/index.html (canonical)
- **Joey Parrish's ACNH Flower Guide For Nerds:** https://joeyparrish.github.io/acnh-flowers/ (interactive verifier)
- **ACNH Wiki mechanics page:** https://animalcrossing.fandom.com/wiki/Flowers/New_Horizons_mechanics

**Naming note.** We use the color words (`red`, `yellow`, `white`, `pink`, `orange`, `purple`, `black`, `blue`) that are the standard for these species. We do NOT use AC's specific hybrid nomenclature or any hybrid names invented by Nintendo (see §10).

**Starter genotypes.** Bags of seeds sold in-game (or gifted on day 1) are all **homozygous** — either fully dominant or fully recessive on the color they display. Example:
- **Red tulip seed** = `[2, 0, 0]` (RR yy ww)
- **Yellow tulip seed** = `[0, 2, 0]` (rr YY ww)
- **White tulip seed** = `[0, 0, 1]` (rr yy Ww — this is AC's actual white seed genotype; white tulips are heterozygous in the standard tables)

Homogeneous seed lineages give a repeatable, predictable base for players to breed *away from*. All the strangeness (unexpected purple, rare black) comes from crossing seeds together.

### 2.2 Water mechanic

Every flower has a boolean-ish `watered` flag with three visible states:

- **Dry** (default, morning): matte petals, slightly drooped sprite frame.
- **Watered** (until end of day): brighter petals, a small droplet particle for ~1s after watering.
- **Rained-on** (when rain falls, see §2.3): same as watered, applied to every flower automatically.

**Watering action.** Player taps/clicks a flower to water it. There's no watering can inventory or capacity — infinite water, cozy game. Tapping an already-watered flower does nothing (soft `plip` sound, no error). Watering does NOT need to be "aimed" precisely; the whole grid can be watered by pressing a **"Water all"** button at the top of the screen. That button is provided from day 1 because forced busywork is not cozy.

**Breeding gate.** At end-of-day rollover (§2.3):
- For each pair of adjacent same-species flowers where **at least one** was watered that day → roll for breed (see §2.4 for probability).
- Requiring both watered would punish players who missed a single flower; requiring one keeps intent low-friction. This is a **softening** vs AC's rule (AC requires the *breeder* watered, and enthusiastic crossbreeding requires you to keep both parents watered by convention). Cozy > accurate.

### 2.3 Day/night cycle

**Real-time clock, accelerated 24× by default.** One real-life hour = one in-game day. This is a departure from AC (which uses system clock 1:1) and is deliberate: an accelerated clock means a 15-minute session actually rewards the player with visible progress (new hybrids emerged, seeds sprouted). AC's rhythm assumes the player checks in daily forever; we can't rely on that engagement pattern for a paid web/mobile game.

**Player-tunable in Settings:** the clock speed is a slider (`Realtime`, `4×`, `24×` default, `120×`). Slow is for players who want AC's contemplative rhythm; fast is for "I want to run experiments this afternoon." Default in the middle.

**Day/night effects.**
- **Day (06:00–18:00 in-game):** normal palette, ambient birds/insects loop.
- **Dusk (18:00–20:00):** warm palette tint, fireflies particle around watered flowers.
- **Night (20:00–06:00):** cool palette, subtle crickets loop. Flowers close their petals (single alt sprite frame). Player can still water, plant, harvest — no gated actions at night.

**End-of-day rollover** happens at in-game midnight (00:00). At rollover:
1. Growth stages tick up (seedling → sprout → bud → bloom over 4 in-game days per AC).
2. Breeding rolls per §2.4 for eligible flower pairs.
3. Dry-out: all `watered` flags reset to `false` (unless rain).
4. Rain check: ~15% of days have rain, which pre-waters every flower for that day. Rain is a visual event (particles + softer ambient) not a puzzle.

**No timers, no failure states.** A flower left un-watered for weeks just doesn't breed; it doesn't wilt or die. Withering was considered and rejected on cozy grounds. (See §5.)

### 2.4 Adjacency

**Grid-based.** A rectangular grid of tiles, e.g. `12×8` for phone-portrait or `10×10` for tablet/desktop. Each tile holds either a flower or empty soil (or path/decoration in future phases — v1 is all soil).

**8-neighbor breeding.** For each watered flower, at end-of-day, we look at all 8 surrounding tiles. Any tile containing another watered flower **of the same species** is a candidate. The chance one of these candidates produces an offspring is:

- Base per-eligible-pair chance: **~15%** per day. (AC is 5% base but tuned to be checked daily forever; we accelerate to keep a session satisfying.)
- After ~4 failed attempts, a **pity bonus** stacks (+5%/day up to a 90% ceiling) so no couple ever gets stuck.

If a candidate pair rolls a breed, an offspring flower spawns in a **random empty neighboring tile** of either parent. If no empty tile is adjacent, the breed is skipped for that day (no penalty, will try again).

**Placement.** Player picks up flowers (drag) and drops on empty soil. Flowers can be freely rearranged; there's no cost to move.

### 2.5 Save state

**localStorage only.** Matches Slip Studio and Cookie Cache: everything lives on device, works offline, survives across sessions in the same browser, does not sync between devices. This is compatible with the "collects nothing" Data Safety posture that Slip Studio uses for its Play listing.

Key: `petalcraft-save`. Value: JSON.

Additional keys: `petalcraft-settings`, `petalcraft-seen-onboarding`, `petalcraft-flowerdex`. Split so that resetting the garden doesn't wipe the flowerdex (that's a v3+ feature though — v1 keeps them together).

**Save cadence.** Debounced 500ms after any state change (planting, watering, rearrangement, EoD rollover). Not on every tick.

**Save format spec** — see §6.5.

---

## 3. Species selection

**Starter species at launch (3):** **cosmos, tulips, pansies**.

Why these three:
- All 3-gene systems → simplest engine, no special rose logic yet.
- All produce **purple**, **orange**, **pink**, **black** hybrids from their seed colors — enough color variety to feel rewarding on day 1.
- All are common real-world flowers with familiar names — no learning curve on "what is a windflower?"
- Distinct silhouettes (cosmos = tall daisy-form, tulips = single cup, pansies = flat face) → sprite work is visually varied even at 3 species.

**Unlockable later via progression (in order):**

1. **Lilies** — unlocks after collecting all 8 tulip colors. 3-gene; introduces a more dramatic silhouette.
2. **Mums** — unlocks after collecting all 8 pansy colors. 3-gene; introduces green as a rare color.
3. **Hyacinths** — unlocks after Bloombook is 25% complete. 3-gene; distinctive "spike" shape.
4. **Windflowers** — unlocks after Bloombook is 40% complete. 3-gene; unusual color palette (introduces distinct pink/blue).
5. **Roses** — the endgame species, 4-gene, unlocks after Bloombook is 60% complete. Roses can produce the ultimate rare: **blue rose**. This mirrors AC's endgame — blue roses take real work to breed and their arrival is a game-shaping moment.

**Invented species vs. real:** All species names are real-world public-domain flowers. We do **not** invent species for v1 — the AC species set is intentional, well-studied, and gives us 8 hand-curated species without a lot of work justifying them. See §10.

**Species-specific mechanics that are the same across all:** growth stages (seed → sprout → bud → bloom, 4 days), adjacency rules, watering, breeding. We do NOT introduce per-species minigames or unique breeding conditions in v1.

---

## 4. Progression system

### 4.1 Starting inventory

Day 1 the player gets:
- **3 red cosmos seeds** (`[2, 0, 0]`)
- **3 yellow cosmos seeds** (`[0, 2, 0]`)
- **3 white cosmos seeds** (`[0, 0, 1]`)
- A **6×4** starter garden plot (expands via progression, §4.3)
- A **Bloombook** — the collectible catalog — with cosmos entries blank except for the three seed colors already unlocked (so the player can *see* what they've found and what's left).

Rationale: starting with only cosmos gives the player a single self-contained puzzle for the first ~15 minutes. Tulip and pansy seeds are unlocked shortly after (§4.2).

### 4.2 Unlock schedule

- **Cosmos** available from day 1.
- **Tulips** unlock when player discovers their first cosmos hybrid (i.e. any color that isn't red/yellow/white). A "New seed shipment" chime plays; three tulip seed packets appear.
- **Pansies** unlock when player fills out 5 cosmos slots in the Bloombook.
- **Lilies, mums, hyacinths, windflowers** as described in §3.
- **Roses** last, gated behind ~60% flowerdex.

Everything scales to the player's own pace. There are no daily quests, streaks, energy meters, or timed events.

### 4.3 Bloombook — the flowerdex

The Bloombook is a per-species page catalog. Each species page has a grid of color slots (e.g. cosmos = 6 colors, tulips = 8, roses = 8 including blue and black). Each slot shows either:

- A **silhouette** if not yet discovered ("something goes here").
- The **flower sprite** + the date discovered + a one-line flavor text if discovered.

**Flavor text is where the Madderverse voice lives.** Two or three dry, warm sentences per hybrid, e.g.:

> **Orange cosmos** — First bred: [date]. Two colors that mostly don't want to be near each other, briefly getting along. Common at florists' who like to seem cheerful about it.

> **Blue rose** — First bred: [date]. Absurdly hard to breed on purpose, but here you are. Nobody outside this garden believes you did it.

Flavor text is written by Onion; the design doc puts a placeholder line under each entry in `data/flavor.js`.

**No completion-required-for-play** — the game continues to work indefinitely with any percentage of the flowerdex filled.

### 4.4 Target flowers (goals)

A tiny, non-nagging targets system: **the Bloombook itself is the target list**. There's no separate quest UI. Every empty slot is implicitly a target.

**Optional micro-goals** shown on the main screen (v1 has just one at a time, rotating):
- "Try crossing two colors you haven't yet."
- "Water everything today."
- "Cross-breed a pink."

These are hints, not requirements. Ignoring them does nothing.

### 4.5 Garden expansion

Player unlocks additional plot tiles as the Bloombook fills:
- Start: `6×4` (24 tiles)
- 25% flowerdex: `8×6` (48 tiles)
- 50%: `10×8` (80 tiles)
- 100%: `12×10` (120 tiles) — the sandbox size for post-game.

Expansion is instant on unlock (small celebratory chime, camera zooms out).

### 4.6 Failure states / dead ends

**None in v1.**

- Flowers do not wilt or die.
- Player cannot lose seeds. Seed packets are effectively unlimited (each color the player has bred in that species can be replanted from the seed shop, free).
- No "stuck" states: pity bonus (§2.4) guarantees any adjacent watered pair will eventually breed.

### 4.7 End-game

After 100% flowerdex, the game becomes a pure sandbox. Additional post-game niceties for later phases (not v1):
- **Custom garden decorations** (paths, benches, garden gnomes as static sprites).
- **Seasonal palette shifts** (spring/summer/fall/winter tinting).
- **Photo mode** (export a PNG of the current garden — pattern-matches Slip Studio's photo export).

None of the above blocks v1 shipping.

---

## 5. Cozy game design principles

### 5.1 Aesthetic direction

**Palette.** Warm midtones. Muted saturation. Reference: the "sunlit veil" palette Slip Studio adopted for its gallery (`v122–123` in the Slip notes) — that's the vibe. Backdrops are painterly-flat (single hue with light gradient), NOT photorealistic.

**Illustration style.** Small, hand-drawn-feeling sprites — closer to *Groodle* / *Pootery* than to Slip Studio's 3D. Flowers rendered as flat 2D sprites at ~64px, four growth-stage frames each. Petals are chunky enough to read on a phone.

**UI ornamentation.** Slight rounded corners, warm cream backgrounds (`#F7EFDD` family), single accent color per screen. Fraunces or a similar warm serif for headings (matches Slip Studio v122+); a friendly geometric sans for body (Nunito is a defensible free option). No skeuomorphic wood-grain / dirt textures — those tend to feel cluttered on a phone screen.

**Camera.** Fixed top-down grid, gentle isometric would be tempting but adds sprite-count and z-order pain — recommend straight top-down for v1, revisit later.

### 5.2 Sound design brief

Small SFX set, lazy-loaded like Slip Studio's:

- **Ambient day** — gentle birds + a distant wind chime, loops ~90s.
- **Ambient night** — crickets + occasional owl, loops ~90s.
- **Watering** — a `plip` (single droplet) on tap.
- **Rain** — soft loop when rainy day.
- **Discovery jingle** — a 2-3 second warm chord + rising arpeggio when a new flower goes into the Bloombook. This is the game's most important sound; it's the payoff for hours of accidental discovery. Get this right; everything else can be placeholder.
- **UI tap** — soft wooden thock.
- **Seed plant** — muffled tap + tiny leaf rustle.

**Music.** One 2–3 minute ambient background loop for MVP. Piano + strings + light woodwinds; think *A Short Hike*'s wander music, not Animal Crossing's cheerier jazz. Playable and pausable from the settings menu.

### 5.3 Text tone

Dry, warm, minimal. Kid-friendly but not talking down to kids. Slight self-awareness OK. Reference points: Cookie Cache's "Slice to Slice" hint copy; the tone of the Madderverse hub tagline.

Bad: "Wow!! You did it!!! Amazing job!!!! ⭐⭐⭐"
Good: "New in the Bloombook: pink cosmos."

Bad: "Uh oh! Your flowers are getting thirsty!"
Good: (no such message — nagging is not cozy)

Bad: "Complete your daily quests to earn coins!"
Good: (no such system exists)

### 5.4 What makes it feel cozy vs stressful

- **No timers.** Nothing counts down.
- **No lose conditions.** Flowers don't die. Player can't run out of seeds.
- **No scoring.** No high-score list, no XP bar, no rank.
- **No FOMO.** No limited-time events, no daily login rewards, no streak counters.
- **No forced choice regret.** Actions are undoable in the important moments — placing a flower is free; rearranging is free.
- **The only "progress" is the flowerdex,** and progress is entirely under the player's control.
- **Discovery > efficiency.** Even a "wasteful" breeding pair might produce a hybrid you didn't have. Nothing is wrong to plant.

---

## 6. Technical architecture

### 6.1 Stack decision

**Vanilla JS + DOM/CSS + a small `<canvas>` for the blade… kidding. No blade. Vanilla JS + DOM/CSS, with the grid rendered as CSS-positioned `<div>`s + `<img>` flower sprites.** No Three.js, no React, no build step.

Rationale:
- The whole game is ~120 tiles × a small handful of possible states each. That's DOM-cheap.
- Sprite animation is 4 growth stages × ~8 flowers/species × 8 species = ~256 sprites at most. Bundle them as individual PNGs (like Cookie Cache's sprite frames) — no atlas needed for v1.
- Slip Studio's Three.js is justified because it's a real-time 3D pottery wheel. This game is a top-down grid — Three would be overkill and would hurt startup time on mid-range Android.
- Matches the flat-shape pattern: `index.html` + `game.js` + `style.css` + `assets/`.

**Optional Canvas use.** If particle effects (fireflies, watering droplets, discovery sparkle) become janky with DOM elements, drop a single `<canvas>` overlay for particles only. Not needed for MVP.

**Dependencies.** Zero JS libraries. One Google Font (or self-hosted) for Fraunces + Nunito. That's it.

### 6.2 File structure

```
florigami/
├── index.html                    # entry — links CSS, loads JS, sets meta
├── game.js                       # all game logic (single file)
├── style.css                     # all styles
├── assets/
│   ├── img/
│   │   ├── flowers/              # per-species subdirs
│   │   │   ├── cosmos/           # red-bud.png, red-bloom.png, ...
│   │   │   ├── tulips/
│   │   │   └── ...
│   │   ├── ui/                   # buttons, backdrops, panels
│   │   └── particles/
│   ├── sfx/                      # plip.mp3, discover.mp3, ...
│   ├── music/                    # ambient loop
│   └── favi/                     # per-game favicons (or link the shared set)
├── data/                         # (optional) split if game.js is getting long
│   ├── genes.js                  # phenotype lookup tables per species
│   └── flavor.js                 # Bloombook flavor text per hybrid
├── privacy/
│   └── index.html                # per-app privacy page for Play listing
└── PLAY_STORE_LISTING.md         # written closer to Phase 6
```

The `data/*.js` split is optional. For MVP with 2 species, everything in `game.js` is fine. Split once the file exceeds ~1500 lines.

**No `petalcraft-app/` yet** — the Capacitor wrap folder is created in Phase 6, outside git, like `slip-studio-app/` and `cookie-cache-app/`.

### 6.3 In-memory model (sketch)

```js
const state = {
  clock: { minute: 0, day: 1, speedMultiplier: 24 },
  grid: {
    w: 6, h: 4,
    tiles: [
      // { flower: { species: 'cosmos', genotype: [2,0,0], stage: 3, watered: true }, decorated: null }
      // { flower: null }
      // ...
    ],
  },
  seedInventory: { cosmos: { red: Infinity, yellow: Infinity, white: Infinity }, tulips: {...} },
  unlockedSpecies: ['cosmos'],
  flowerdex: {
    cosmos: { red: { firstSeen: '2026-07-21' }, /* ... other slots unfilled */ },
    tulips: {},
    // ...
  },
  settings: {
    sound: true,
    clockSpeed: 24,
    reducedMotion: false,
  },
};
```

### 6.4 Main loop

```js
// 60Hz for animations, but game logic ticks only when in-game minute changes
requestAnimationFrame(function tick(dtMs) {
  advanceClock(dtMs);
  if (clockMinuteChanged) {
    onMinuteTick();      // sprite pulse, particle updates
    if (clockDayRolledOver) onDayRollover(); // growth, breeding, dryout
  }
  renderGrid();
  renderAmbient();
  requestAnimationFrame(tick);
});
```

`renderGrid` diffs — only updates tiles whose flower state actually changed. Watered highlight is a CSS class toggle, not a re-mount.

### 6.5 Save format spec

Stored at `localStorage["petalcraft-save"]` as a JSON string. Schema:

```json
{
  "version": 1,
  "savedAt": "2026-07-21T14:32:00.000Z",
  "clock": { "minute": 743, "day": 12 },
  "grid": {
    "w": 6, "h": 4,
    "tiles": [
      { "s": "cosmos", "g": "201", "st": 3, "wet": 1 },
      { "s": "cosmos", "g": "112", "st": 2, "wet": 0 },
      null,
      null
    ]
  },
  "unlocked": ["cosmos", "tulips"],
  "dex": {
    "cosmos": { "red": "2026-07-19", "yellow": "2026-07-19", "white": "2026-07-19", "pink": "2026-07-20" }
  }
}
```

Notes on the schema:
- `g` (genotype) is a string of digits `"0"|"1"|"2"` per gene. `"201"` = RR yy Ww for a 3-gene species. Roses would be 4 chars.
- `st` is stage `0` (seed) through `3` (bloom).
- `wet` is `0` or `1`.
- `null` = empty tile.
- Settings, seedInventory, and onboarding-seen live under separate keys so a "reset garden" doesn't nuke them.

**Migration.** `version` field lets Phase-2+ additions (settings-in-save, decorations, etc.) migrate cleanly from v1 saves. Write a `migrateSave(state)` from day 1 even though it's a no-op; adds it forever after.

### 6.6 Analytics + hub conventions

- Include the GoatCounter beacon on `index.html`:
  `<script data-goatcounter="https://madderverse.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`
- Include the year footer boilerplate.
- Absolute production URLs for `canonical`, `og:*`, `twitter:*`, and favicons.
- Relative paths for game CSS/JS (`href="style.css"`, `src="game.js"`).
- Ad-free, kid-friendly branding in meta.

### 6.7 Capacitor wrap (Phase 6)

Follow the Slip Studio and Cookie Cache pattern exactly:

- Folder `petalcraft-app/` **outside git**, sibling to `florigami/`.
- Minimal deps: `@capacitor/core` + `@capacitor/android` only. **No RevenueCat**, no billing plugin — this is a paid app.
- Package id `org.madderverse.florigami`.
- App display name = the branded short name (see §1 pick).
- `www/index.html` is an app-stripped copy: no GoatCounter, no `Back to Madderverse` home button, no site footer. `game.js` and `style.css` are the same file, verbatim.
- Immersive fullscreen in `MainActivity.java` (same as Slip Studio v22 rollout).
- Release keystore in `petalcraft-app/android/app/petalcraft-release.keystore`, PKCS12, 10000 days, DN matches Mad Sundar LLC / Minneapolis.
- Build with JDK 21 (`invalid source release: 21` otherwise); `bundleRelease` for Play, `assembleRelease` for sideload testing.
- Rebuild recipe documented in the `CLAUDE.md` sidebar for this game, once shipped.

Portrait orientation, in contrast to Slip Studio's landscape wheel — a phone-portrait garden feels right.

---

## 7. Build phases

Hour estimates are **coder-hours by a familiar-with-the-codebase developer**, not "actual delivery time." Multiply by 1.5× for calendar time if working evenings.

### Phase 1 — MVP engine (**~10 h**)

- Set up flat-shape files (`index.html`, `game.js`, `style.css`, `assets/`)
- Genetic engine: allele model, breeding formula, phenotype lookup, tables for cosmos + tulips
- Grid state + rendering (DOM, ugly placeholder colored circles for flowers)
- Plant seed → seed → sprout → bud → bloom growth stages (accelerated for dev testing)
- Manual "advance day" debug button
- Water action on a flower
- Breeding rolls at day-rollover
- **Milestone:** hand-plant a red + yellow cosmos, water both, advance day, see an orange cosmos appear.

### Phase 2 — cozy game feel (**~10 h**)

- Real-time day/night clock with speed multiplier
- Day/night visual tint (CSS variable animation)
- Rain event + rain visuals
- localStorage save/load with the v6.5 schema
- First real art pass (paid Fiverr / Onion draws): 2 species × 4 stages × 3 colors = 24 sprites minimum
- Ambient day/night SFX loops
- Watering `plip` SFX

### Phase 3 — progression + collectibles (**~9 h**)

- Bloombook UI (species pages, silhouette-vs-discovered slots)
- Discovery jingle + Bloombook slot fill animation
- Unlock schedule wired: tulips-after-cosmos-hybrid, pansies-after-5-cosmos-slots, etc.
- Third starter species (pansies) added, tables loaded
- Garden expansion tiers (`6×4` → `8×6` etc.)
- Seed shop UI (any color you've bred, replantable)
- Micro-goals hint on main screen

### Phase 4 — polish (**~8 h**)

- First-run onboarding overlay (Slip Studio coach-mark pattern: hand image + captions, one-time per screen)
- Settings screen (sound toggle, clock speed slider, reduced-motion toggle)
- Music loop
- Full sound pass
- `prefers-reduced-motion` gating
- Accessibility: keyboard support for the grid, `aria-label`s on flowers
- Discovery flash + gentle vibration on Bloombook fill

### Phase 5 — remaining species (**~8 h**)

- Lilies, mums, hyacinths, windflowers phenotype tables loaded
- Rose engine — 4-gene extension, black + blue rose in phenotype tables
- Additional sprite art (5 more species × 4 stages × ~8 colors ≈ 160 sprites) — this is Onion or paid art, not code
- Unlock gates wired for each
- Bloombook flavor text pass (48 hybrid entries × 2-3 sentences each)

### Phase 6 — Android paid app (**~6 h, plus Onion's Play-Console-side work**)

- Create `petalcraft-app/` sibling folder, outside git
- Capacitor Android platform, minimal deps
- Package id, keystore, DN
- www-strip pass on `index.html`
- Immersive theme
- App icon (1080×1080 source → mipmap set via `@capacitor/assets`)
- `PLAY_STORE_LISTING.md` in the web game dir (full description + What's new + ASO notes + screenshot shot list, following the Slip Studio + Cookie Cache pattern)
- Privacy page at `/florigami/privacy/` (nothing collected, localStorage-only)
- First AAB, sideload verification
- Onion uploads to Play Console → paid $0.99 → apply for Teacher Approved on the Kids + Family surface

**Total design-doc estimate: ~51 hours over all six phases.** Realistically 55–65 with iteration and unforeseen bugs.

Phases 1–3 are the "game exists" milestone (~29 h). Phases 4–6 are "game ships as paid app" (~22 h).

---

## 8. Asset inventory

### 8.1 Sprite art

**Per species per color per stage** — the bulk of the art work.

- **Seed** stage: 1 shared sprite per species (or shared for all species — a small brown seed, palette-swap by species accent).
- **Sprout** stage: 1 per species (a green shoot; species-shape difference minor).
- **Bud** stage: 1 per species-color combo (bud color = eventual bloom color).
- **Bloom** stage: 1 per species-color combo (the real sprite work).
- **Night bloom** stage: 1 per species (closed-petal version, palette-tinted).

Estimate:
- 3 species × ~6 colors × 2 (bud + bloom) = **36 unique sprites** for MVP + 2 shared stages per species.
- Growing to 8 species × ~8 colors × 2 = **128 unique sprites** at full release.

Sprite dimensions: 64×64 at 1× (for phone-portrait), export at 128×128 for retina.

**Placeholder pass acceptable for Phase 1–2** (colored circles / crude shapes). Real art required by Phase 4 to feel worth $0.99.

### 8.2 UI art

- Bloombook page background (parchment texture)
- Seed packet illustration (single reusable template, palette-swapped)
- Button set (water-all, plant, settings) — 3–5 icons
- Backdrop/sky elements for day/night/rain tinting

### 8.3 Audio

Sourceable from Pixabay / rawpixel / Epidemic Sound like Slip Studio:

- 2 ambient loops (day, night) — ~90s each
- 1 music loop — 2–3 min
- 5–7 SFX clips (plip, discovery jingle, seed-plant, UI tap, rain, chime, expansion)

Total audio budget: ~5 MB compressed after MP3-32k or Opus.

### 8.4 Fonts

- **Fraunces** (headings + Bloombook titles) — free, matches Slip Studio's warm serif
- **Nunito** (body + UI) — free, warm geometric sans

Either use Google Fonts (fast, but sends a request to Google) or self-host `.woff2` files under `assets/fonts/` (~150 KB total, works offline, better for the Play app). Recommend self-hosting for Phase 6.

### 8.5 Placeholder-vs-real matrix

| Asset | MVP (Phase 1) | Ship (Phase 4) |
|---|---|---|
| Flower sprites | Colored circles | Real hand-drawn |
| Growth-stage variants | Skip (all bloom) | 4 stages each |
| Backdrops | CSS gradient | Painterly PNG |
| SFX | None | Full set |
| Music | None | 1 loop |
| Icons | Emoji / text | Real UI icons |
| Bloombook page | Grid of divs | Illustrated page |

---

## 9. Explicit non-goals for v1

Stated so they don't creep in mid-build:

- **No gene visibility UI.** Accidental discovery is the whole design. No Punnett-square display, no "genotype: `[1, 0, 2]`" text, no color-percentage predictions. Player learns patterns by observation only. (Debug console shows genotypes for the developer; production strips this.)
- **No ads.**
- **No IAP-for-play.** No paid seed packs, no paid Bloombook slots, no paid land expansions. Once someone pays $0.99, the game is theirs. Web build is free forever, positioned as the trial.
- **No subscriptions.**
- **No multiplayer, no leaderboards, no friend-visits.** Nothing that requires a server. Pure single-player.
- **No login / account system.**
- **No procedural species.** Species and hybrids are hand-curated, drawn from the AC-documented set.
- **No procedural hybrid *names* either.** Colors are just colors ("pink cosmos") — no invented "Belladonna" flavor names.
- **No cross-device save sync in v1.** localStorage-only, per-browser. If Onion wants sync in a later version, it goes on `v2` — not v1.
- **No timers, wilt states, death, or hunger.** See §5.
- **No pest / weather-damage mechanics.** Rain is nice-only.
- **No trading with players or NPCs.** Even a fictional shopkeeper's a scope creep.
- **No pause / undo of day-rollover.** Time moves forward.
- **No dark mode toggle.** The day/night cycle IS the dark mode.
- **No non-English localization for v1.** English only. Translations are a Phase-7+ effort.

---

## 10. IP / attribution

**The game is inspired by Animal Crossing: New Horizons' flower-breeding mechanic but is an independent reimplementation.** The Mendelian-genetics model is a real-world biological framework, not proprietary. The specific per-species phenotype tables that map genotypes to colors were reverse-engineered from AC:NH by the community (primarily Aeter via data mining; refined and published by Aiterusawato and others). Those tables describe an implementation of a real genetic model with specific parameters — Nintendo's, as documented by fans.

**What we borrow:**
- The three-gene / four-gene split (roses are 4).
- The specific allele → color mappings, per species, as documented by the community.
- The species set (roses, tulips, pansies, cosmos, lilies, hyacinths, windflowers, mums) — all real-world public-domain flowers.

**What we do NOT borrow:**
- No AC:NH art assets, sprites, sound, or music.
- No character names (no Isabelle, no K.K. Slider, no NPCs referencing AC's cast).
- No AC-specific location or lore terminology (no "Nook" anything, no "bells," no "island").
- No AC-specific branded hybrid *nomenclature* if any exists (all hybrid slots in the Bloombook are named plainly, e.g. "orange cosmos," not any invented AC name).
- No use of AC's specific UI language ("Nook Miles," "the DIY workbench," etc.).

**References cited in code comments** (in `data/genes.js`):

- **Aeter** — original AC:NH flower-genetics data mining (Discord `Aeter#9823`, credited across community guides).
- **Aiterusawato** — canonical simulator and lookup tables at https://aiterusawato.github.io/satogu/acnh/en-us/flowers/index.html
- **Joey Parrish's ACNH Flower Guide For Nerds** — https://joeyparrish.github.io/acnh-flowers/
- **Animal Crossing Wiki (Fandom) — Flowers/New Horizons mechanics** — https://animalcrossing.fandom.com/wiki/Flowers/New_Horizons_mechanics
- **jmaxwellsdemon Mendelian-Genetics-for-Dummies primer** — https://jmaxwellsdemon.wordpress.com/2020/05/21/flower-breeding-animal-crossing-new-horizons-mendelian-genetics-for-dummies/

The Play Store listing description credits "inspired by the flower-genetics puzzle in Animal Crossing: New Horizons" in the About section — a hat-tip in prose, not a trademark reference. Do not use "Animal Crossing" or "AC:NH" in ASO keywords.

---

## Appendix — Open questions for Onion before Phase 1

Non-obvious calls this doc has made that deserve a sanity check before building:

1. **Accelerated clock (24× default).** AC purists might want 1:1 real time. My call is accelerated because a paid mobile game needs to reward a 15-minute session with visible progress, and I'd rather give players the slider than force them to check in daily forever. **Confirm?**
2. **Watering gate = only one parent needs watering** (§2.2). AC is stricter. My call is cozy > accurate. **Confirm?**
3. **No withering.** AC's flowers don't wilt either — but this is worth stating in writing so it doesn't creep in later ("what if a flower dies after 30 days un-watered?"). **Confirm no.**
4. **Genotype hidden but *hint system* possible in later phase.** If Onion later wants a "science mode" toggle that reveals genotypes for kids studying Mendel in school, that's a v2 setting — easy to add later without redesigning. Just noting the door's open.
5. **Roses in v1 or v2?** Design puts roses in Phase 5, meaning they ship with v1.0. If Phase 5 slips, we can ship v1.0 with 7 species (no roses) and rose them in as v1.1. Roses are the endgame; scope-wise they can be deferred. **Prefer to ship WITH or WITHOUT roses at 1.0?**
6. **Starter grid `6×4` (24 tiles).** Feels right on portrait phone; verify on the actual test device. Might want `5×5` or `4×6` depending on aspect ratio. Sizes are trivially tunable.
7. **Rain is 15% of days, cosmetic-only.** Rain never punishes the player; it just skips a water step. Confirm this feels right or if you'd rather rain be more meaningful (e.g. bonus breeding chance on rainy days).
8. **The two-red-flowers problem.** Two red tulips that LOOK identical can be genetically different (e.g. `[2,0,0]` vs `[2,0,1]`) and produce different offspring when bred together. This IS the "accidental discovery" mystery — but it's non-obvious and can feel *unfair* to a player who doesn't know why. My call is to lean into it (that's the whole game). But Onion should know that first-time players *will* be confused; the tutorial and coach marks need to soft-land the idea that "some flowers just carry secrets." **Any nervousness about this? Options: (a) accept, cozy-mystery framing; (b) show a "generation" number so at least players see something varying; (c) reveal a tiny "carrier" hint on hybrids the player has produced multiple of.** My rec is (a).

---

*End of design document. Name locked (Florigami). Next session: scaffold the `florigami/` directory and build the Phase-1 genetic engine.*
