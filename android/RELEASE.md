# Releasing the Android app (2.3.0, versionCode 10)

The app is `com.mitosisgame.app`: `index.html` from the repo root in a full-screen landscape WebView, with Google Play Billing, Sign in with Google, haptics, the in-app review card and battery-saver/thermal reporting (see `app/src/main/kotlin/com/mitosisgame/app/`). Nearby play and game recording are iPhone-only; the page hides them on Android.

## 1. Get the builds

**From GitHub Actions** (no Android SDK needed): every push that touches `android/` or `index.html` runs the **Android** workflow (`.github/workflows/android.yml`). You can also start it from *Actions › Android › Run workflow*. Open the run and download:

- **mitosis-android-2.3.0-10**
  - `mitosis-2.3.0-10-debug.apk`: install with `adb install`. It's debuggable and talks to the live server.
  - `mitosis-2.3.0-10-release-UNSIGNED.aab`: the Play build, unsigned. Sign it as described in step 2 before uploading.
- **emulator-results**: screenshots, logcat and `results.json` from the emulator run.
- **ci-release-test-apk-NOT-FOR-UPLOAD**: a release APK signed with a key made up for that run, pointed at the runner's own server. It exists only so CI can test the minified build. Never upload it: Play rejects anything not signed with your upload key.

**On your Mac:** install Android Studio (it brings the SDK and JDK 17+), then:

```bash
cd android
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew bundleRelease        # app/build/outputs/bundle/release/app-release.aab (signed if step 2A is set up)
```

## 2. Sign the release with your upload key

The upload key is yours alone. It never goes in the repository or into CI: `.gitignore` excludes `android/keystore.properties`, `*.jks` and `*.keystore`.

**No upload key yet?** Make one and back it up (a password manager plus an offline copy):

```bash
keytool -genkeypair -v -keystore ~/keys/mitosis-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

With Play App Signing, Google holds the key that signs what users install. Your key only proves an upload came from you, and if it's ever lost or leaked, Play Console can reset it (*Test and release › App integrity › Request upload key reset*).

**A. Let Gradle sign it.** Create `android/keystore.properties` (git ignores it):

```properties
storeFile=/Users/rowan/keys/mitosis-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

Then run `cd android && ./gradlew bundleRelease`. The signed bundle is `app/build/outputs/bundle/release/app-release.aab`. The same four values can come from environment variables instead: `MITOSIS_UPLOAD_STORE_FILE`, `MITOSIS_UPLOAD_STORE_PASSWORD`, `MITOSIS_UPLOAD_KEY_ALIAS` and `MITOSIS_UPLOAD_KEY_PASSWORD`.

**B. Sign the AAB from CI.** `apksigner` can't sign app bundles; `jarsigner` (in every JDK) can:

```bash
jarsigner -keystore ~/keys/mitosis-upload.jks -signedjar mitosis-2.3.0-10-release.aab mitosis-2.3.0-10-release-UNSIGNED.aab upload
```

**Check before uploading:** the certificate printed should be yours.

```bash
keytool -printcert -jarfile mitosis-2.3.0-10-release.aab
```

## 3. Play Console

Everything here happens in [Play Console](https://play.google.com/console). Nothing in this repo does it for you.

1. **The app.** Create it in the **organization** developer account (Catapult Consulting, LLC), not the personal "RowanMorse" one (*Create app*; field-by-field text in PLAY-LISTING.md): name *Mitosis: Cell Arena*, a game, free, with in-app purchases. Leave **Play App Signing** on (the default) and let Google generate the app signing key. The package name is fixed by the first upload: `com.mitosisgame.app`. If an earlier build is already in Play with a versionCode of 10 or more, raise `versionCode` in `app/build.gradle.kts` first.
2. **Payments profile.** *Settings › Payments profile*: needed before you can sell anything.
3. **The ATP packs.** Only once step 4 is done: a pack bought before the server can verify Google purchases is paid for but not credited. The app keeps handing it to the server on later launches, but Google refunds any purchase not consumed within 3 days. Until the products exist, the Android shop says packs aren't on sale yet. *Monetize with Play › Products › One-time products*: create five, with these exact ids, and activate them. The app consumes each purchase after the server credits it, so they can be bought again. These prices match the App Store:

   | Product id | ATP | Price (US) |
   |---|---|---|
   | `atp_500` | 500 | $0.99 |
   | `atp_1500` | 1,500 | $1.99 |
   | `atp_5000` | 5,000 | $4.99 |
   | `atp_12000` | 12,000 | $9.99 |
   | `atp_150000` | 150,000 | $99.99 |

4. **Let the server verify purchases.** Until this is done, the server refuses Google purchases (`/health` shows `"google":false`). In Google Cloud, create a service account and enable the *Google Play Android Developer API*. Then in Play Console, *Users and permissions › Invite new users*, invite the service account's email with **View financial data** for this app. Set these on the server: `GOOGLE_PACKAGE_NAME=com.mitosisgame.app`, and `GOOGLE_SERVICE_ACCOUNT` = the service account's JSON key (raw or base64). See the README's environment table.
5. **License testers.** *Settings › License testing*: add your Google account and your testers', so test purchases are free.
6. **Sign in with Google** (optional; the button stays hidden until this is set). In Google Cloud Console › Credentials, create a **Web** OAuth client, plus an **Android** OAuth client for `com.mitosisgame.app` for each SHA-1 you use:
   - the *app signing key* SHA-1 (Play Console › *Test and release › App integrity*);
   - the upload key's SHA-1 (`keytool -list -v -keystore ~/keys/mitosis-upload.jks -alias upload`);
   - the debug key's SHA-1, if you want sign-in in debug builds.

   Put the web client id in `app/build.gradle.kts` (or pass `-Pmitosis.googleWebClientId=…`) and add it to the server's `GOOGLE_CLIENT_IDS`.
7. **App content** (*Policy and programs › App content*). Answer from `PRIVACY.md`, which already covers Android:
   - **Privacy policy:** a public URL for `PRIVACY.md` (for example its GitHub page).
   - **Ads:** no ads.
   - **Data safety:**
     - *Collected*: user IDs (the device identity and, if signed in, the Google account id and email); name (the display name); purchase history; app interactions (run results); crash logs and diagnostics.
     - *Not shared*: none of it goes to third parties.
     - *Encrypted in transit*: **No**, while the server is plain `http://51.81.81.166:3000`. Moving to an https address (README › *Hosting*) would let you answer Yes.
     - *Deletion*: users can delete their account in the app. Play also wants a web link for deletion requests; the GitHub issues link in `PRIVACY.md` works.
   - **Content rating:** fill in the IARC questionnaire. It's a game with no violence beyond cells absorbing cells, no chat, no user-generated content and no gambling, and it sells digital items.
   - **Target audience:** match the privacy policy (general audiences; not designed for children under 13).
8. **Store listing.** Adapt the text from `store-listing.md` (Play allows an 80-character short description and a 4,000-character full one). You need a 512×512 icon (`ios/Mitosis/Assets.xcassets/AppIcon.appiconset/icon-1024.png` scaled down), a 1024×500 feature graphic, and at least two phone screenshots. Play wants an aspect ratio of 2:1 or narrower, so crop the 2400×1080 emulator screenshots to 2160×1080.
9. **Test, then release.**
   - Upload the signed AAB to **Internal testing**, add your testers and roll it out.
   - Install from the Play link and check four things: a purchase with a license tester (ATP arrives and the pack can be bought again), sign-in, the shop prices, and a Ranked game.
   - New personal developer accounts must also run a **closed test** with at least 12 testers for 14 days before Play opens production access. Organization accounts (D-U-N-S verified) don't have that rule.
   - Then promote the release to Production.

## What the app sends the page (for reference)

| Bridge message | Android |
|---|---|
| `products`, `buy`, `finish`, `ready` | Play Billing Library 8. Unconsumed purchases are delivered again when the page is ready and on every return to the app; the server ignores duplicates. |
| `auth`, `signin` | Credential Manager, Google only, when `GOOGLE_WEB_CLIENT_ID` is set |
| `haptic` | Vibrator, on a background thread |
| `review` | Play In-App Review. Play decides whether the card shows, and the page asks at most every 90 days. |
| `log` | logcat (`adb logcat -s Mitosis`) |
| `{type:'app'}` events | `resignActive`, `becomeActive`, `background`, `memoryWarning`, the same names as iOS |
| `{type:'power', low, thermal}` | Battery saver plus the thermal state (`nominal`, `fair`, `serious` or `critical`). The page uses reduced effects while battery saver is on or the phone is hot. |
| `nearby`, `record` | Not on Android. The page hides both, and `record` is refused at once. |
| `booted` | The page's script ran to the end. A downloaded page update that doesn't send it is dropped (below). |

A crashed or killed WebView renderer no longer takes the app down: the app makes a new WebView and reloads the game, as iOS does.

## Page updates (a new game page without a Play release)

From versionCode 10 the app takes signed page updates from the game server, on the same channel and with the same key as the
iOS app: `/updates/android/manifest.json` + `page.html`, published with `node tools/page-update.js publish` (see
docs/PAGE-UPDATES.md). The app (PageUpdates.kt) checks when it opens and at most every 30 minutes when it returns, checks the
Ed25519 signature (Ed25519.kt, since Android has it built in only from Android 13) and the SHA-256, and loads the page on the next
launch in place of `file:///android_asset/index.html`, at the same address, so the player's localStorage stays. A page that
doesn't send `booted` within 5 s of loading, or that the app is killed twice before it does, is dropped and the built-in page
used again. Google Play allows this: its Device and Network Abuse policy exempts JavaScript running in a WebView from the
ban on downloaded code, as long as the code doesn't break another Play policy.
