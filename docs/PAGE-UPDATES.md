# Page updates: a new game without a store release

The whole game is one page, `index.html`. The iPhone/iPad app and the Android app each carry a copy of it, which is why a
UI or gameplay change normally needs a new build, an upload and a review. **Page updates** send a newer `index.html`
straight to the apps instead, the way CodePush did for React Native apps (Microsoft shut CodePush down in March 2025).

- **iOS:** from build 11 (2.3.0). The code is `ios/Mitosis/PageUpdates.swift`.
- **Android:** from versionCode 10 (2.3.0). The code is `android/.../PageUpdates.kt`. It lives on the Android 2.3.0 branch and
  works once that branch is merged.
- **The website** needs none of this: it already gets every server deploy.

Only the page changes this way. Native code still needs a store build: purchases, sign-in, Nearby, recording, haptics,
permissions, the icon, and the update code itself.

## Publish an update

1. Commit the change to `index.html` on `main`. Test it as usual (`npm test`, the browser, a simulator).
2. Sign it:
   ```bash
   node tools/page-update.js publish
   ```
   This writes `updates/ios/` and, once the Android app has page updates, `updates/android/`: a signed `manifest.json` and
   `page.html`. Each update covers every app build from the first with page updates up to the build in `ios/project.yml` or
   `android/app/build.gradle.kts`.
3. Check what will go out:
   ```bash
   node tools/page-update.js check
   ```
4. Commit `updates/` and push `main`.
5. Deploy the server. The server reads `updates/` on every request, so the deploy is all it takes:
   - at home: `ssh polybot 'cd /opt/mitosis && sudo ./deploy.sh'`
   - on the ship, which can't reach the server: `gh workflow run deploy.yml`, or GitHub › Actions › **Deploy** › Run
     workflow on the website if the ship's Wi-Fi resets api.github.com. GitHub does the SSH with the `DEPLOY_SSH_KEY`
     secret (set up November 7 2026).
6. Confirm it is live: `curl http://51.81.81.166:3000/updates/ios/manifest.json` shows the new `v`.

**When phones get it.** An app checks when it opens, and at most every 30 minutes when it comes back to the foreground. It
downloads the page in the background and shows it **on its next launch**, never in the middle of a game. To see it at once
on your own phone, swipe the app away and open it twice. The connection report (`/admin/net`) shows phones on a page
update as `ios-2.3.0-p<v>` or `android-2.3.0-p<v>`.

**A page that needs a newer app** (it relies on a new native feature) goes only to builds that have that feature:
```bash
node tools/page-update.js publish --platform ios --min 12
```
`--max N` holds an update back from newer builds. `--platform ios|android` publishes for one app only.

## Roll back

| Command | What it does |
|---|---|
| `node tools/page-update.js rollback` | Publishes the page that was out before the current one again, under a new, higher number. Phones that took the bad page move back. |
| `node tools/page-update.js rollback --to <commit or tag>` | Publishes `index.html` as it was at that commit. |
| `node tools/page-update.js off` | Sends every app back to the page built into it. |

Then commit, push and deploy, as for a publish. Phones switch the way they take any update: they learn of it when they
open and switch on the launch after.

**Phones also roll back on their own**, one phone at a time. A downloaded page has to send `{type:'booted'}`, the last line
of the page's script. If it doesn't within 5 seconds of loading, or the app is killed twice before it does, the phone drops
that version for good and loads its built-in page again. It also reports `page-update-dropped` to `/api/crash`, so a broken
update shows up in the crash reports within minutes. `publish` refuses a page that has no `booted` line at all.

## What Apple and Google allow

This is our reading of the rules as of November 2026, not legal advice.

- **Apple, Developer Program License Agreement 3.3.1(B).** Interpreted code (JavaScript run by WebKit) may be downloaded
  only if it:
  - doesn't change the app's primary purpose;
  - doesn't bypass OS signing, the sandbox or other security features;
  - doesn't create a store for other apps.
- **App Review Guideline 2.5.2.** Apps may not download code that "introduces or changes features or functionality". Apple
  tolerates page and JavaScript updates within 3.3.1(B): many apps ship them, and CodePush and Expo Updates were built on
  this. But it is a tolerance for fixes and polish, not a way round review.
- **Guideline 2.3.1** requires new features and product changes to be described to App Review. A feature that review never
  saw, switched on later by a page update, is what gets apps pulled.
- **Guideline 3.1.1.** Anything that unlocks paid content must go through in-app purchase. A page update must never add
  another way to pay, an external payment link, or a way to unlock items outside the existing purchase flow.
- **Google Play, Device and Network Abuse policy.** An app "may not modify, replace, or update itself using any method other
  than Google Play's update mechanism", and may not download dex, JAR or .so code. That restriction "does not apply to code
  that runs in a virtual machine or an interpreter … (such as JavaScript in a webview or browser)", as long as the
  downloaded code doesn't allow other policy violations. The same policy also flags a WebView with a JavaScript bridge that
  loads untrusted content. The apps load only pages signed with our key, so this doesn't apply.

**Safe to push:**
- bug fixes and crash fixes;
- balance and tuning, bots, round rules;
- text, layout, menus, UI polish and performance;
- art and effects;
- events and seasonal themes;
- new skins sold through the existing purchase flow;
- anything the website already gets.

**Needs a store build and review:**
- anything that needs new native code or a new permission;
- a new kind of purchase or anything that touches how payment works;
- a big new feature or mode (describe it to App Review);
- collecting new personal data (the App Store privacy labels and Play's Data safety form would be wrong);
- anything that turns the app into something other than this game.

When in doubt, put it in the next store build as well, so review sees it.

## The signing key

- The private key is `~/.mitosis/page-update-key.pem` on Rowan's Mac (Ed25519, made November 7 2026). **Back it up**, for
  example in a password manager. Without it no page update can be published until new store builds of both apps carry a new
  key.
- Both apps trust its public half: `publicKey` in `PageUpdates.swift` and `PUBLIC_KEY` in `PageUpdates.kt`. `npm test`
  checks that they match.
- `node tools/page-update.js keygen` makes a new key and writes its public half into both apps. Do this only if the old key
  is lost or leaked, then make store builds.
- The server is plain HTTP, but that doesn't matter: anyone can read the files, and nobody without the key can change them.
  A page whose bytes don't match its signed SHA-256 and size is thrown away. So is a manifest whose signature doesn't check
  out, or an older manifest replayed to push a phone back.

## How it works

| Piece | Where |
|---|---|
| Signing, rollback, checks | `tools/page-update.js` (tests: `updates.test.js`, part of `npm test`) |
| Hosting | `server.js` serves `updates/ios|android/manifest.json` and `page.html`, read on each request, so a `git pull` publishes. |
| iOS | `ios/Mitosis/PageUpdates.swift`, wired into `GameViewController.swift` |
| Android | `PageUpdates.kt` and `Ed25519.kt` (Android has Ed25519 built in only from Android 13), wired into `MainActivity.kt` |
| The page's part | the last line of `index.html`'s script: `Native.send({type:'booted'})` |

The manifest holds `v`, `minBuild`, `maxBuild`, `sha256`, `size` and `sig`. `sig` is an Ed25519 signature over the
following text, with the platform inside it, so an iOS update can't be passed to Android:
```
mitosis-page-update/1
platform=ios
v=…
minBuild=…
maxBuild=…
sha256=…
size=…
```

`v` only goes up. A phone takes a manifest only if `v` is above every version it has taken, and only if its own build is in
the range. An "off" manifest has an empty `sha256`.

The app keeps the downloaded page in its own storage and loads it at the same address as the built-in one:
- **iOS:** a `file://` page. WebKit gives every `file://` page the same origin.
- **Android:** served in place of `file:///android_asset/index.html`.

So localStorage carries over: the player's secret, settings and wallet cache.

## Testing a page update before it goes out

Don't sign test pages for real build numbers. Build a Debug app with a build number no phone has, and sign test pages for
that build only:

```bash
# a simulator build numbered 9011
xcodebuild -project ios/Mitosis.xcodeproj -scheme Mitosis -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/mitosis-dd CODE_SIGNING_ALLOWED=NO CURRENT_PROJECT_VERSION=9011 build
# a local server that hands out test updates from /tmp/mitosis-updates
PORT=3093 DATA_DIR=/tmp/mitosis-data UPDATES_DIR=/tmp/mitosis-updates node server.js
# sign a test page for build 9011 only
node tools/page-update.js publish --platform ios --min 9011 --max 9011 --page my-test.html --out /tmp/mitosis-updates/ios
# install the app on a simulator, then launch it against the local server (Debug builds only)
xcrun simctl launch <udid> com.mitosisgame.app -server http://localhost:3093
```

The app logs each step (`log stream --predicate 'process == "Mitosis"'`): `page update N downloaded`, `loading page update N`,
`page booted (page update N)`, `dropped page update N: …`.

**Tested on November 7 2026**, on an iPhone 17 simulator (iOS 26.5) with the page-updates code from build 11:
- With nothing published, the built-in page runs.
- A published page was downloaded and shown on the next launch, still the same player (no new account on the server).
- With the server down, the app started on its saved update.
- A broken page (its script throws) was dropped 5 seconds after loading, and the built-in page came back.
- A rollback (an earlier page republished as a higher version) was taken.
- A page swapped on the server was refused (SHA-256), and so was a manifest with a hand-raised `v` (signature). An older,
  correctly signed manifest replayed was ignored.
- `off` sent the app back to its built-in page.
- Killing the app twice before a broken page could start made the third launch drop it.

Android has not been run on a phone or emulator yet. What has been checked:
- `PageUpdates.kt` and `MainActivity.kt` compile against the Android 16 SDK.
- `Ed25519.kt` passes RFC 8032's test vectors, a cross-check against the JDK's Ed25519 (200 keys, tampered copies refused),
  and signatures made by this tool.
- The Android branch's CI (build, then play in an emulator) runs when that branch is pushed.
