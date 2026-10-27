"""Make every game an installable home-screen app (iPad first).

Run from the repo root:   python scripts/make-pwa.py

For each game in GAMES it:
  1. builds <game>/pwa/{apple-touch-icon.png (180, opaque), icon-192.png,
     icon-512.png, icon-512-maskable.png} from the game's own icon art;
  2. writes <game>/manifest.webmanifest (or, for games that already own a
     manifest, replaces only its "icons" list and leaves the rest alone);
  3. patches <game>/index.html so the head points at those files with
     RELATIVE paths, and carries the iOS standalone tags.

Why relative: a game folder plus /assets/js/touch-guard.js is the whole
unit a native wrapper would bundle, so nothing a game needs to install
should live at an absolute madderverse.org URL. (The 16/32px favicons and
the SEO og:/twitter: metas stay absolute — scrapers read those.)

Why status-bar-style "black" for games that didn't already choose: with
"black-translucent" the page draws under the iPad clock, which only works
for games that pad for env(safe-area-inset-top). Pootery, Groodle and
Tiny Canvas already do and keep their translucent bar.

Idempotent: re-run after changing an icon source. Every HTML patch
asserts it matched, so an upstream rewrite fails loudly instead of
silently shipping a page without its install tags.

Needs Pillow. Icon sources outside git (the *-app/ Capacitor folders)
are read at generation time only; the generated PNGs are what ships.
"""
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_ICON = "assets/favi/android-chrome-512x512.png"

# dir: (short_name, full name, icon source, background colour)
# Icon source kinds: a square icon file, or "cover:<file>" = centre-crop
# the hub cover (placeholder until real icon art exists).
GAMES = {
    "slip-studio":   ("Slip Studio", "Slip Studio", "slip-studio-app/assets/slip-icon-512.png", "#1b1815"),
    "pootery":       ("Pootery", "Pootery: Throw, Glaze, Fire", "pootery/icons/icon-512.png", "#06141a"),
    "all-munkis":    ("All Munkis", "All Munkis", "all-munkis-app.archive-madsundar/app store/icon.png", "#06141a"),
    "groodle":       ("Groodle", "Groodle", "groodle-app/assets/icon-512.png", "#1a0f33"),
    "cookie-cache":  ("Cookie Cache", "Tub's Cookie Cache", "cookie-cache-app/assets/store-icon-512.png", "#06141a"),
    "georges-jump":  ("George's Jump", "George's Jump", "georges-jump/assets/favi/android-chrome-512x512.png", "#06141a"),
    "friend-picker": ("Friend Picker", "Friend Picker", "cover:friend-picker/cover.jpg", "#06141a"),
    "florigami":     ("Florigami", "Florigami", "florigami/assets/img/app-icon.png", "#f7efdd"),
    "tiny-canvas":   ("Tiny Canvas", "Tiny Canvas", "tiny-canvas/icons/icon-1024.png", "#06141a"),
    # Unlisted / WIP — installable too, so testing on an iPad matches play.
    "glass-gallery": ("Glass Gallery", "Glass Gallery", "cover:glass-gallery/cover.jpg", "#2a1f52"),
    "smash-studio":  ("Smash Studio", "Smash Studio", "cover:smash-studio/cover.jpg", "#2a1f52"),
    "eat-worms":     ("Eat Worms", "Go Eat Worms", SITE_ICON, "#06141a"),
    "bala-draws":    ("Bala Draws", "Bala Draws", "cover:bala-draws/cover.jpg", "#06141a"),
    "munki-madness": ("Munki Madness", "Munki Madness", SITE_ICON, "#070b1c"),
    "spoiler-alert": ("Spoiler Alert", "Spoiler Alert", SITE_ICON, "#cfe8f0"),
    "hole-up":       ("Hole-Up", "Hole-Up", "cover:hole-up/cover.jpg", "#9fd3ff"),
    "gazonionaire":  ("GazOnionaire", "GazOnionaire", "gazonionaire/assets/favi/android-chrome-512x512.png", "#06141a"),
    "misfile":       ("Misfile", "Misfile", SITE_ICON, "#06141a"),
    "sua-sponte":    ("Sua Sponte", "Sua Sponte", SITE_ICON, "#06141a"),
    "solder-sanity": ("Solder Sanity", "Solder Sanity", SITE_ICON, "#17140f"),
    "giggle-gears":  ("Giggle Gears", "Giggle Gears", "cover:giggle-gears/cover.jpg", "#06141a"),
    "tonehouse":     ("Tonehouse", "Tonehouse", "tonehouse/favi/android-chrome-512x512.png", "#06141a"),
}

# Games that already own a manifest: only "icons" is replaced.
OWN_MANIFEST = {"pootery", "groodle", "tiny-canvas"}

ICONS = [
    {"src": "pwa/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "pwa/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    {"src": "pwa/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
]


def p(*parts):
    return os.path.join(ROOT, *parts)


def load_source(spec):
    if spec.startswith("cover:"):
        im = Image.open(p(spec[6:])).convert("RGBA")
        w, h = im.size
        s = min(w, h)
        return im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
    im = Image.open(p(spec)).convert("RGBA")
    w, h = im.size
    if w != h:
        s = min(w, h)
        im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
    return im


def flatten(im, bg):
    base = Image.new("RGBA", im.size, bg)
    base.alpha_composite(im)
    return base.convert("RGB")


def make_icons(game, spec, bg):
    out = p(game, "pwa")
    os.makedirs(out, exist_ok=True)
    src = load_source(spec)
    big = src.resize((512, 512), Image.LANCZOS)
    big.save(os.path.join(out, "icon-512.png"), optimize=True)
    src.resize((192, 192), Image.LANCZOS).save(os.path.join(out, "icon-192.png"), optimize=True)
    # iOS fills transparency with black and rounds the corners itself.
    flatten(src.resize((180, 180), Image.LANCZOS), bg).save(
        os.path.join(out, "apple-touch-icon.png"), optimize=True)
    # Maskable: keep the art inside Android's 80% safe circle.
    mask = Image.new("RGBA", (512, 512), bg)
    inner = src.resize((410, 410), Image.LANCZOS)
    mask.alpha_composite(inner, (51, 51))
    mask.convert("RGB").save(os.path.join(out, "icon-512-maskable.png"), optimize=True)


def theme_of(html, fallback):
    m = re.search(r'<meta name="theme-color" content="([^"]+)"', html)
    return m.group(1) if m else fallback


def write_manifest(game, short, name, bg, html):
    path = p(game, "manifest.webmanifest")
    if game in OWN_MANIFEST:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        data["icons"] = ICONS
    else:
        data = {
            "name": name,
            "short_name": short,
            "id": "/%s/" % game,
            "start_url": "./",
            "scope": "./",
            "display": "standalone",
            "display_override": ["standalone", "fullscreen", "minimal-ui"],
            "orientation": "any",
            "background_color": bg,
            "theme_color": theme_of(html, bg),
            "lang": "en",
            "categories": ["games", "kids", "entertainment"],
            "icons": ICONS,
        }
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


TOUCH_GUARD = re.compile(r'^([ \t]*)<script src="\.\./assets/js/touch-guard\.js[^"]*"></script>[ \t]*\r?\n', re.M)


def patch_html(game, short):
    path = p(game, "index.html")
    with open(path, "rb") as f:
        s = f.read().decode("utf-8")
    nl = "\r\n" if "\r\n" in s else "\n"
    anchor = TOUCH_GUARD.search(s)
    if not anchor:
        sys.exit("%s: touch-guard script tag not found (anchor for PWA tags)" % game)
    ind = anchor.group(1)
    add = []

    # apple-touch-icon
    s, n = re.subn(r'<link rel="apple-touch-icon"[^>]*>',
                   '<link rel="apple-touch-icon" sizes="180x180" href="pwa/apple-touch-icon.png" />', s)
    if n == 0:
        add.append('<link rel="apple-touch-icon" sizes="180x180" href="pwa/apple-touch-icon.png" />')
    # manifest
    s, n = re.subn(r'<link rel="manifest"[^>]*>', '<link rel="manifest" href="manifest.webmanifest" />', s)
    if n == 0:
        add.append('<link rel="manifest" href="manifest.webmanifest" />')
    # home-screen label
    title = '<meta name="apple-mobile-web-app-title" content="%s" />' % short.replace("'", "&#39;")
    s, n = re.subn(r'<meta name="apple-mobile-web-app-title"[^>]*>', title, s)
    if n == 0:
        add.append(title)
    # standalone tags (keep whatever a game already chose)
    for name, content in (("apple-mobile-web-app-capable", "yes"),
                          ("mobile-web-app-capable", "yes"),
                          ("apple-mobile-web-app-status-bar-style", "black")):
        if ('name="%s"' % name) not in s:
            add.append('<meta name="%s" content="%s" />' % (name, content))

    if add:
        block = "".join(ind + line + nl for line in
                        ["<!-- Home-screen app (iPad standalone): see scripts/make-pwa.py -->"] + add)
        anchor = TOUCH_GUARD.search(s)
        s = s[:anchor.end()] + block + s[anchor.end():]
    with open(path, "wb") as f:
        f.write(s.encode("utf-8"))


def main():
    for game, (short, name, spec, bg) in GAMES.items():
        with open(p(game, "index.html"), encoding="utf-8") as f:
            html = f.read()
        make_icons(game, spec, bg)
        write_manifest(game, short, name, bg, html)
        patch_html(game, short)
        print("%-14s ok  (%s)" % (game, spec))


if __name__ == "__main__":
    main()
