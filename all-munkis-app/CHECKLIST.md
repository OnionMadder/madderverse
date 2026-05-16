# All Munkis → Google Play — shipping runbook

Everything in this repo is **done**. This checklist closes the gap
between "code + assets are ready" and "app is in Play review." It
needs **your** machine, accounts, and the Android keystore. Work
top to bottom.

All commands run from inside `all-munkis-app/` unless noted.

---

> # 🔐 0. THE KEYSTORE RULE — READ THIS FIRST
>
> The release keystore signs **every** Play update for the life of
> the app. **If you lose it, you can never update All Munkis again**
> — you'd have to ship a brand-new listing under a new package name
> and abandon all reviews/installs. This has bitten this studio
> before (the Pootery incident). Do not let it happen again.
>
> When you generate the keystore (step 4), immediately put **the
> `.jks` file AND its passwords** in *all three* of these:
>
> 1. **Password manager** — the `.jks` as a file attachment + a
>    secure note with the keystore password, key alias, key
>    password.
> 2. **Encrypted offline backup** — copy the `.jks` to an encrypted
>    USB drive or encrypted disk image, stored physically away from
>    your laptop.
> 3. **Printed paper copy in a safe** — print the passwords + alias
>    (not the binary file; just the credentials) and put it
>    somewhere physical and safe.
>
> Also enroll in **Google Play App Signing** (Play Console offers
> this on first upload — accept it). That gives Google a copy of
> the signing key as a recovery path, but it does **not** replace
> the three backups above — you still need your upload key.
>
> The `.gitignore` already blocks `*.jks` / `*.keystore` /
> `keystore.properties` from ever being committed. Do not override
> that.

---

## 1. Accounts & prerequisites

- [ ] **Google Play Developer account** active ($25 one-time paid).
      https://play.google.com/console/
- [ ] **Bank + tax info** filed in Play Console (required even for
      free apps — Play won't let you publish without it).
- [ ] **support@madderverse.org** mailbox is live and you can read
      it. Google emails it during review; the privacy policy lists
      it.
- [ ] **Node 18+** installed (`node --version`).
- [ ] **Android Studio** installed, with an SDK + at least one
      emulator image OR a physical Android device with USB
      debugging on.
- [ ] **Java JDK** (bundled with Android Studio; `keytool` comes
      with it — used in step 4).

## 2. Hosted policy pages (do this early — Pages can lag)

- [ ] The privacy + terms pages live in the **web** copy at
      `all-munkis/legal/`. They're already committed to main. Confirm
      both load in a normal browser:
      - https://madderverse.org/all-munkis/legal/privacy.html
      - https://madderverse.org/all-munkis/legal/terms.html
- [ ] Google's reviewer **will** click the privacy URL. If it
      404s, the submission is rejected. If GitHub Pages hasn't
      rebuilt yet, wait and recheck before submitting.

## 3. Build the web bundle into the native project

```bash
cd all-munkis-app/
npm install                 # Node deps (Capacitor + plugins)
npx cap sync android        # copies www/ into android/
```

- [ ] **Step 1A (do this BEFORE opening Android Studio):** confirm
      `targetSdkVersion` in `android/variables.gradle` matches Play
      Console's **current** minimum (as of 2026-05: **API 35**). Play
      rejects any build below it. If you bump it, you MUST re-run
      `npx cap sync android` and rebuild the AAB. See the appendix
      "Common Play Console rejections + fixes" for the exact fix.
- [ ] `npm install` completes with no errors.
- [ ] `npx cap sync android` ends with "Sync finished" and lists 4
      plugins (preferences, share, status-bar, splash-screen) with
      no link warnings.
- [ ] Sanity-check the web build locally first (the Capacitor
      bridge is inert in a browser):
      ```bash
      npm run serve
      # open http://localhost:8000/www/ — play a full session
      ```

## 4. Generate the release keystore (ONE-WAY DOOR — see §0)

```bash
keytool -genkey -v \
  -keystore all-munkis-release.keystore \
  -alias all-munkis \
  -keyalg RSA -keysize 2048 -validity 10000
```

- [ ] Run the command above. It prompts for a keystore password, a
      key password, and a name/org (you can put "Mad Sundar LLC").
- [ ] **Immediately** do all three backups from §0. Do not continue
      until that's done.
- [ ] Confirm `all-munkis-release.keystore` is **NOT** tracked by
      git: `git status` should not list it (the `.gitignore`
      blocks it; verify anyway).

## 5. Wire the keystore into the Gradle release build

Create `all-munkis-app/android/keystore.properties` (this file is
git-ignored — never commit it):

```properties
storeFile=/absolute/path/to/all-munkis-release.keystore
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=all-munkis
keyPassword=YOUR_KEY_PASSWORD
```

Then edit `android/app/build.gradle` — inside `android { }` add:

```gradle
def keystorePropsFile = rootProject.file("keystore.properties")
def keystoreProps = new Properties()
if (keystorePropsFile.exists()) {
    keystoreProps.load(new FileInputStream(keystorePropsFile))
}

signingConfigs {
    release {
        if (keystorePropsFile.exists()) {
            storeFile     file(keystoreProps['storeFile'])
            storePassword keystoreProps['storePassword']
            keyAlias      keystoreProps['keyAlias']
            keyPassword   keystoreProps['keyPassword']
        }
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
    }
}
```

- [ ] `keystore.properties` created with real values.
- [ ] `build.gradle` `signingConfigs.release` + `buildTypes.release`
      wired as above.
- [ ] `git status` still does NOT show `keystore.properties` or the
      `.keystore` file.

## 6. App icons + splash raster generation

The sources are placeholders (see `store-assets/README.md`). Swap
them for final art **before public production** — but you can ship
an **internal-testing** build with placeholders to validate the
pipeline.

```bash
npm run assets:generate
npx cap sync android
```

- [ ] `npm run assets:generate` writes into
      `android/app/src/main/res/mipmap-*/` (launcher) and
      `drawable-*/splash.png` (splash).
- [ ] If you swapped the SVGs, you re-ran the two commands above.

## 7. Build the AAB in Android Studio

```bash
npx cap open android        # opens Android Studio on the project
```

In Android Studio:

- [ ] Let Gradle sync finish (first open is slow).
- [ ] Confirm `android/app/build.gradle` `applicationId` is
      `org.madderverse.allmunkis` and `versionCode 1`,
      `versionName "1.0"`.
- [ ] **Build → Generate Signed Bundle / APK → Android App Bundle**.
- [ ] Choose the keystore from step 4 (or it auto-uses the Gradle
      signing config — either is fine; the Gradle path is less
      error-prone).
- [ ] Build variant: **release**.
- [ ] Output: `android/app/release/app-release.aab`.
- [ ] AAB exists and is signed (Android Studio shows a success
      notification with a "locate" link).

## 8. Test on a real device BEFORE uploading (Internal Testing)

Don't go straight to production. Play's internal track installs in
minutes and catches the embarrassing stuff.

- [ ] Play Console → Create app:
      - App name: **All Munkis**
      - Default language: English (US)
      - App or game: **Game**
      - Free or paid: **Free**
      - Declarations: accept Developer Program Policies + US export.
- [ ] Play Console → Testing → **Internal testing** → Create new
      release → upload `app-release.aab`.
- [ ] On first upload Play offers **Play App Signing** — **accept
      it** (recovery path; see §0).
- [ ] Add yourself (and a trusted tester) as an internal tester,
      use the opt-in link, install from Play on a real Android
      device.
- [ ] Play through a full session on the device:
      - [ ] Drag all six rainbow Munkis onto the stage — they place,
            bounce, and the head does NOT clip at the top of the
            bounce (the fix is in; verify on real hardware).
      - [ ] Tap a placed Munki — face cycles.
      - [ ] **Drag a Munki off the stage — it clears** (the mobile
            drag-to-remove fix; this is the one to watch).
      - [ ] Tap the Munki who's left out — speech bubble appears.
      - [ ] Drop Ice (or Moon) on the stage → horror mode: the
            corner Munki creeps in slowly over ~12s, no layout
            shift, no audio blast.
      - [ ] Find a few hidden achievements (e.g. fill the stage 3×
            for "3 Bands"; make 6 same-color for "Solid Squad") —
            toast appears, counter updates.
      - [ ] Get to 5 moon points → Moon unlock reveal plays.
      - [ ] Force-quit and reopen → all progress + unlocks
            persisted.
      - [ ] Lock the screen mid-play → reopen → no audio
            catch-up blast (the visibility fix; verify on hardware).
      - [ ] Confirm no layout overlap on the actual phone (the tray
            never covers the stage).
- [ ] Airplane mode: enable it, cold-launch the app → it works
      fully (proves zero network dependency).

## 9. Content rating questionnaire (Play Console → Policy → App
content → Content rating)

Play uses the IARC questionnaire. Suggested answers for All Munkis:

| Question | Answer |
|---|---|
| Email for rating certificate | support@madderverse.org |
| Category | **Game** |
| Violence — does it contain violence? | **No** (horror mode is a sad cartoon Munki appearing; no combat, no injury, no blood) |
| Does it contain content that could frighten/scare young children? | **Mild / Yes, mild** — be honest: horror mode is a slow, gentle "someone's watching" beat. Answer the "mild, cartoonish, infrequent" option if offered. It will still rate Everyone/PEGI 3 or at most Everyone 10+. |
| Sexuality / nudity | **No** |
| Profanity / crude humor | **No** |
| Controlled substances (drugs/alcohol/tobacco) | **No** |
| Gambling (real or simulated) | **No** |
| User-generated content / sharing | **No** |
| Does the app share user location? | **No** |
| Does the app allow users to interact/communicate? | **No** |
| Does the app collect personal info? | **No** |
| Digital purchases | **No** |
| Is it a web browser / search engine? | **No** |

- [ ] Questionnaire submitted. Result: **Everyone** (or **Everyone
      10+** — both are fine for a kids' toy; don't fight it).

## 10. Data safety (Play Console → Policy → App content → Data
safety)

- [ ] "Does your app collect or share any of the required user data
      types?" → **No**.
- [ ] Result: **"No data collected. No data shared."**
- [ ] (This is true: the app makes zero network requests.)

## 11. Target audience & Designed for Families

- [ ] Play Console → Policy → App content → Target audience and
      content.
- [ ] Select age groups including the youngest bands (Ages 5 &
      under, 6–8) — this is a toddler-safe toy.
- [ ] "Is your app designed for children?" → **Yes**.
- [ ] Opt into **Designed for Families**.
- [ ] Note: Designed-for-Families review is stricter and slower
      than normal Play review (1–7 days, sometimes more). It will
      check: no ads, no IAP, no data collection, no external links,
      privacy policy present. All Munkis satisfies all of these.

## 12. Store listing content (Play Console → Grow → Store presence
→ Main store listing)

Paste from `STORE_LISTING.md`:

- [ ] App name: `All Munkis`
- [ ] Short description (§2)
- [ ] Full description (§3)
- [ ] App icon: 512×512 PNG (rasterize `icons/icon.svg`, see
      `store-assets/README.md`)
- [ ] Feature graphic: 1024×500 PNG (rasterize
      `store-assets/feature-graphic/feature-graphic.svg`) —
      **required**, listing can't go live without it.
- [ ] Phone screenshots: run `npm run screenshots`, upload the
      `android-phone` set (min 2). Optionally the two tablet sets.
- [ ] Category: **Casual** · Tags from §5.
- [ ] Contact email: support@madderverse.org
- [ ] Privacy policy URL:
      `https://madderverse.org/all-munkis/legal/privacy.html`
- [ ] Copyright: `© 2026 Mad Sundar LLC`

> **Placeholder reminder:** if you're going to public production,
> swap the placeholder icon / splash / feature graphic for final
> art first (`store-assets/README.md`), re-run
> `npm run assets:generate && npx cap sync android`, rebuild the
> AAB. Placeholders are fine for the internal track only.

## 13. Promote to Production

- [ ] Internal testing looked good on a real device (step 8 all
      checked).
- [ ] Final art swapped in (if going to public production).
- [ ] Play Console → Production → Create new release → upload the
      AAB (or promote the internal release).
- [ ] "What's new" notes from `STORE_LISTING.md` §16.
- [ ] Roll-out percentage: 100% (or staged — your call; a tiny
      kids' toy is fine at 100%).
- [ ] **Send for review.**

## 14. After submit

- [ ] First review for a Designed-for-Families app: expect **1–7
      days**, sometimes longer. Don't panic at silence.
- [ ] Watch support@madderverse.org for reviewer questions. The
      most likely topic is the Families policy / data safety — and
      the honest answer to all of it is "the app collects nothing
      and never goes online," which is the easiest review you'll
      ever pass.
- [ ] If rejected: read the exact policy citation, fix, bump
      `versionCode` in `android/app/build.gradle`, rebuild AAB,
      re-upload. Don't change the `applicationId` (one-way door).

---

## Quick command reference

```bash
cd all-munkis-app/

npm install                       # one-time deps
npx cap sync android              # after any web change
npm run serve                     # local web test (http://localhost:8000/www/)
npm run assets:generate           # regenerate icons/splash from SVG
npm run screenshots               # regenerate store screenshots
npx cap open android              # open Android Studio to build the AAB

# keystore (ONCE — then back it up 3 ways, see §0):
keytool -genkey -v -keystore all-munkis-release.keystore \
        -alias all-munkis -keyalg RSA -keysize 2048 -validity 10000
```

---

## Appendix — Common Play Console rejections + fixes

First-time Capacitor → Play submissions reliably hit a few of these.
None are signing problems; the keystore/upload-key setup (§0, §4, §5)
is unaffected by anything here.

### "Target API level N required (your build targets M)"

Play raises the minimum `targetSdk` ~yearly; builds below it are hard-
rejected. **Fix (the whole fix is two lines + a sync + a rebuild):**

1. Edit `android/variables.gradle`:
   ```
   compileSdkVersion = <an SDK platform you have installed, >= N>
   targetSdkVersion  = N
   ```
   `compileSdk` does **not** have to equal `targetSdk` — it only has to
   be an SDK platform actually installed under
   `…/Android/Sdk/platforms/` and `>= targetSdk`. Play enforces
   **only** `targetSdk`. (Check installed platforms with
   `ls "$ANDROID_HOME/platforms"`; if none `>= N`, install one via
   `sdkmanager "platforms;android-N"` or Android Studio's SDK Manager.)
2. `npx cap sync android`
3. Rebuild the AAB (`cd android && ./gradlew :app:bundleRelease`).
4. Bump `versionCode` first (see next item) — the rejected upload
   already burned the old one.

### "Version code N has already been used"

`versionCode` (in `android/app/build.gradle` → `defaultConfig`) is a
monotonic integer Play uses to order updates. **It can never be reused
— not even if the upload was rejected, discarded, or deleted from a
draft.** Every upload attempt permanently retires that integer.
**Fix:** increment `versionCode` (e.g. `1` → `2`), rebuild the AAB,
re-upload. `versionName` (the human string, e.g. `"1.0"`) is unrelated
and can stay the same across many `versionCode` bumps.

### "App contains references to private/restricted APIs" / non-SDK API warnings

Usually a **false positive** from a Capacitor/Cordova plugin or the
WebView, surfaced in the **Pre-launch report**, not a hard block for
internal testing. Don't refactor blindly. Check Play Console →
Pre-launch report for the exact API + caller. If it's plugin code (not
ours) and the app runs, it's almost always safe to proceed; revisit
only if Play escalates it to a policy rejection.

### "Missing privacy policy" / "You must provide a privacy policy URL"

This is a **store-listing form** field, **not** a build problem. Do
not rebuild. Play Console → Policy → App content → Privacy policy:
paste `https://madderverse.org/all-munkis/legal/privacy.html` (and see
§2 — confirm the page actually loads first; reviewers click it).

### "Release not available to any testers" (warning, not error)

Non-blocking. Internal testing just needs a tester list: Play Console
→ Testing → Internal testing → **Testers** tab → add an email list
(your own email is fine) and use the opt-in link to install.

### "No deobfuscation file was uploaded" (warning, not error)

Ignore. We ship with `minifyEnabled false` (no R8/proguard), so there
are no obfuscated stack traces to map. Permanently harmless.

### "App not compliant with Play's 16 KB native page size" / 64-bit / etc.

A pure Capacitor WebView app ships no custom native `.so` libraries,
so these generally don't apply. If Play flags it, it's about a plugin;
check which `.so` is named in the message before changing anything.
