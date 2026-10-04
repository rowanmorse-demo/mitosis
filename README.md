# Mitosis 2.1

A multiplayer cell-eating arena set in a giant petri well. Absorb anything smaller than you, divide to strike, and keep clear of anything bigger. Plays in a browser, and as native apps for iPhone/iPad and Android.

**Play now: http://51.81.81.166:3000**. Send the link to friends and everyone who opens it shares the same world.

## Features

- **Soft-body cells** that squash against each other and the dish wall, with shadows, organelles and a nucleus that trails motion
- **Live multiplayer** for up to 16 players. AI microbes fill the well, and every real player who joins replaces five of them
- **Smarter bots** with personalities (hunters, farmers, opportunists, snipers) that steer around threats, predict prey, split-kill, shoot hunter phages and fire viruses at big targets
- **Evolution**: at mass milestones, pick one of three permanent traits, six times a life
- **World events**: Nutrient Bloom, Antibiotic Tide, Phage Swarm and the Leviathan boss
- **Hunter phages** that breach the rim and inject cells; the cell bursts into up to 16 pieces 8–10 s later
- **ATP and skins**: earn ATP by playing (or buy it in the apps) and spend it on ten premium skins
- **Mutations** (Magnet, Phase, Surge), dash, frenzy streaks, a leader bounty, emotes, stain patterns and 12 achievements

## Controls

| Input | Action |
| --- | --- |
| Mouse | Steer |
| Space | Divide: launch half your mass forward |
| W | Eject mass (feed phages to make them replicate) |
| Shift | Dash |
| 1 · 2 · 3 | Pick an evolution when one is offered |
| Z · X · C · V | Emotes: gg · Help! · Run! · Nice one |
| Esc | Pause |
| M | Sound on/off |

On phones, drag to steer and use the on-screen buttons. In the Android app the back button pauses.

## Rules of the well

- You absorb a cell once **30% of its diameter** is inside you and you are at least **10% heavier**. *Digestive enzymes* lowers that to 5%; *Thick membrane* makes others need 20%.
- Cells above 120 mass lose **0.12% of their mass per second** (half that with *Slow metabolism*).
- Ejecting costs 16 mass and makes a 15-mass blob, at most about 8 times a second however hard you hold W.
- Dash costs 4% of your mass.

## Rating

Every player has an Elo-style rating, starting at 1000, adjusted by the server at the end of each run:

| Factor | Effect |
| --- | --- |
| Surviving | +1 per 10 s, up to +60 |
| Each cell absorbed | +4, up to +60 |
| Dying inside the first minute | up to −20, the sooner the worse |
| Rating above 1000 | gains shrink and losses grow (at 2000, gains ×0.5 and losses ×1.5), so ratings settle rather than inflate |

Tiers: Bronze (<900), Silver, Gold (1400+), Platinum (1800+), Diamond (2300+), Legend. The lobby shows your rating and the top ten, and the results screen after every run (death or Return to lobby) shows the change. `GET /api/leaderboard` returns the top ten.

## ATP, skins and purchases

**ATP** is the in-game currency. Every run pays out when it ends:

| Source | ATP |
| --- | --- |
| Surviving | 1 per 10 s |
| Each cell absorbed | 2 (up to 30 cells) |
| Peak mass | 1 per 50 mass (up to 40) |
| Cap | 120 per run, 500 per hour |

A ten-minute run with a few kills is worth roughly 80–120 ATP. Skins cost 300–800 ATP, so the first one takes an evening of play, or an ATP pack from the app store:

| Pack | ATP |
| --- | --- |
| `atp_500` | 500 |
| `atp_1500` | 1,500 |
| `atp_5000` | 5,000 |
| `atp_12000` | 12,000 |

Prices are set in App Store Connect and the Play Console; the apps show them from there. Packs can only be bought inside the iOS and Android apps. The website earns ATP but does not sell it.

**Skins** (Nebula, Magma, Honeycomb, Circuit, Leopard, Glacier, Toxic, Eyeball, Galaxy, Gilded) are picked on the start card next to the free patterns. Owned skins are visible to every other player. The list, with prices, lives in two places that must match: `PREMIUM` in `index.html` (how each skin is drawn) and `SKINS` in `economy.js` (what the server charges).

**Where it lives.** The server owns every wallet. The page only reports "this run ended", "buy this skin" and "credit this purchase"; the server decides the payout, caps it, checks the price and verifies receipts with Apple or Google. A player is a random device secret stored in the browser or app, so there is no sign-up. Clearing site data or deleting the app starts a fresh wallet.

## Run it yourself

You only need [Node.js](https://nodejs.org) 20 or newer. There are no dependencies to install.

```bash
node server.js
# then open http://localhost:3000
```

On Windows, double-click `start.bat`. On macOS, double-click `start.command`.

- **Same Wi-Fi:** send friends the `http://192.168.x.x:3000` link shown in the game's *Play together* box.
- **Anywhere, from your PC:** keep `start.bat` running and double-click `share-online.bat`. It prints a temporary `https://….trycloudflare.com` link.
- **Tests:** `npm test` runs the economy API end to end against a throwaway server.

### Server settings (environment variables)

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 3000) |
| `DATA_DIR` | Folder for wallets, skins, runs and purchases (default `./data`). Uses SQLite on Node 22.13+, a JSON file on older Node |
| `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_BUNDLE_ID` | App Store Server API key (App Store Connect → Users and Access → Integrations → In-App Purchase). `APPLE_PRIVATE_KEY` is the `.p8` contents; `\n` may stand in for newlines |
| `GOOGLE_PACKAGE_NAME`, `GOOGLE_SERVICE_ACCOUNT` | Play Console service account with *View financial data* on the app. The variable holds the JSON key, raw or base64 |
| `IAP_UNVERIFIED=1` | **Dev only.** Trusts purchases without asking Apple/Google, so the StoreKit test store and Play test purchases work locally. `npm run dev` sets it |

Until the Apple/Google variables are set, real purchases are refused (HTTP 503) rather than trusted. ATP earned by playing works regardless.

## Deploy

### Your own server (Docker)

Any Linux box with Docker works; the game currently runs this way on an OVH VPS.

```bash
git clone https://github.com/rowanmorse-demo/mitosis.git /opt/mitosis && cd /opt/mitosis
docker compose up -d            # serves http://<server>:3000, data in the mitosis-data volume
./deploy.sh                     # later: pull the latest main and restart
```

Put the `APPLE_*` and `GOOGLE_*` variables in `/opt/mitosis/.env`; compose passes them to the container. For HTTPS put a reverse proxy in front. With Caddy, a site block like this is all it takes (Caddy fetches and renews the certificate itself):

```
play.example.com {
	reverse_proxy mitosis:3000
}
```

Then set that https address as `MITOSIS_SERVER` in `ios/project.yml`, `SERVER_URL` in `android/app/build.gradle.kts` and the default in `index.html`.

### Render

`render.yaml` is a Render Blueprint for a free web service:

1. Fork or clone this repository.
2. Open `https://render.com/deploy?repo=https://github.com/YOUR-NAME/mitosis` and click **Deploy Blueprint**.
3. Add the Apple and Google variables in the service's **Environment** tab once the apps are in the stores.
4. To use your own domain, go to the service's **Settings → Custom Domains**.

**Persistence:** on Render's free plan the filesystem is wiped on every deploy and every sleep/wake, which empties all wallets. Before real players spend money, attach a disk (Starter plan or higher) and point `DATA_DIR` at it, as the comment in `render.yaml` shows, or run the server on any host with a persistent disk. Any host that runs Node 20+ and supports WebSockets will work. The server reads `PORT` from the environment.

## iOS app

`ios/` is a native Swift app that bundles `index.html` in a full-screen `WKWebView` and adds StoreKit 2 purchases and haptics. The game loads instantly and plays solo offline; multiplayer and ATP use the server in `MITOSIS_SERVER` (`ios/project.yml`, currently the OVH box by IP, which is why Info.plist allows arbitrary loads).

- Open `ios/Mitosis.xcodeproj` in Xcode 16+ and run. Signing is automatic for team `4M7HR323EA`; change `DEVELOPMENT_TEAM` and the bundle id in `project.yml` for another account, then `xcodegen generate` (`brew install xcodegen`).
- **Testing purchases in the simulator:** the scheme uses `Mitosis/Products.storekit`, a fake App Store with the four packs. Run a local server with `npm run dev` first: debug builds in the simulator use `http://localhost:3000` when it answers, and the production server otherwise.
- **App Store Connect:** create the app with bundle id `com.mitosisgame.app`, then four consumable in-app purchases with product ids `atp_500`, `atp_1500`, `atp_5000`, `atp_12000`. Create an In-App Purchase API key and set the `APPLE_*` variables on the server.
- **TestFlight:** Product → Archive, then Distribute App → App Store Connect. From the terminal: `xcodebuild -project ios/Mitosis.xcodeproj -scheme Mitosis -configuration Release archive -archivePath ios/build/Mitosis.xcarchive -allowProvisioningUpdates`, then export with `ios/ExportOptions.plist`.

Regenerate the icon with `swift ios/tools/make-icon.swift ios/Mitosis/Assets.xcassets/AppIcon.appiconset/icon-1024.png`.

## Android app

`android/` is a native Kotlin app that bundles `index.html` in a full-screen `WebView` and adds Google Play Billing and haptics. The build copies the page from the repo root, so the app always ships the current game.

- Open `android/` in Android Studio (Ladybug or newer, Android SDK 35) and run, or `cd android && ./gradlew assembleDebug`.
- The server address is `SERVER_URL` in `android/app/build.gradle.kts`. For a local server from the emulator use `http://10.0.2.2:3000`.
- **Play Console:** create the app with package `com.mitosisgame.app`, add four in-app products with the ids above, upload a signed build to a testing track, and add your Google account as a license tester so purchases are free. Create a service account with *View financial data* and set the `GOOGLE_*` variables on the server.
- Release builds need a signing key: add a `signingConfigs` block in `app/build.gradle.kts` or use Android Studio's *Generate Signed Bundle*.

## How it works

| File | What it does |
| --- | --- |
| `index.html` | The whole game: rendering, simulation, bot AI, skins, the ATP client and UI in one self-contained page |
| `server.js` | A zero-dependency Node server that serves the page, relays live state over WebSockets (`/ws`), hosts the economy API (`/api/*`) and a health check at `/health` |
| `economy.js` | ATP rules: run payouts, caps, the skin catalogue, crediting purchases |
| `iap.js` | Receipt verification with the App Store Server API and the Google Play Developer API |
| `store.js` | Storage: SQLite built into Node, or a JSON file on older Node |
| `test.js` | End-to-end test of the API (`npm test`) |
| `ios/` | iOS app (Swift, WKWebView, StoreKit 2). `project.yml` describes the Xcode project |
| `android/` | Android app (Kotlin, WebView, Play Billing) |
| `render.yaml` | Render deployment settings |

Each player's browser simulates its own cells and shares a compact state snapshot about 15 times a second. The player who has been in the world longest hosts it, running the bots, phages, power-ups and events. If they leave, the next player takes over automatically. Food positions are derived from a shared seed, so only "who ate what" needs to be sent. When a cell is eaten, the eaten cell's own player decides, which keeps fights consistent without a central game server.

### API

All endpoints take and return JSON. Authenticated ones need `Authorization: Bearer <secret>`.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/session` `{secret}` | Create or load the player; returns wallet, owned skins and the catalogue |
| `POST /api/run/start` | Begin a run (server timestamps it) |
| `POST /api/run/end` `{runId, survived, eaten, peak}` | Pay out the run; idempotent |
| `POST /api/skins/buy` `{skinId}` | Spend ATP on a skin |
| `POST /api/iap/apple` `{transactionId, jws}` | Verify a StoreKit 2 transaction and credit ATP |
| `POST /api/iap/google` `{purchaseToken, productId, orderId}` | Verify a Play purchase and credit ATP |
| `GET /api/catalog` | Skins, packs, payout rules and which stores are verified |
