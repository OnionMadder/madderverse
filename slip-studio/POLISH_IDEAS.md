# Slip Studio — polish ideas & nice-to-haves

**Rewritten 2026-07-28 against web v196.** The previous version of this file was written 2026-07-02 at v2.2 and went badly stale: by the time it was next read, most of its headline recommendations had already shipped, and one of its remaining items (trim SFX) was wrong. It was being treated as a backlog when it had become a historical document.

This rewrite is scoped to **minor polish and nice-to-haves** — no new mechanics, no new stages, no monetization changes, no rework of the "meditative / no upsells" positioning. Every claim below was checked against the v196 source, not against the old doc.

**Read §0 before adding anything here.**

---

## 0. How to keep this file honest

- **State the version** you verified against, and re-verify before trusting an item. A polish list ages faster than the code.
- **Check the code, not this file.** Both stale items in the last edition would have been caught by one `grep`.
- **When something ships, move it to §1** with its version number. §1 exists to stop the same idea being re-proposed every few months.
- Anything in **§4 is a decision, not an oversight.** Don't relitigate without new information.

---

## 1. Already shipped — do not re-suggest

The 2026-07-02 doc's three "best wins" and nearly all of its small-effort list are done.

**Onboarding & first run**
- Per-stage guiding-hand coach marks (replaced the proposed static hint overlay), with a "How to play" replay on the landing.
- First-visit "Pick a starter shape" caption on the landing.
- Coach captions cover the v179–v185 shaping tools, and the pills breathe once on first sight — `slip-seen-shape-tools` (v186).

**Feel & feedback**
- Save micro-celebration: flashbulb + Save icon → checkmark + haptic.
- Haptic ticks on control taps.
- Wheel-hum ramp-in from silence on Begin.
- Trim SFX — **already wired**; `maybeSquelch()` fires on trim-down *and* trim-move. The old doc's "trimming is silent" claim was wrong.

**Gallery & photo**
- Descriptive photo filename: `slip-studio-<shape>-<glaze>-<date>.png`.
- Auto pot titles on save ("Bud vase in Ocean"), tap-to-rename.
- Newest-first sort (`b.ts - a.ts`), shelf/grid toggle, glaze-tinted hairline.
- Confirm-modal on delete.
- 4:5 photo aspect, photo "Preview" pill.
- Named collections / shelves (v184) — covers most of what "gallery filter" was asking for.
- Empty shelf illustrates shape → fire → save (v193).

**Shaping**
- **Wet-stage sculpting undo (v196)** — bounded 10-deep ring of the geometry subset (`profile`, `displace`, facets, scallop, rim style, height, `lidMaxY`), one step per drag, plus every discrete tap. `#shapeUndo` in the wet toolbar. Deliberately a *separate* history from Decorate's: different surfaces, different stages.

**Robustness & a11y**
- WebGL context-loss recovery (v187) — the old doc filed this as a "larger, later" item.
- Draft autosave + "Continue this one?" on relaunch (v188), IndexedDB rather than the proposed sessionStorage.
- `prefers-reduced-motion` honoured in JS, not just CSS (v192).
- Focus trap + focus restore + Escape across all five dialogs (v192).
- Carve aim ring; canvas grab/grabbing → crosshair cursors (v193).

**Structural**
- `init()` boots from the bottom of `main.js` (v189), which killed the init-TDZ class of bug outright. See CLAUDE.md.

---

## 2. Still open — verified against v196

Ranked by return-per-effort. **S** = <1 h, **M** = 1–3 h, **L** = 3–8 h.

### Worth doing next

- **Trim undo at leather** [S] — the one sliver the v196 sculpting undo deliberately left out. `trimToward` mutates `profile` at the leather stage, and Decorate's undo doesn't cover geometry, so a bad trim is still unrecoverable. The machinery already exists — it needs a `pushShapeHistory()` at the trim branch of `onPointerDown` and a decision about which Undo button owns it (the deco tray already has one at that stage; two Undo buttons on one screen would be worse than the gap).
- **Signed-and-dated foot stamp** [M] — Not present (no `footStamp`/`signature`). A small "SS · YY.MM" impressed into the foot ring, visible from beneath or in the museum-plinth photo style. Pure analogue-craft flourish; fits the "you made a thing" ethos and costs nothing at runtime.
- **Museum-plinth title caption** [M] — `PHOTO_STYLES` ships the plinth style, but there's no title option (no `photoTitle`/`withTitle`). An opt-in "with title" toggle drawing the pot's name in Fraunces small-caps would make the export read as a gallery card. One extra tap, nothing forced.

### Smaller

- **Music "now playing" chip** [M] — `MUSIC_TRACKS` picks randomly per session and nothing ever says which track. A 2 s low-opacity chip on first play satisfies the curiosity without adding transport controls.
- **Desktop keyboard shortcuts** [S] — Only Escape and the confirm dialog's Enter/Escape are bound. `S` = save, `R` = reset-via-confirm would help web trialers. Strictly optional; must not shadow typing in the rename prompt.
- **Begin-button idle pulse** [S] — A 2 s pulse after ~6 s idle on the landing, first visit only. Never fires for returning users.

### Assess before building

- **Gallery free-text search** [M] — Collections (v184) already handle "find my things". Only worth it once someone actually has 40+ pieces; premature otherwise.
- **Ambient music mood picker** [M] — Three tracks already exist; letting the player choose calm/bright/evening on the landing reuses them intentionally. Small, but adds a decision to a screen whose whole job is to get out of the way.

---

## 3. Larger / later

- **Pot-throwing session replay** [L+] — record the sculpt path, play it back as a short clip from wet clay to fired glaze. Real share value; doubles the state model. Long horizon.
- **Backdrop pack download UX** [M] — the on-demand download exists; the *experience* of it (progress, failure, retry) has not been polished since it shipped.

---

## 4. Explicit non-suggestions — decisions, not gaps

Carried forward deliberately. These encode product positioning; don't reopen without new information.

- **Wet-clay texture stamps.** Prototyped in v2 and pulled — bump scale on wet clay is too small to read against the wet sheen.
- **A second carve-on-bare-clay tool.** Sgraffito already covers it; Decorate already covers "draw on the pot".
- **Any social feature** — leaderboards, shared/cloud gallery, sign-in, community browse. Breaks the Madderverse Promise, breaks the "no data collected" Play declaration, and puts the Teacher Approved badge at risk. This has been proposed and rejected more than once; the gallery stays local-only.
- **In-app purchases for glaze or backdrop packs.** It's a paid app. The opt-in backdrop download is bandwidth management, not monetization.
- **Daily streaks, progress meters, achievements, notifications.** The store copy sells *against* these.
- **Ads of any kind**, including "watch an ad to unlock". Brand-lethal.
- **Meme stickers / viral share templates.** Positioning is meditative and artistic.
- **A new clay stage.** The arc is three — wet → leather (Decorate) → fired — and capped.
- **A game mode** (challenge / timed / scored). "Slip Studio is a studio, not a game."
- **Any tool needing a network call after install.** Backdrop packs are the sole, deliberate exception.
- **A "Teacher Approved" banner inside the app.** The badge lives on the store surface; the studio stays calm and unbranded.

---

## 5. Content generosity — current inventory

The value-for-money lane is content abundance, never engagement mechanics (see the `project_slip_value_pass` memory). Counted from the v196 source:

| | count |
|---|---|
| Glazes | 49 |
| Dip gradient presets | 30 |
| Starter shapes | 11 |
| Paint colour packs | 4 |
| Motif packs | 7 |
| Pattern packs | 4 |
| Finishes | 3 |
| Rim styles | 5 |
| Gallery backdrops | 1 (Studio) |

**Lane 2 (art packs Onion sources → wire + optimize) is the open lane.** Optimizer recipe is in CLAUDE.md: 640–800px q82 progressive JPEG for opaque tiles; downscale + 256-colour FASTOCTREE PNG *preserving alpha* for transparent art.

---

## 6. Store-side (separate from in-app)

Not verified against Play Console — these are from `PLAY_STORE_LISTING.md` and may already be done.

- **Feature graphic must be exactly 1024×500.** `slip-feature.png` is 1488×720 and Play rejects it — crop/resize or recompose.
- **Screenshot recapture.** The drafted shot list predates the sculpting overhaul, Display mode, collections and the teapot. Current screenshots undersell the build.
- **Promo video.** 30 s landscape shot list is drafted; unshot.
- **Release notes for the next upload.** Play is on vc13 / web v136; the staged vc16 AAB is web v180 and now trails live by v181–v196.
- **Do not raise the price** back to $2.99 until reviews accumulate.

---

*Verified against `main.js` / `style.css` / `index.html` at web v196, 2026-07-28. §6 is unverified and reflects `PLAY_STORE_LISTING.md`.*
