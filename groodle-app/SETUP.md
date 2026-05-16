# groodle-app — build the Android APK

This wraps the web game in `../groodle` as a Capacitor 6 Android app
(`org.madderverse.groodle`, "Groodle"). The web build stays the
source of truth — this directory only snapshots + wraps it.

## What's already scaffolded (committed)

- `package.json` — Capacitor 6 deps + scripts
- `capacitor.config.json` — appId / appName / `webDir: www`
- `scripts/prebuild.mjs` — rebuilds `www/` from `../groodle` with
  offline-safe relative paths (copies in the parent `assets/css` +
  `assets/favi` the game references, rewrites `../assets/...` and
  `https://madderverse.org/assets/...` → bundle-relative `assets/...`)
- `android/` — the native Android project (committed; build outputs
  are gitignored)

`www/` and `node_modules/` are generated, not committed.

## One-time prerequisites (Chunk 0)

Needed only on the machine that builds the APK:

- **Node 20+** and npm (already used to scaffold this)
- **JDK 17** (Gradle for Capacitor 6 / AGP 8 needs 17 specifically)
- **Android Studio** (or just the Android SDK command-line tools) —
  install an SDK Platform (API 34+) and the build-tools. Set
  `ANDROID_HOME` (or `ANDROID_SDK_ROOT`).
- A Play Console account (confirmed) — not needed until Chunk 11.

## Build a debug APK

```bash
cd groodle-app
npm install                 # first time only
npm run sync                # prebuild www/ + cap sync android
npx cap open android        # opens the project in Android Studio
```

In Android Studio: let Gradle sync, then **Build → Build Bundle(s) /
APK(s) → Build APK(s)**. The debug APK lands at:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Sideload it: enable "Install unknown apps" on the phone, transfer the
APK (USB / Drive / email-to-self), tap to install. Or with a
USB-debugging phone connected:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## App icon + splash (Chunk 9 will finalise art)

Placeholder icons come from the Madderverse favicon set. To generate
a full density set from a single 1024×1024 source, drop it at
`assets/icon.png` (+ optional `assets/splash.png`) and run:

```bash
npm run icons
```

Groodle-branded icon + maskable artwork is deferred to Chunk 9 of
`../groodle/PLAY_STORE_PLAN.md`.

## After any web change

The APK does **not** auto-track `../groodle`. Re-snapshot + re-sync:

```bash
npm run sync
```

then rebuild in Android Studio. (For day-to-day game work, keep using
the web preview — only re-sync when you want to test in the app.)

## Smoke test checklist (first APK)

- App launches offline (airplane mode) — game shell loads
- Drawing inside the silhouette works; SURPRISE / starters / pages
- Audio plays on DANCE; the beefed-up dance animates
- Achievements + hats persist after force-killing the app
- 🖼️ Gallery shows its "not set up / offline" state gracefully
  (Supabase is online-only by design)

## Known deviations from PLAY_STORE_PLAN.md Chunk 4

- `webDir` is `www` (a prebuilt snapshot), **not** `../groodle`
  directly. The plan's bullet said `../groodle`, but the same chunk
  also specifies the prebuild-into-www step — and the absolute /
  parent-dir asset URLs *must* be rewritten for the bundle, which
  can't be done in-place on the live web dir. `www` is the correct
  resolution; the prebuild keeps it a faithful snapshot.
- `capacitor.config.json` (not `.ts`) so the CLI needs no extra TS
  toolchain. `bundledWebRuntime` is omitted (removed in Capacitor 6).
