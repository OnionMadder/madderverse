# Madderverse Design System

**Version:** v1.0 — extracted from `lets-crayte-pootery/` on 2026-05-13
**Canonical source:** [Let's CRAYte! Pootery](lets-crayte-pootery/) (CSS + HTML + game.js)
**Maintainer:** Onion Madder / Mad Sundar LLC

---

## How to use this doc

This is the **load-bearing reference for every Madderverse-branded product**, including new ones (e.g. Tiny Canvas on the App Store + Google Play). Future sessions building any Madderverse game or app should read this first and treat its tokens, patterns, and timings as defaults. **Match Pootery, don't reinvent.**

When you need a color, a button shape, an animation timing, or a drawer pattern — look here first. If something is missing, look at Pootery's CSS (`lets-crayte-pootery/style.css`) and add the rule here in the same commit.

**Deviations are allowed but must be documented.** If a future product genuinely needs to diverge (e.g. Tiny Canvas needs a paper-white surface for coloring, not the dark onioncore deep), add an explicit **Exception** entry to the bottom of this doc with: (1) the product, (2) what it overrides, (3) why. The default for all unspecified surfaces is canon.

The existing Madderverse hub uses a slightly different magenta (`#ff00ff`) than canon Pootery hot-pink (`#ff2e88`) — see the **Known divergences** section. New products should follow Pootery, not the hub.

---

## Table of contents

1. [Brand identity](#1-brand-identity)
2. [Color palette](#2-color-palette)
3. [Typography](#3-typography)
4. [Spacing & radii](#4-spacing--radii)
5. [Iconography](#5-iconography)
6. [Button system](#6-button-system)
7. [Form controls](#7-form-controls)
8. [Modal & drawer patterns](#8-modal--drawer-patterns)
9. [Layout patterns](#9-layout-patterns)
10. [Animation timings & easing](#10-animation-timings--easing)
11. [Sound design](#11-sound-design)
12. [Responsive & mobile rules](#12-responsive--mobile-rules)
13. [Accessibility baseline](#13-accessibility-baseline)
14. [Brand voice & copy](#14-brand-voice--copy)
15. [Known divergences across existing games](#15-known-divergences-across-existing-games)
16. [Exceptions / per-product overrides](#16-exceptions--per-product-overrides)

---

## 1. Brand identity

The Madderverse is a constellation of small, ad-free, kid-friendly browser games and apps under the **Onion Madder** / **Mad Sundar LLC** banner. The visual identity is **onioncore**: dark teal-leaning navy backgrounds, hot-pink CTAs, neon teal accents, chunky uppercase display type with a YTP / late-90s-PC undercurrent (scanlines, LCD subtitles, Konami-code easter eggs, Win95 chrome cameos).

The voice is "indie dev who cares." Polished but unpretentious. Confident enough to make a pottery wheel sim called *Pootery* without apologizing.

Every product page links back to **The Madderverse** hub via the floating home button (`.madder-home`, shared in `assets/css/site-footer.css`). Every product page ends with the slim footer linking to Mad Sundar LLC. These are the only two consistent chrome elements across the catalog.

---

## 2. Color palette

The canonical palette is **onioncore**: dark teal-blue base + hot-pink CTAs + neon-teal accents, with warm clay/kiln tones reserved for in-game content surfaces. All tokens below come from `lets-crayte-pootery/style.css:11-37`.

### Surfaces (cool side — UI chrome)

| Token | Hex | Role |
|---|---|---|
| `--bg-deep` | `#06141a` | Page background, near-black with teal undertone |
| `--bg-stage` | `#0c1f25` | Canvas stage / main play area background |
| `--bg-panel` | `#0f2a32` | Tool panel surface |
| `--bg-frame` | `#143842` | Raised UI frame / chrome elements |

### Primary accent (teal)

| Token | Hex | Role |
|---|---|---|
| `--teal` | `#00ffcc` | Primary accent: links, focus rings, system-info chrome, secondary CTAs |
| `--teal-dim` | `#4dd9b8` | Subdued teal — LCD status text, secondary labels |
| `--teal-low` | `#0a665a` | Line work, borders, divider rules |

### Action accent (pink)

| Token | Hex | Role |
|---|---|---|
| `--pink` | `#ff2e88` | **Primary CTA pink** — "Go" actions, primary buttons, focus outline |
| `--pink-bright` | `#ff5cab` | Active state, link-hover, button-glyph |
| `--pink-deep` | `#b81866` | Drop-shadow on display type, deep gradient stops |

### Text

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#eaf6f4` | Main text on dark surfaces |
| `--ink-dim` | `#9fb8b6` | Secondary text, hints |
| `--ink-low` | `#5a7773` | Tertiary text, disabled state |

### Warm side (in-game content surfaces only)

Reserved for clay, kiln, and any product-specific "physical material" surface (e.g. paper in a coloring app would belong here too). Don't use these for UI chrome.

| Token | Hex | Role |
|---|---|---|
| `--clay-1` | `#a05a2c` | Warm clay highlight |
| `--clay-2` | `#6b3a1a` | Mid clay |
| `--clay-3` | `#4a2510` | Deep clay shadow |
| `--kiln-1` | `#ffb24a` | Kiln glow highlight / celebratory accent |
| `--kiln-2` | `#ff5a1f` | Mid kiln flame |
| `--kiln-3` | `#b21f0c` | Deep kiln ember / "danger" warm |

### Semantic states (not tokenized — use literals)

| Hex | Role |
|---|---|
| `#33ff66` | LIVE / running status (battles, sessions) |
| `#ff8060` | Error text on dark |
| `#ffea00` | Winner / trophy gold accent |
| `#ffd23f` | Currency / value (used in Groodle's currency pill) |

### Drop-in CSS

```css
:root {
    /* Onioncore base */
    --bg-deep:      #06141a;
    --bg-stage:     #0c1f25;
    --bg-panel:     #0f2a32;
    --bg-frame:     #143842;

    --teal:         #00ffcc;
    --teal-dim:     #4dd9b8;
    --teal-low:     #0a665a;

    --pink:         #ff2e88;
    --pink-bright:  #ff5cab;
    --pink-deep:    #b81866;

    --ink:          #eaf6f4;
    --ink-dim:      #9fb8b6;
    --ink-low:      #5a7773;

    /* Warm side — content surfaces only */
    --clay-1:       #a05a2c;
    --clay-2:       #6b3a1a;
    --clay-3:       #4a2510;
    --kiln-1:       #ffb24a;
    --kiln-2:       #ff5a1f;
    --kiln-3:       #b21f0c;
}
```

### Background treatment

The page body is **not flat**. Pootery uses a stacked radial + linear gradient with a thin scanline overlay; this is canon for any full-page screen.

```css
body {
    background:
        radial-gradient(ellipse at 50% 0%,
            rgba(0, 255, 204, 0.06) 0%, transparent 55%),
        linear-gradient(180deg,
            #07181e 0%, var(--bg-deep) 60%, #04101a 100%);
    background-attachment: fixed;
}

/* Scanlines — fixed, behind UI */
body::before {
    content: "";
    position: fixed; inset: 0;
    pointer-events: none;
    background-image: repeating-linear-gradient(0deg,
        rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px,
        transparent 1px, transparent 3px);
    z-index: 9000;
    mix-blend-mode: overlay;
}
```

---

## 3. Typography

Four font roles, loaded from Google Fonts at the top of every game page. The system-ui stack is the body default; the display fonts are reserved for chrome.

### Font stacks

```css
:root {
    --font-title:   "Bungee", "Impact", "Haettenschweiler",
                    "Arial Narrow Bold", system-ui, sans-serif;
    --font-lcd:     "VT323", "Courier New", monospace;
    --font-mono:    "Press Start 2P", "VT323", "Courier New", monospace;
    --font-ui:      system-ui, -apple-system, "Segoe UI", Roboto,
                    "Helvetica Neue", Arial, sans-serif;
}
```

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bungee&family=VT323&family=Press+Start+2P&display=swap"
      rel="stylesheet" />
```

| Role | Font | When to use |
|---|---|---|
| `--font-title` | **Bungee** | Big screen titles, button labels, headlines, achievement names, screen-titlebar titles |
| `--font-lcd` | **VT323** | LCD-style status, hints, blurbs, dates, scoreboards, anything that should read as "screen output" |
| `--font-mono` | **Press Start 2P** | Tiny chrome labels, pack tabs, system text, row-labels, footer chrome — very small (10-11px) |
| `--font-ui` | **system-ui** | Long-form body text in modals, account flows, sign-in flows — anywhere readability matters more than vibe |

### Cursive title pairing (optional, Groodle pattern)

For products with a softer kid-friendly voice (Groodle does this), pair Bungee with a hand-script cursive for **only** the screen title. Use Caveat from Google Fonts; the fallback degrades to Marker Felt / Bradley Hand / system cursive. **Do not use cursive for buttons or labels** — only the title.

```css
--font-cursive: 'Caveat', 'Marker Felt', 'Bradley Hand', cursive, sans-serif;
```

This pairing is a **valid variant** for products with a "drawing/creative" voice (Groodle, Tiny Canvas). Pootery itself does not use it. Default is no cursive.

### Size scale

Pootery uses `clamp()` for everything that scales between phone and tablet. Static sizes are reserved for small chrome.

| Role | Size | Notes |
|---|---|---|
| Hero title line 1 | `clamp(36px, 10vw, 88px)` | Bungee, line-height 0.95 |
| Hero title line 2 | `clamp(54px, 14vw, 132px)` | Bungee, line-height 0.95, **the brand-defining line** |
| Screen title (`<h2>`) | `clamp(11px, 2.6vw, 20px)` | Bungee, letter-spacing 2.5px |
| Celebration title | `clamp(48px, 12vw, 96px)` | Bungee, letter-spacing 6px |
| Big-button label | `clamp(18px, 3.4vw, 22px)` | Bungee, letter-spacing 2px |
| Control-button label | `clamp(13px, 2.4vw, 16px)` | Bungee, letter-spacing 2px |
| LCD subtitle | `clamp(20px, 3.5vw, 28px)` | VT323, letter-spacing 1.5px |
| LCD body / hint | `18px` (mobile: `14px`) | VT323, line-height 1.2-1.3 |
| LCD status / date | `13-16px` | VT323 |
| Mono row-label | `10px` | Press Start 2P, letter-spacing 1.4px, uppercase |
| Mono pack-tab | `10-11px` | Press Start 2P |
| Body text in modals | `15-18px` | system-ui via inheritance |

### Weights & letter-spacing

- Bungee has only one weight (regular); rely on text-shadows for emphasis.
- All Bungee usage is **uppercase**.
- VT323 is monospace — letter-spacing 1-1.5px for status text, 0.8-1.2px for prose.
- Press Start 2P needs **substantial letter-spacing (1.2-1.6px)** to breathe at 10-11px. Always set it.

### Display-text effects

Brand-defining Bungee titles use **layered text-shadow** for the "stickered" look — drop-shadow + offset highlight + glow. Don't replace this with a flat font weight.

```css
.big-title .line-2 {
    color: var(--teal);
    text-shadow:
        4px 4px 0 var(--pink-deep),     /* drop */
        -2px -2px 0 #fff,                /* upper-left highlight */
        0 0 36px rgba(0, 255, 204, 0.5); /* glow */
}
```

LCD text gets a soft teal glow:

```css
font-family: var(--font-lcd);
color: var(--teal-dim);
text-shadow: 0 0 6px rgba(0, 255, 204, 0.55);
```

---

## 4. Spacing & radii

Pootery doesn't expose a token scale, but the actual values in the stylesheet cluster tightly. **Use these as your spacing scale.**

### Spacing

| Step | px | Use |
|---|---|---|
| **4** | 4 | Inline gaps inside compound chrome (e.g. label + glyph) |
| **6** | 6 | Tight palette gaps (swatch row), tab spacing |
| **8** | 8 | Standard tight gap, panel-internal row gap, small button gap |
| **10** | 10 | Control-row gap, modal action-row gap |
| **12** | 12 | Standard panel padding, grid gap |
| **14** | 14 | Menu-button stack gap, control padding |
| **16** | 16 | Screen-padding x-axis, modal inner padding |
| **18** | 18 | Large button x-padding |
| **20** | 20 | Modal frame inner padding |
| **22** | 22 | Big-button x-padding |
| **24** | 24 | Screen-padding y-axis, title-stack section gap, decorate-tools section padding |
| **28** | 28 | Tablet two-column gap |
| **30** | 30 | Bottom screen padding |

Treat **8** and **16** as the dominant rhythm. Most panels are `gap: 8-12px` internally and `padding: 12-16px` outside. Hero/menu screens jump to `gap: 28px`. Mobile responsive variants reduce to `padding: 10-14px`.

### Radii

```css
:root {
    --radius-sm:    4px;
    --radius-md:    8px;
    --radius-lg:    14px;
}
```

| Token | Use |
|---|---|
| `--radius-sm` (4px) | Small chrome — tabs, swatch backgrounds, badge pills, slider thumbs |
| `--radius-md` (8px) | **Standard** — buttons, panels, inputs, modals, cards |
| `--radius-lg` (14px) | Large surfaces — canvas frames, hero containers |
| `50%` | Circular icon containers, swatches, the floating home button |
| `18px` (bottom-sheet) | Bottom-sheet drawer top corners on phone |

Avoid radii larger than 18px outside of full-pill components. Hard 0-radius is reserved for the Gazonionaire Win95 chrome — that's a deliberate retro callback and not part of canon.

---

## 5. Iconography

Madderverse leans on **Unicode glyphs** and **Press-Start-2P single-character ornaments** rather than icon fonts or SVG libraries. Anchor character per element:

| Glyph | Codepoint | Use |
|---|---|---|
| ▸ | `&#9656;` | Primary "go" indicator on buttons |
| ⌂ | `&#x2302;` | Floating home button (Madderverse hub) |
| ↶ | `&#x21B6;` | Undo |
| ↺ | `&#x21BA;` | Reset / repeat |
| ✕ | `&#10005;` | Modal close |
| ✓ | `&#10003;` | Confirm / saved |
| ✉ | `&#9993;` | Magic-link email |
| ⚙ | `&#9784;` | Account / settings |
| ★ | `&#9733;` | Trophy / favorite |
| ☆ | `&#x2606;` | Empty trophy / banner glyph |
| ⚡ | `&#9889;` | Power / overclock |
| ⌗ | `&#x2317;` | Empty-state glyph |
| ▲ | `&#9650;` | Marquee / drawer-pull |
| ▤ | `&#9636;` | Gallery / grid |

### Floating-button rules

Icon-only buttons follow one of two shapes:

**Floating overlay button** (canvas overlays, page-corner controls):
- 38-40px circle
- `background: rgba(12, 31, 37, 0.85)` with `backdrop-filter: blur(4px)`
- `border: 1px solid var(--teal-low)`, transitions to `var(--teal)` on hover, `var(--pink)` on focus-visible
- Glyph in `var(--teal)`, shifts to `var(--pink-bright)` on hover
- Subtle 0.85 base opacity, full on hover
- See `.canvas-overlay-btn` in `lets-crayte-pootery/style.css:887` and `.madder-home` in `assets/css/site-footer.css:124`

**Inline icon button** (rotate-reset, dev-menu toggles):
- 22-28px circle
- Same border + color scheme but no blur
- See `.rotate-reset` and `.specs-close`

### Touch target

Minimum hit target is **40px** on the longest axis for any control on a touch screen. The floating-button 38-40px circles meet this; the inline icons (22-28px) only ship inside contexts that aren't fingertip-critical (modal close, slider reset). When in doubt, **40px**.

### Stroke weight & fill

Glyphs are **filled** (default font rendering), not stroked. Container borders are 1-2px:

- 1px for low-priority chrome (palette swatches, dev menu)
- 2px for buttons, modal frames, primary panels

---

## 6. Button system

Pootery has **three button families**. Pick one and use it consistently within a screen.

### 6.1 `.big-btn` — Menu / hero CTA

Full-width vertical-stack buttons on title and account screens. Chunky, label + right-aligned glyph.

```html
<button class="big-btn primary">
    <span class="btn-label">START SHAPING</span>
    <span class="btn-glyph" aria-hidden="true">&#9656;</span>
</button>
```

| Variant | Border | BG | Use |
|---|---|---|---|
| default (`.big-btn`) | `var(--teal-low)` | `#0f2a32` | Secondary menu actions (Gallery, Trophies) |
| `.big-btn.primary` | `var(--pink)` | linear-gradient `#3a1024 → #20081a` | The screen's main CTA |
| `.big-btn.install` | `var(--teal)` | linear-gradient `#0d2a32 → #07181e` | Utility actions (Install App, Continue with Google) |

**Geometry:** padding `18px 22px`, radius `8px`, font `--font-title` at `clamp(18px, 3.4vw, 22px)`, letter-spacing 2px, uppercase. Stacked at `gap: 14px`, width `min(360px, 88vw)`.

**Press affordance:** the brand-defining touch — buttons cast a **flat dark drop "shadow box"** below them (`box-shadow: 0 6px 0 #02141a`) that compresses to 3px on `:active` while the button translates `3px` down. This gives them a chunky physical-press feel. Keep it.

```css
.big-btn {
    box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.4),
        0 6px 0 #02141a,            /* the flat drop */
        0 8px 16px rgba(0, 0, 0, 0.5);
    transition: transform 0.06s ease,
                background 0.12s ease,
                border-color 0.12s ease,
                box-shadow 0.12s ease;
    text-shadow: 2px 2px 0 #000;
}
.big-btn:active {
    transform: translateY(3px);
    box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.4),
        0 3px 0 #02141a,
        0 0 12px var(--btn-glow);
}
```

### 6.2 `.btn-control` — In-screen action row

Used inside tool rails and modal action rows. Same press affordance as `.big-btn` but smaller and arranged horizontally.

| Variant | Use |
|---|---|
| default (`.btn-control`) | Reset, Clear, Decorate-again, Delete |
| `.btn-control.primary` | The row's "go" action (Finish Form, Fire It, Export PNG) |
| `.btn-control.is-flash` | Brief 200ms teal halo to confirm a triggered action (audio-less feedback) |

**Geometry:** padding `14px`, radius `8px`, font `--font-title` at `clamp(13px, 2.4vw, 16px)`. `flex: 1` so a row of 2-3 buttons fills the width evenly with `gap: 12px`.

### 6.3 `.tool-btn` / `.pack-tab` / `.gallery-tab` — Tab-style

Compact button-tabs in tool rows. Press Start 2P at 10-11px, letter-spacing 1.4-1.6px, uppercase. Border `1px solid var(--teal-low)`, `border-radius: 4px`. Active state switches to the pink gradient:

```css
.tool-btn.active,
.pack-tab.active,
.gallery-tab.active {
    background: linear-gradient(180deg, #ff3d96 0%, #b81866 100%);
    color: #fff;
    border-color: var(--pink-bright);
    box-shadow:
        inset 0 0 10px rgba(255, 255, 255, 0.18),
        0 0 12px rgba(255, 46, 136, 0.5);
}
```

### 6.4 Disabled state

For any button family, disabled = `opacity: 0.35`, `cursor: not-allowed`, color shifts to `var(--ink-low)`, border shifts to `var(--ink-low)`, text-shadow and box-shadow stripped:

```css
.btn:disabled, .btn[disabled] {
    opacity: 0.35;
    cursor: not-allowed;
    color: var(--ink-low);
    border-color: var(--ink-low);
    text-shadow: none;
    box-shadow: none;
}
```

### 6.5 Hover vs focus-visible

**Always combine** `:hover, :focus-visible` with the same styles so keyboard and touch get the same treatment:

```css
.btn:hover,
.btn:focus-visible {
    background: var(--btn-bg-hover);
    border-color: var(--teal);
    outline: none;
    box-shadow: 0 0 18px var(--btn-glow);
}
```

The global focus ring is **pink, not teal** (since teal is the resting accent):

```css
:focus-visible {
    outline: 2px solid var(--pink);
    outline-offset: 3px;
    border-radius: 2px;
}
```

---

## 7. Form controls

### Text input / textarea

```css
.input {
    padding: 8px 10px;
    background: var(--bg-deep);
    border: 1px solid var(--teal-low);
    border-radius: var(--radius-sm);
    color: var(--ink);
    font-family: var(--font-lcd);
    font-size: 18px;
    letter-spacing: 1px;
    -webkit-text-fill-color: var(--ink);  /* iOS dark-mode safety */
}
.input:focus {
    outline: none;
    border-color: var(--pink);
    box-shadow: 0 0 8px rgba(255, 46, 136, 0.3);
}
```

Labels sit to the **left** of inputs in a horizontal row (`.detail-name-row`), using the Press Start 2P row-label pattern (`min-width: 52-56px`).

### Range slider

Pootery custom-styles the slider thumb as a pink-bright disc with white border + glow. The track is a teal→pink horizontal gradient. See `.rotate-slider` in `style.css:938`.

### Checkbox / toggle

Use the native checkbox with `accent-color: var(--pink)`:

```css
.dev-toggle input {
    width: 18px;
    height: 18px;
    accent-color: var(--pink);
}
```

---

## 8. Modal & drawer patterns

Three patterns, one mental model: **a centered card or a bottom-sheet drawer over a blurred dark backdrop.**

### 8.1 Centered modal (`.specs-panel`, `.pot-detail`, `.battle-detail`)

For dialogs invoked from anywhere on the page. Centered card on top of a blurred backdrop.

**Geometry:**
- Container: `position: fixed; inset: 0; z-index: 200-230; display: flex; align-items: center; justify-content: center; padding: 16-20px;`
- Backdrop: `background: rgba(0, 0, 0, 0.6-0.65); backdrop-filter: blur(4px);`
- Card: `width: min(420-560px, 92-96vw); max-height: 92-96vh; overflow-y: auto;`
- Frame: `border: 2px solid var(--teal); background: #051419; border-radius: 8px;`
- Glow: `box-shadow: 0 0 0 1px #000, 0 0 30px rgba(0, 255, 204, 0.35);`

**Titlebar:** `.detail-titlebar` — teal gradient strip with mono uppercase label and a square close button on the right. **This is the canon modal titlebar** — use it everywhere a modal needs a title.

```html
<aside class="pot-detail" hidden>
    <div class="pot-detail-card">
        <div class="detail-titlebar">
            <span class="detail-pack">BASIC</span>
            <span class="detail-date">2026-05-13</span>
            <button class="specs-close" type="button" aria-label="Close">&#10005;</button>
        </div>
        <!-- body -->
    </div>
</aside>
```

**Open/close:** toggle `[hidden]` on the container. The `display: flex` rule must be reasserted after the hidden attribute is removed because `[hidden] { display: none }` is the user-agent default and `flex` doesn't override it without help. Pootery handles this with `.specs-panel[hidden] { display: none }`.

**Animation:** none on the container in canon (instant open). The contained card uses `celebrate-in 600ms cubic-bezier(0.34, 1.56, 0.64, 1)` only for the kiln celebration. **Adding a 200ms fade-in** for new modals is acceptable; do not add slide animations on centered modals (those are for drawers).

### 8.2 Bottom-sheet drawer (THE canonical mobile-tool UI)

**This is the pattern Tiny Canvas and any future mobile-creative app should use for tool palettes.** Pootery's shape and decorate screens both use it. Groodle is migrating toward it.

On phones (`max-width: 767.98px`), the tool rail becomes a fixed bottom drawer with a 54px always-visible handle and a 72vh max-height when open. On tablet+, it flips to a fixed 360px right-side rail.

**Geometry & motion:**
```css
@media (max-width: 767.98px) {
    .shape-side-rail,
    .decorate-side-rail {
        position: fixed;
        left: 0; right: 0; bottom: 0;
        z-index: 80;
        max-height: 72vh;
        overflow-y: auto;
        padding: 0 14px 18px;
        background: linear-gradient(180deg,
            #082028 0%, #051218 26%, #04101a 100%);
        border-top: 2px solid var(--pink);
        border-top-left-radius: 18px;
        border-top-right-radius: 18px;
        box-shadow:
            0 -8px 24px rgba(0, 0, 0, 0.65),
            0 -1px 0 0 rgba(255, 46, 136, 0.35);
        transform: translateY(calc(100% - 54px));
        transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
    }
    .shape-side-rail.is-open,
    .decorate-side-rail.is-open {
        transform: translateY(0);
    }
}
```

**Handle:** sticky 54px top tab with a teal pull-bar (`44×4px`, `border-radius: 2px`, `background: var(--teal-low)`) above a Press-Start-2P "TOOLS" label in pink-bright. The label arrow (▲) flips 180° via `.is-open .drawer-pull { transform: rotate(180deg) }`.

**The pink top border is brand.** Don't drop it — it's the "pull me up" affordance even when the drawer is closed.

**Reserved bottom padding:** screens that contain a drawer need `padding-bottom: 72px` so the canvas/content can't hide behind the collapsed handle.

### 8.3 Confirmation / small modal

For "are you sure" prompts, use the same centered-modal frame but with a single titlebar (no close glyph if the only action is destructive) and a 2-button action row. There's no canonical Pootery example yet — establish one when needed and add it here.

---

## 9. Layout patterns

### 9.1 Screen container

Every full-screen view uses `<main class="screen" id="screen-name">`. Only one is visible at a time; the others have `[hidden]`. Screen-swap is handled by toggling that attribute in JS.

```css
.screen {
    max-width: 920px;
    margin: 0 auto;
    padding: 24px 16px 60px;
    min-height: calc(100vh - 110px);
    display: flex;
    flex-direction: column;
}
.screen[hidden] { display: none; }
```

`--content-max: 920px` is canon. Going wider risks the buttons looking lost at desktop sizes.

### 9.2 Screen titlebar (the back-button bar)

Every non-title screen starts with a `.screen-titlebar` strip: back button on the left, screen title centered, status indicator on the right.

```html
<div class="screen-titlebar">
    <button class="back-btn" id="someBack">&larr; TITLE</button>
    <h2 class="screen-title">&lt;&nbsp;COLOR THE THING&nbsp;&gt;</h2>
    <span class="screen-status">UNFIRED</span>
</div>
```

The title is wrapped in `<&nbsp;LABEL&nbsp;>` angle-brackets — this is part of the brand. The status badge in the top-right is mono-LCD text in `var(--teal-dim)` with a soft glow. Both are dashed-underlined from the screen content by `border-bottom: 1px dashed var(--teal-low)`.

### 9.3 Title screen archetype

Vertical stack centered in a 720px container:

```
marquee tape (looping ribbon)
  ↓ gap 28px
big-title (2-line stickered display)
  ↓ gap 28px
LCD subtitle (one-liner)
  ↓ gap 28px
menu-buttons (vertical stack of .big-btn)
  ↓
[optional ambient particle / clay drifter]
[corner specs-hook for easter eggs]
```

The marquee tape (`.marquee-tape`) is a pink-bordered looping horizontal text ribbon with a 28s linear animation. Reuse this for any "now loading / standby / coming soon" affordance.

### 9.4 Gameplay screen archetype (canvas + tools)

```
.screen-titlebar
  ↓
.{screen}-stack (column on phone, row on tablet+)
  ├── .canvas-wrap (the 400x600 logical canvas, centered)
  │      └── canvas, optional .canvas-overlay-btn (undo etc.)
  └── .{screen}-side-rail
         ├── pickers / palettes / sliders (.tool-row × N)
         └── .{screen}-controls (action row: reset + primary)
```

On phone the rail becomes a bottom-sheet (see drawer pattern). On tablet+ (`min-width: 768px`) the stack flips to row, side-rail width pinned at 360px.

### 9.5 Gallery grid archetype

```
.screen-titlebar
.gallery-tabs (MINE / EVERYONE / BATTLES)
.gallery-grid (CSS grid, auto-fill, minmax(140px, 1fr), gap 12px)
.gallery-empty (empty-state card with big-btn CTA)
```

Each card (`.pot-card`):
- Scanline-overlay gradient bg (`repeating-linear-gradient` + `linear-gradient`)
- 1px teal-low border, transitions to pink-bright on hover
- 8px padding, 8px radius
- Thumbnail aspect-ratio 400/600, name + date below in mono + LCD

### 9.6 Settings / account / lore archetype

Centered card on a flex-justify-center stack:
- `.account-card` — `max-width: 480px`, same scanline + gradient bg as `.pot-card`, 20px padding, `gap: 14px` between rows.
- Headline in Bungee/pink, blurb in VT323/ink-dim, fields in `.detail-name-row` (label + input horizontal).
- Action row at the bottom (`.detail-actions`) with `.btn-control` buttons.

### 9.7 Toasts

Slide-in from the right, 64px from top, blurred neon backdrop. Auto-dismiss after ~4s.

```css
.toast {
    position: fixed;
    top: 64px; right: 16px;
    z-index: 260;
    padding: 10px 16px;
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 1.5px;
    animation:
        toast-slide-in 0.4s ease-out both,
        toast-slide-out 0.5s ease-in 3.6s forwards;
}
@keyframes toast-slide-in {
    from { transform: translateX(120%); opacity: 0; }
    to   { transform: translateX(0); opacity: 1; }
}
```

---

## 10. Animation timings & easing

Keep transitions short and snappy. Pootery's vocabulary:

| Duration | Use |
|---|---|
| **60ms** (`0.06s`) | `:active` press transform / scale |
| **100ms** | Hover scale on small ornaments |
| **120ms** (`0.12s`) | **Standard hover state** — bg, border, color, box-shadow |
| **150ms** (`0.15s`) | Hover for icon containers, opacity transitions |
| **200ms** | Fade transitions on overlays |
| **250ms** | Modal sheet slide-up (Groodle) |
| **280ms** (`0.28s`) | Bottom-sheet drawer open/close |
| **300ms** | Filter swaps, body filter transitions |
| **400ms** | Toast slide-in |
| **500ms** | Toast slide-out |
| **600ms** | Celebration overlay reveal |
| **1200ms** | Effects flash (PINGAS), saved-blink |
| **2400ms** | RGB rainbow cycle |
| **4000ms** | Slow body-filter mood shifts (all-munkis horror) |
| **14000ms** | Ambient drift particle (clay-drifter) |
| **28000ms** | Marquee tape loop |

### Easing curves

| Token-equivalent | Curve | Use |
|---|---|---|
| `ease` | default cubic | Almost everything |
| `ease-out` | `cubic-bezier(0, 0, 0.58, 1)` | Toast slide-in, fade-in |
| `ease-in` | `cubic-bezier(0.42, 0, 1, 1)` | Toast slide-out, dismiss |
| `cubic-bezier(0.32, 0.72, 0, 1)` | "Material decel" | **Bottom-sheet drawer** — canon |
| `cubic-bezier(0.34, 1.56, 0.64, 1)` | "Bouncy land" | Celebrate-in, ach unlock pop |
| `cubic-bezier(0.175, 0.885, 0.32, 1.275)` | Hub-card hover | Game-card lift on hover |
| `steps(2)` | Stepped | Pixel-shake (dev-shake, kiln-shake, jitter) |

### `prefers-reduced-motion` policy

**Always honor reduced-motion** for ambient + decorative animations (marquee, drifters, RGB cycles, breathing). Keep functional motion (button press feedback, screen transitions) — those are usability, not decoration.

```css
@media (prefers-reduced-motion: reduce) {
    .big-title, .clay-drifter, .marquee-tape span,
    .swatch.dynamic-rgb, .pingas-flash, .overclocked-toast {
        animation: none;
    }
}
```

---

## 11. Sound design

**Canon: all SFX synthesized in-browser via Web Audio. No audio files. No samples.** This is a deliberate choice — every product ships with zero audio assets so it's instant to install and zero kb over the wire.

The full sound system lives in `lets-crayte-pootery/game.js` from `// ---------- 0. AUDIO BOOTSTRAP ----------` (line 653) onward. The pattern:

### Architecture

```js
let audioCtx = null;

function ensureAudio() {
    if (audioCtx) {
        if (audioCtx.state === "suspended") {
            try { audioCtx.resume(); } catch (_) {}
        }
        return audioCtx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
        audioCtx = new AC();
        if (audioCtx.state === "suspended") {
            try { audioCtx.resume(); } catch (_) {}
        }
    } catch (e) {
        audioCtx = null;
    }
    return audioCtx;
}

/* First user gesture anywhere on the page unlocks audio. */
function unlockAudioOnce() {
    ensureAudio();
    document.removeEventListener("pointerdown", unlockAudioOnce, true);
    document.removeEventListener("keydown", unlockAudioOnce, true);
}
document.addEventListener("pointerdown", unlockAudioOnce, true);
document.addEventListener("keydown", unlockAudioOnce, true);
```

Every sound function calls `ensureAudio()`, returns silently if it gets null or if `state !== "running"`. **No sound is ever required for gameplay** — silent-fail is the policy.

### Sound categories & character

| Event class | Character | Pootery example |
|---|---|---|
| **Interaction tap** | Short, low, percussive — under 200ms | `poot()` — 110→58Hz sawtooth blip with band-pass at 200Hz |
| **Sustained action loop** | Pink-noise through low-pass with slow LFO on cutoff | `wetLoopStart()` — clay sustain |
| **Ambient background hum** | Two detuned sines through low-pass + slow tremolo, ~0.03 gain | `wheelHumStart()` — wheel drone, sits under everything |
| **Confirmation chime** | 2-note harmonic interval (perfect fifth) with quick attack, long decay | `kilnDing()` — 1320Hz + 1980Hz sine bell |
| **Big celebration** | Brown noise through low-pass (roar), gain 0.20, multi-second envelope | `kilnRoar()` — kiln firing |
| **Sharp transient / explosion** | Square wave fast pitch-bend + filtered noise + crackle tail | `explosionSfx()` |

### Voice mixing

When multiple sound-emitting events fire close together (e.g. all-munkis layering 5 mods), route everything through a master `DynamicsCompressor` and a `masterGain` between the mixer and `audioCtx.destination`. New voices that connect directly to `destination` bypass the limiter and will clip.

### Aural feedback for kid-coloring apps (Tiny Canvas)

A drawing app should at minimum have:
- A **brush-down "poot"** tap sound (short, low, ~200ms)
- A **sustained loop** while drawing (subtle, ~0.05 gain)
- A **confirmation ding** on save/export
- An **eraser scratch** for the eraser tool

All synthesized. Set the **base ambient gain at 0.03-0.05** so it doesn't crowd voice/video the kid may have running on the same device.

---

## 12. Responsive & mobile rules

### Viewport meta

Every page:
```html
<meta name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no" />
```

**`viewport-fit=cover`** is canon — required for safe-area-inset to work on notch'd devices. **`user-scalable=no`** is canon for games (gestures matter); for accessibility-first products (Tiny Canvas, a coloring app) consider dropping `user-scalable=no` so kids can pinch-zoom the canvas.

### iOS PWA chrome

```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="ProductName" />
<meta name="application-name" content="Full Product Name" />
<meta name="theme-color" content="#ff2e88" />
```

The **`theme-color: #ff2e88`** (canon hot pink) is what matches the iOS PWA status bar to the onioncore palette. Use it.

### Viewport units

Use `100dvh` and `100vw` for full-viewport surfaces. `100vh` includes the area behind retracting browser bars on mobile Safari/Chrome and causes content to jump on first paint. Fall back to `100vh` only for browsers without `dvh` support:

```css
min-height: 100vh;
min-height: 100dvh;
```

### touch-action defaults

- **Canvases / draggable surfaces:** `touch-action: none;` — every touch is a draw/drag event
- **Tappable tiles, buttons, controls:** `touch-action: manipulation;` — disables double-tap-zoom but keeps panning
- **Body of long-scroll screens:** default `auto`

### Safe-area insets

Floating chrome (home button, slim footer, control cluster) anchors with `env(safe-area-inset-*)`:

```css
.madder-home {
    position: fixed;
    top:  max(12px, env(safe-area-inset-top,  0px));
    left: max(12px, env(safe-area-inset-left, 0px));
}
.site-footer-slim {
    padding-bottom: max(3px, env(safe-area-inset-bottom, 0));
}
```

### Breakpoints

| Width | Bucket |
|---|---|
| `< 380px` | Phone-narrow: shrink slim-footer font, home-button to 36px |
| `< 480px` | Phone: smaller paddings, smaller swatches, hide tagline |
| `< 600px` | Phone wide: hub grid stays 1-up |
| `< 720px` | Phone+: drawer-first layout |
| `< 768px` | Phone+ (Pootery's threshold for drawer mode) |
| `≥ 768px` | Tablet+: side-rail layout, canvas + tools side-by-side |
| `≥ 1000px` | Desktop: 3-column game grid |

### "Canvas fills viewport, tools as overlays" pattern

Pootery and Groodle both follow this on phone:
- The canvas (or "stage") occupies the full visible space.
- Tools live in a fixed bottom-sheet drawer with a 54px collapsed handle.
- Header chrome (back, title, status) is the only top decoration; it can also be replaced with the floating `.madder-home` + `.madder-controls` cluster for full-bleed experiences.

For Tiny Canvas, this is the right starting point.

---

## 13. Accessibility baseline

| Concern | Standard |
|---|---|
| **Color contrast** | All text ≥ 4.5:1 against its surface. `--ink` (#eaf6f4) on `--bg-deep` (#06141a) hits ~13:1; `--ink-dim` on `--bg-panel` is ~7:1. Pink CTAs (`#ff2e88`) on dark surfaces meet contrast easily; **never** put pink text on a pink background. |
| **Focus visibility** | Global `:focus-visible` outline: `outline: 2px solid var(--pink); outline-offset: 3px;`. Don't remove it without giving the element a `box-shadow` focus state. |
| **Touch targets** | 40px minimum on the longest axis for any tappable element. |
| **Icon-only buttons** | **Always** have an `aria-label` and a `title` attribute. Example: `<button aria-label="Undo" title="Undo (Ctrl+Z)">` |
| **`role="tablist"`** | Apply to any group of mutually-exclusive tabs (`.pack-tabs`, `.gallery-tabs`, `.tool-modes`); individual buttons get `role="tab"` and `aria-selected`. |
| **`role="listbox"`** | Apply to color/swatch palettes (`.glaze-palette`, `.pattern-palette`); swatches get `role="option"`. |
| **`hidden` for hidden panels** | Use the `hidden` attribute, not `display: none` in inline style. Lets future-you target it in JS without checking inline. |
| **`aria-hidden` for decorative glyphs** | Btn-glyphs, marquee, drifters, all decorative SVGs get `aria-hidden="true"`. |
| **Skip-links** | Not used in any current game; if a new product has a deep nav tree (a settings app, a docs site), add one. |
| **`prefers-reduced-motion`** | Honored for ambient motion; required for any new animations >300ms or that loop. |

### Reduced-motion rule of thumb

If the animation is **decorative** (idle motion, ambient drift, looping color cycle, breathing), kill it under `reduced-motion`. If it's **functional** (button press feedback, drawer open, screen swap), keep it — it's part of the interface, not decoration.

---

## 14. Brand voice & copy

The Madderverse umbrella stays consistent in **framing** (small, indie, ad-free, made-with-love, slightly weird) while **voice varies per product**. Pick one voice and commit to it within a product.

### Voice variants

| Variant | Products | Tone | Example |
|---|---|---|---|
| **YTP / cursed-pixel** | Pootery, cookie-cache | Memetic, lower-case, retro-PC-shitpost, "now with 100% more CLAYY_" | "POOTERY ENJOYER", "PINGAS", "MODDED RGB OVERCLOCKED" |
| **Kid-friendly playful** | Groodle, bala-draws | Imperative, warm, exclamatory, simple short words, encouraging | "STAY IN THE LINES TO GROOVE!", "NOW DANCE!" |
| **Chaos-game** | all-munkis | Dramatic, eerie undercurrent, terse | "BOO!", "REMIX" |
| **Retro-PC sim** | Gazonionaire | Win95 chrome, mock-corporate, dry | "SYSTEM_SPECS.TXT", "DEV_MENU.EXE" |
| **Hub neutral** | madderverse.org, about, legal | Calm, accurate, parent-readable | "Safe, free, and ad-free games for curious kids." |

### Copy rules (all voices)

- **Uppercase for chrome / labels / buttons.** Bungee renders all-caps regardless; treat it as a typesetting fact.
- **VT323 text can use either case.** Status-line text (`FRESH CLAY`, `UNFIRED`) is uppercase; longer prose in modals (`Optional. You can keep playing 100% offline.`) is sentence-case.
- **No corporate filler.** No "Welcome!" splash, no "We use cookies" banners (we don't), no Onboarding™.
- **Math punctuation:** prefer `&` over "and" in chrome ("WET & READY"), `:` over "—" for status (`READY:` not `READY —`).
- **No emoji in shipped UI text.** Glyphs are Unicode dingbats (▸ ⌂ ★) or actual SVG. The emoji policy applies to the rendered page; commits/docs are flexible.
- **Names with double letters are funny.** "Pootery", "Crayte", "Munkis", "Groodle" — the "extra O" / "intentional misspelling" is part of the brand. Don't fix them.

### When in doubt: be the indie dev

The framing across all voice variants is **"this was made by one person who cared"**. Drop hints (the Konami easter egg, the specs panel, the YTP layer in the dev menu) that reward attention. Don't optimize for first-time-user clarity at the expense of texture.

---

## 15. Known divergences across existing games

Future products should **follow Pootery, not whatever they find elsewhere**. The following are pre-canon divergences that exist in the repo today.

### Hot pink hex

| Where | Hex | Notes |
|---|---|---|
| **Pootery (CANON)** | `#ff2e88` | The brand hot pink |
| Hub (`index.html`, `assets/css/style.css`) | `#ff00ff` | Pure magenta — louder, slightly more 90s-web. Not canon, but acceptable on the hub since it's the meta-surface. |
| Cookie-cache, bala-draws | `#ff00ff` | Same magenta as hub |
| Groodle | `#ff6ec7` | Softer rose-pink — intentional for the kid-friendly Caveat voice |
| Gazonionaire | `#f06292` | Material-pink — part of the Win95 chrome theme |
| All-munkis | `#2dd4bf` (teal) + no consistent pink | Uses Tailwind-style teal, not canon teal |

**For new products: use `#ff2e88`.** When updating an existing game to align with canon, this is the first change to make.

### Display typography

| Where | Display font | Notes |
|---|---|---|
| **Pootery (CANON)** | **Bungee** | The brand display font |
| Hub | Inter 900 + drop-shadow | A faux-display effect on the hero logo; not Bungee |
| Cookie-cache, bala-draws, georges-jump, all-munkis | Inter / JetBrains Mono | No Bungee |
| Groodle | Caveat + Comic Sans MS stack | Intentional creative-kid variant |
| Gazonionaire | Mono only | Win95 theme |

**For new products: load Bungee.** Cursive-Caveat is allowed as a paired title face only.

### Background pattern

| Where | Background | Notes |
|---|---|---|
| **Pootery (CANON)** | Radial top-glow + vertical gradient + scanline overlay | The "onioncore screen" look |
| Hub, cookie-cache, bala-draws, all-munkis | 40px grid lines on `#050505` | A different idiom — gridded chrome |
| Groodle | Purple radial gradient + pink corner blob | Voice-specific |
| Gazonionaire | Deep navy + Win95 inset chrome | Voice-specific |

**For new products: use the Pootery radial + scanlines.** The grid-lines pattern is fine for the hub, where it visually distinguishes "the catalog" from "a game".

### Drawer pattern adoption

| Where | Phone tool UI |
|---|---|
| **Pootery (CANON)** | Bottom-sheet drawer with 54px handle, pink top border |
| Groodle | Migrating toward the same pattern (see CLAUDE.md TODO #3) |
| Bala-draws | Fixed bottom tray (similar idea, no slide animation) |
| Cookie-cache, georges-jump, eat-worms | Different — game-screen overlays |

**For new mobile-creative products (Tiny Canvas): use Pootery's drawer.**

### Footer / home button

The shared `assets/css/site-footer.css` provides `.site-footer-slim`, `.madder-home`, and `.madder-controls`. **Use these on every new product page.** They're the only visually consistent chrome across the catalog. The recent commit (97ec3c0) rolled them out to all games — match the same usage.

---

## 16. Exceptions / per-product overrides

Add entries here when a future product needs to break canon. Format:

> **Product:** [name]
> **Overrides:** [what is being changed]
> **Why:** [the reason]
> **Date:** [YYYY-MM-DD]

### Tiny Canvas (pending — not yet in repo)

> **Product:** Tiny Canvas (App Store + Google Play, in development as of 2026-05-13)
> **Overrides:** *(none yet — to be filled in as the product takes shape)*
> **Why:** Canvas-first kids coloring app for native mobile stores. Likely deviations to watch for: (1) the drawing surface may need to be paper-white not onioncore-dark; (2) iOS/Android native chrome differs from web (no slim footer, no home button); (3) the kid-friendly voice variant may want Caveat title pairing; (4) `user-scalable=no` should probably be dropped to allow pinch-zoom on the canvas.
> **Date:** 2026-05-13

### Gazonionaire (existing — Win95 chrome)

> **Product:** Gazonionaire
> **Overrides:** Entire visual chrome (Win95 raised/sunken bevels, hard 0-radius corners, blue palette `#4fc3f7` instead of canon teal, monospace-only typography, gradient titlebars)
> **Why:** Retro space-trading sim where the Win95 aesthetic IS the gameplay vibe. Replacing it with canon onioncore would erase the product. The shared site-footer and home-button still ship.
> **Date:** Pre-canon (locked-in before this doc existed)

### Groodle (existing — kid voice)

> **Product:** Groodle
> **Overrides:** Caveat cursive title pairing; softer pink `#ff6ec7`; purple background gradients; Comic Sans MS body
> **Why:** Drawing/dancing toy explicitly targeted at the youngest kids in the catalog. The cursive title and softer palette read as warmer; the pink-purple-yellow harmony is the "kid creative" voice variant.
> **Date:** Pre-canon

---

*End of v1.0. Bump the version header and add a changelog line when this doc is materially revised.*
