# Push notifications

Mitosis can send notifications to iPhones (Android is ready on the server, see the end). This page covers the one-time
setup Rowan does in his Apple Developer account, how to test it, and how it works.

## What players see

- The game **never asks at launch**. It shows its own card first ("Know when friends invite you"), at one of these moments:
  - right after the player makes a friend or invites one to a party,
  - back in the lobby after their 3rd game,
  - or when they switch on **Settings › Notifications** themselves.
- Only **Turn on** shows iOS's own prompt (iOS shows that once ever). **Not now** asks again in 3 days at the soonest, at most 3 times.
- **Settings › Notifications**: one master switch, then a switch for each kind (the server sends the list, so a new kind needs no app update).
  If iOS has them off, switching on opens iOS Settings.
- Tapping a notification opens its screen: Friends, Quests, the Battle Pass, the Shop. If the player is mid-match it waits for the lobby.
  A notification that arrives while the game is open shows as the game's own toast, not a banner over the match.
- Limits on the server: each kind has a gap and a daily cap, nobody gets more than 4 a day in all, and news (quests, pass, shop) is
  never sent between 22:00 and 9:00 in the player's time zone.

## Setup (Rowan, once)

### 1. Create the APNs key (Apple Developer)

1. Go to [developer.apple.com/account/resources/authkeys/list](https://developer.apple.com/account/resources/authkeys/list)
   (Certificates, Identifiers & Profiles › **Keys**) and press **+**.
2. Name it `Mitosis Push`, tick **Apple Push Notifications service (APNs)**. If it asks, choose environment
   **Sandbox & Production** and **Team Scoped (All Topics)**.
3. **Continue › Register › Download.** You get `AuthKey_XXXXXXXXXX.p8`. Apple lets you download it **once**: keep a copy in
   your password manager (next to `~/.mitosis/page-update-key.pem`). The 10 characters in the name are the **Key ID**.
4. The Team ID is `4M7HR323EA` (already the default).

One key serves every app on the team and both the development (sandbox) and App Store (production) services. If it ever
leaks, revoke it on the same page and make a new one.

### 2. Turn on Push for the app ID

[Identifiers](https://developer.apple.com/account/resources/identifiers/list) › `com.mitosisgame.app` › tick
**Push Notifications** › Save. (Xcode also does this by itself the first time it builds with this branch while you're signed
in, because the app now has the `aps-environment` entitlement.) Then let Xcode refresh its profiles (it does with automatic
signing). **An archive made before this step fails to sign** with "Provisioning profile doesn't include the
aps-environment entitlement": open the project in Xcode once, check Signing & Capabilities shows Push Notifications, then archive.

### 3. Give the key to the server

The server reads three variables (`push.js`, passed through `docker-compose.yml`):

| Variable | Value |
| --- | --- |
| `APNS_KEY_ID` | the Key ID, e.g. `AB12CD34EF` |
| `APNS_TEAM_ID` | `4M7HR323EA` (the default) |
| `APNS_KEY_FILE` or `APNS_KEY` | a path to the `.p8` the container can read, or the file's contents (`\n` for newlines) |

**From the ship (no SSH needed):** store the key as two GitHub secrets, and the Deploy workflow installs it on the
server (`/opt/mitosis/.secrets/apns.p8` plus two lines in `/opt/mitosis/.env`) on its next run:

```bash
gh secret set APNS_KEY < ~/Downloads/AuthKey_AB12CD34EF.p8
```

```bash
gh secret set APNS_KEY_ID --body AB12CD34EF
```

```bash
gh workflow run deploy.yml
```

(The workflow change and the server code are on the `push-notifications` branch, so this works once that is on `main`.)

**With SSH**, instead: copy the file to `/opt/mitosis/.secrets/apns.p8`, add `APNS_KEY_ID=AB12CD34EF` and
`APNS_KEY_FILE=/app/.secrets/apns.p8` to `/opt/mitosis/.env`, then `sudo ./deploy.sh`.

`.secrets/` and `*.p8` are in `.gitignore`, so the key never ends up in git.

### 4. Check it

1. Open `http://51.81.81.166:3000/admin/push?token=<ADMIN_TOKEN>`: it should say **Apple ready**. A problem with the key
   (wrong file, missing ID) shows there and in the server log at start-up.
2. On your iPhone (a build with this feature), open Settings › Notifications and switch it on, allow.
3. Reload the admin page: you're listed (name, device, app version). Pick a screen and press **Send test**. Lock the phone
   first to see the banner; tap it and the game should open that screen.

From a terminal, the same test: `curl -d player=<your id> -d link=friends 'http://51.81.81.166:3000/admin/push?token=<ADMIN_TOKEN>'`.

Builds installed from Xcode or from an archive's `.app` get **sandbox** tokens; TestFlight and the App Store get
**production** ones. The app reads which from its provisioning profile and tells the server, and the server retries the
other one if Apple calls a token bad, so both kinds of build just work.

## Testing without Apple's key

- `npm test` includes `push.test.js`: storage, switches, rate limits, quiet hours, sign-in merges and account deletion on
  both stores; the APNs sender against a stand-in that checks the JWT like Apple (expired token renewal, dead tokens,
  wrong environment, wrong key, wrong topic, 4 KB limit); the FCM sender; the API and the admin page.
- `node tools/push-page-test.js --shots <dir>`: the game page in headless Chrome with a stand-in for the app, end to end
  (no prompt at launch, Settings, iOS prompt, registration, switches, the card after making a friend, taps, toasts).
- In the iOS Simulator, with `tools/apns-mock.js` in place of Apple: it checks each request and hands the notification to
  the simulator with `xcrun simctl push`:

```bash
node tools/apns-mock.js --make-key /tmp/test-apns.p8
```

```bash
node tools/apns-mock.js --port 2197 --key /tmp/test-apns.p8 --key-id TESTKEY123 --team 4M7HR323EA --simulator booted
```

```bash
PORT=3123 ADMIN_TOKEN=demo APNS_HOST=http://localhost:2197 APNS_KEY_FILE=/tmp/test-apns.p8 APNS_KEY_ID=TESTKEY123 node server.js
```

  Then launch a Debug build with `-server http://localhost:3123`, allow notifications in Settings and send a test from
  `http://localhost:3123/admin/push?token=demo`. If the simulator can't reach Apple for a token, add `-pushToken` followed
  by 64 hex characters (Debug builds only). The test key is made for testing; never use the real APNs key with the stand-in.

## How it works

| Piece | Where |
| --- | --- |
| Permission, APNs registration, taps, foreground notifications | `ios/Mitosis/Push.swift`, hooks in `AppDelegate.swift` and `GameViewController.swift` (`push` messages) |
| The card, Settings › Notifications, routing taps, registering the token | `index.html`, the "push notifications" block before the main loop |
| Tokens, switches, limits, APNs (HTTP/2, ES256 JWT from the .p8) and FCM senders | `push.js` (tables `push_tokens`, `push_prefs`, `push_log` in the server's SQLite) |
| API | `POST /api/push/register` `{platform, token, env, app, tz}`, `POST /api/push/unregister` `{token}`, `POST /api/push/prefs` `{off: [...]}` |
| Admin | `GET /admin/push?token=…` (status, devices, sent today, test sends), `POST` `player=…&link=…&body=…` |

Dead tokens (Apple: Unregistered, BadDeviceToken; Google: UNREGISTERED) are deleted at once; the app registers again on
every launch. A device that signs in to another account moves to it; deleting an account deletes its devices and switches.

Server code sends with `push.notify(playerId, kind, { title, body, link })`. Kinds and their limits are the `KINDS` list
at the top of `push.js`.

### Android, later

The server side is done: set `FCM_SERVICE_ACCOUNT` to a Firebase service-account JSON (or its base64). The Android app needs
Firebase Cloud Messaging (`google-services.json`, the messaging library, `POST_NOTIFICATIONS` permission on Android 13+)
and to answer the same bridge messages as iOS (`push` with `cmd` `state` / `ask` / `settings`, and events `token`, `open`,
`foreground`). It registers with `platform: 'android'`; notification channels are named after the kinds.
