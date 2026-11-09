# Mitosis 2.1

A multiplayer cell-eating arena set in a giant petri well. Absorb anything smaller than you, divide to strike, and keep clear of anything bigger. Plays in a browser, and as native apps for iPhone/iPad and Android.

**Play now: http://51.81.81.166:3000**. Send the link to friends and everyone who opens it shares the same world.

## Features

- **Soft-body cells** that squash against each other and the dish wall, with shadows, organelles and a nucleus that trails motion
- **Live multiplayer** in arenas of up to 16 players; when one is full the server opens another, each with its own round. AI microbes fill the well, and every real player who joins replaces five of them
- **Smarter bots** with personalities (hunters, farmers, opportunists, snipers) that steer around threats, predict prey, split-kill, shoot hunter phages and fire viruses at big targets
- **Mutation**: at mass milestones a random permanent trait is applied, six times a life; every cell shows badges for the traits it carries
- **World events**: Nutrient Bloom, Antibiotic Tide, Phage Swarm and the Leviathan boss
- **Hunter phages** that breach the rim and inject cells; the cell bursts into up to 16 pieces 8–10 s later
- **ATP and skins**: earn ATP by placing well (or buy it in the apps) and spend it in a full-screen shop on nineteen premium skins, up to the 12,000,000 ATP One Cell to Rule Them All
- **Levels**: every ranked life earns XP for how long you stay alive and where you place, and XP adds up into a profile level. The lobby and the Profile show your level with a bar toward the next one; the results screen counts the XP in, shows where it came from and celebrates a level-up
- **A profile with your cell up front**: in landscape (where the app lives) a stage card on the left, lit by your rank's metal, holds your cell as big as the screen's height allows, breathing in a halo with motes of light drifting up, then your name, level and one rank block (crest, rank, rating and how far to the next); the tabs are on the right in the Shop's pill, each scrolling on its own. Overview: your best trophy on a stage between the one before it and the next to win, your skins, account. Stats: win-rate and top-3 rings (over battle royale rounds), your rating over your last ranked games on this device, your rating against AI, games, time alive and cells absorbed (the same lifetime totals the permanent quests count), and recent runs. Trophies: all nine rank trophies on one shelf you swipe along, opening on your best (a 3×3 cabinet in portrait), the ones you hold with the day you won them, the rest as silhouettes with the rating each takes; then achievements. Delete account is the last thing on Overview and asks to confirm
- **A lobby that knows you**: a live portrait of your cell, your level and your rating with progress to the next tier, who is in the room and the round clock. First launch shows a three-step welcome card (Settings can bring it back). The tab bar along the bottom holds Inventory, Shop, Ranks and Friends; tapping your name card at the top opens the Profile, which keeps your last runs with placement, time, peak mass and rating change
- **Background** in Settings: a black dish (the default) or a white one
- **Effects toggle** in Settings (Full or Reduced) for older phones; the game also drops to reduced effects on its own when frames run long
- **Rounds of ten minutes**: the arena is full size for the first minute, then closes in to 3% of the dish by 9:30. Anything caught outside dissolves. Bots stop respawning at 7:00, and the round ends as soon as one player's cells are all that is left: the last cell standing wins
- **Practice and offline play** against bots at four difficulties (Easy, Normal, Hard, Expert). With no connection, Play starts a bot game straight away
- **Nearby play** (iPhone app): phones in the same room play each other over Bluetooth and peer-to-peer Wi-Fi, no internet needed, in a lobby where the host sets bot difficulty, bots, round length and lives
- **Friends and parties**: add friends by their 6-character friend code (Friends in the lobby) and see who's online. Invite one into a party: when either of you presses Play, the other joins the same arena. Allies get a dashed cyan ring and an arrow at the screen edge, can't eat each other, and whoever runs out of lives watches their ally
- **High ping plays bots**: with a ping over your *Max ping* (Settings: 100 ms by default, or 150, 250 ms or Any), Play in Ranked starts a bot game instead, unless you're in a party. It goes by the median of the last few pings
- **Mutations** (Magnet, Phase, Surge), dash, frenzy streaks, a leader bounty, stain patterns and 12 achievements. There is no chat

## Controls

| Input | Action |
| --- | --- |
| Mouse | Steer |
| Space | Divide: launch half your mass forward |
| W | Eject mass (feed phages to make them replicate) |
| Shift | Dash |
| Z · X · C · V | Emotes: gg · Help! · Run! · Nice one |
| Esc | Pause |
| M | Sound on/off |

On phones: the left stick steers, or touch the arena and every piece heads for your finger. Touch the middle of the screen to pull all your pieces together. Split and Shoot have no cooldown (hold Shoot to keep firing); Boost recharges in 4 s, or 2.2 s with Cilia. Tap the mass readout, the round clock or the HUD button to shrink or hide the on-screen info.

On phones, drag to steer and use the on-screen buttons. In the Android app the back button pauses.

## Rules of the well

- A **round lasts 10 minutes**. The dish is full size for the first minute, then the safe area shrinks at a steady rate to 3% of the dish by 9:30 and holds there until 10:00. The clock at the top of the screen counts down and says when the collapse starts.
- Cells outside the arena lose 20% of their mass per second plus 12 mass per second (60% in the final arena), and dissolve below 10 mass. A cell bigger than the final arena still counts as inside when it is centred. Bots steer back inside; new cells always spawn inside, including inside an antibiotic tide.
- **Bots stop respawning at 7:00.** From then on, as soon as only one player's cells are left the round ends and that player wins. If more than one is still alive at 10:00 (rare, given the final arena), they are ranked by mass.
- **Lives and the spawn window.** Everyone gets two respawns per round, and nobody spawns in the last 5 minutes. When you can't join, Play **searches for a game** for up to 30 seconds (the round may open or a new one start); after that you're put into a game on your device where **bots fill every slot people didn't**. Those games keep ranked rules (lives, XP, ATP by placement) but count for your **AI rating**, not your ranked one. So does Play when your ping is over Settings › Max ping.
- **Casual** (practice: the button under Play) is the same bot-filled game with endless lives and no XP. It moves your AI rating (gains scale with the bots: Easy ×0.5 to Master ×1.5) and pays ATP for a win or a top-3 finish. The pill beside it (and Settings) sets the bots to Easy, Normal, Hard, Expert or Master. It needs no connection, but offline games are not rated. When the app has no connection, Play starts a Casual game at once instead of searching.
- **Nearby** (a play mode in the iPhone app's lobby) connects phones around you with MultipeerConnectivity, over Bluetooth and peer-to-peer Wi-Fi. The phones relay the game to each other the way the server does online, so rounds, bots and hosting work the same. Nearby games are unranked. The phones form a lobby: the host phone picks the match (bot difficulty Easy to Master; no, few, normal or lots of bots; a 3, 5 or 10-minute round; 1, 3 or 5 lives) and taps Start match, which pulls every phone on the home screen into it; when the round ends everyone is back in the lobby. If the host closes the app, the iPhone app leaves the session at once and another phone takes over hosting, so the match goes on; a player left alone with no bots plays on to the clock. The settings travel in the host's presence (`lb`). `node tools/nearby-test.js` plays a match between two headless Chrome pages with a stand-in for the app's Nearby bridge. Every message carries the sender's clock (`ts`), so the other phones know how late it arrived and move its cells on that much further, and every phone sends 15 messages a second on the real clock however few frames it draws. `MEASURE=1 BOTS=normal FPS=15 DELAY=60 JIT=80 LOSS=.25` runs the two pages at 15 frames a second over a slow link that loses a quarter of the messages and reports what each phone sends and how far behind the guest draws the host's bots. On phones, the app's log gets each phone's frame rate, messages, losses and lateness every 10 s.
- **Merging**: split pieces can fuse again after 15 s plus a little more for bigger cells (about 20–30 s at everyday sizes). Until then pieces that touch slide around each other; when it is time they glide together and fuse once they overlap.
- **Rating** rewards dying less and winning: finishing 1st of 4+ adds a win bonus, and a run on your second or third life of the round earns 75% or 50% of the gain.
- There is **no cap on a single cell's mass** (the packet format tops out at 8,388,607, far beyond play), and **nothing is immune to phages**: the Phase power-up still stops you being eaten, but phages burst and hunters infect anyone.
- Event banners (blooms, tides, swarms, the Leviathan) show in full for two seconds, then shrink to a small pill in the top-left corner.
- **Placement**: when you die, your place is the number of cells still alive plus one, out of everyone who took part in the round. When the round ends, the survivors are ranked by mass and the biggest wins. The results screen shows "7th of 23" (or *Victory*).
- The host's clock is the round clock; everyone else follows it, so a new host carries the round on. In solo play the page keeps its own clock. `?round=60` on the web shortens rounds for testing.

- You absorb a cell once **30% of its diameter** is inside you and you are at least **10% heavier**. *Digestive enzymes* lowers that to 5%; *Thick membrane* makes others need 20%.
- Cells above 120 mass lose **0.12% of their mass per second** (half that with *Slow metabolism*).
- Ejecting costs 16 mass and makes a 15-mass blob, at most about 8 times a second however hard you hold W.
- Dash costs 4% of your mass.

## Rating

Every player has an Elo-style rating, starting at 0 (the bottom of the rank ladder), adjusted by the server at the end of each run:

| Factor | Effect |
| --- | --- |
| Surviving | +1 per 20 s, up to +25 |
| Each cell absorbed | +2, up to +30 |
| Placing | up to +8 for 1st, scaling down to 0 for last (rounds with at least 4 players) |
| Winning | +10 for 1st (rounds with at least 4 players) |
| Dying inside the first minute | up to −10, the sooner the worse |
| Rating above 1000 | gains shrink and losses grow (at 2000, gains ×0.5 and losses ×1.5), so ratings settle rather than inflate |

Ranks (Rowan, Nov 7): nine steps through the life of a dividing cell, each with divisions I to III (I lowest), and Mitosis alone at the top, 25 ranks in all. Amoeba 0 / 25 / 50, Colony 75 / 100 / 150, Interphase 200 / 250 / 325, Prophase 425 / 525 / 650, Metaphase 800 / 1,000 / 1,200, Anaphase 1,400 / 1,600 / 1,800, Telophase 2,000 / 2,200 / 2,400, Cytokinesis 2,600 / 2,850 / 3,150, Mitosis 3,500. Badges are a faceted crest per step with chevrons for the division (`rankBadge` in index.html), and each step has a trophy (`rankTrophy`), won with the date the first time a competitive life starts or ends at that step or above, the steps below coming with it (wallet `trophies: [{step, at}]`; only lives on the new ladder count). Each wallet also carries `stats`: lives played (20 s or more under ranked rules), wins and top-3 finishes (4+ in the round), seconds alive, cells absorbed (at most 10 + 15 a minute of each life) and the peak rating since the ladder, which the Profile and the permanent quests read. The server sends the ladder as `catalog.ranks` and each wallet's `rank` / `aiRank`; apps from before the ladder still get six metal tiers (`tier`, `tiers`, `tierAt`) spread over the steps: Bronze is Amoeba, Silver Colony, Gold Interphase, Platinum Prophase, Diamond Metaphase, Legend Anaphase and up. When the ladder first starts on a database, every rating and AI rating goes back to 0 (Rowan: everyone starts again); the old values are kept in `rating_v1` / `ai_rating_v1`. `GET /api/leaderboard` returns the top ten with `rankName`.

**Two ratings: vs players and vs AI.** The rating above (labelled *vs players*) moves only for arena lives where the server saw another player alive in the same arena room during the life. Every other life is against bots and moves the separate **AI rating** (*vs AI*), worked out the same way from its own 1000: Casual, ranked games of bots after a search or over Max ping, and arena lives with nobody else alive in the room. Bots can never move the competitive rating. The game can't claim a real opponent: each relay connection gets a secret key in its welcome, `run/start` and `run/end` send it, and the relay notes when that game was alive in the arena while another game in its room was too (`metSince` in server.js, `runKind` in economy.js). Apps from before this send no mode and are rated as they always were. The Profile, the Ranks page and the results screen show both, labelled; the leaderboard is vs players only.

**Win rewards (ATP).** On top of the payout by placement (ranked lives only), a 1st place pays a win bonus and a 2nd or 3rd a smaller one:

| Against | Win | 2nd or 3rd | A ranked win in all |
| --- | --- | --- | --- |
| Players (arena, another player alive in the room) | +50 | +15 | 75 ATP |
| Bots, ranked rules (Master bots) | +25 | +5 | 50 ATP |
| Bots, Casual (no placement payout) | Easy 3, Normal 6, Hard 9, Expert 12, Master 15 | 2nd: 2 / 5 / 7 / 10 / 12; 3rd: 2 / 4 / 6 / 8 / 10 | 15 ATP on Master |

The life must last 2 minutes on the server's clock in a round of 8 or more cells, so an early death, a quit (no placing) or a life never ended pays nothing. There is no daily cap on what an account can earn. `WINS` in economy.js.

**Extra lives.** A player who loses their last life while the round is still open is offered one more for ATP, for 5 seconds. The first costs 10 ATP, and each one after that in the same game costs double: 10, 20, 40, 80, 160, 320, 640, 1,280, and that is the last (8 a game). This works in Ranked against players and bots (Casual has endless lives, Classic no limit, Nearby isn't reported). The bought life continues the same run, so the run is rated once, after the offer is declined or runs out. `EXTRA_LIFE` in economy.js (sent in the catalogue) sets the price, factor, cap, window and modes. `POST /api/run/life` takes the ATP and the count together, and charges once for a repeated tap.

## Levels and XP

Every ranked life earns XP when it ends, worked out by the server:

| Source | XP |
| --- | --- |
| Staying alive | 2 per 10 s, counting up to one whole round (120 XP for 10 minutes) |
| Placing | up to 60 for 1st, scaling down to 0 for last (rounds with at least 4 players, lives of at least 20 s) |
| Winning | +40 for 1st (same conditions) |

So surviving a whole round and winning it is 220 XP, and a 7-minute life that places 2nd of 18 is 142. Survival is the same time the server caps for ATP and rating (what really passed on its clock since the run started), so a client can't claim more. Casual, Nearby and offline games earn no XP (Casual still pays win ATP and moves the AI rating).

XP only ever adds up, into a profile level. Going from level L to L+1 takes 100 + 50 × (L − 1) XP, so each level needs 50 more than the one before: level 2 at 100 XP, level 3 at 250, level 5 at 700, level 10 at 2,700, level 20 at 10,450 and level 50 at 63,700. Signing in on a second device adds that device's XP to the account's; deleting the account deletes its XP. The rules are `XP` in economy.js; the catalogue sends them to the game, which keeps a copy (`XP_FB`) for offline use.

## ATP, skins and purchases

**ATP** is the in-game currency. Every run pays out when it ends:

| Where you placed in the round | ATP |
| --- | --- |
| 1st | 25 |
| 2nd | 20 |
| 3rd | 16 |
| 4th · 5th · 6th | 13 · 11 · 9 |
| 7th · 8th · 9th · 10th | 8 · 7 · 6 · 5 |
| 11th–15th | 3 |
| 16th–20th | 2 |
| 21st–30th | 1 |
| Lower, or a run under 20 seconds | 0 |

**Seasonal skins** go on sale only during their holiday each year and are kept for good once bought: Halloween (Oct 24 – Nov 3) brings Ghost, Widow, Jack-o'-Lantern and Witching Hour. In season they lead the shop with a countdown and the lobby shows an event banner; out of season they leave the shop. The server enforces the window (`SEASONS` in economy.js, with a day's margin for time zones); the game draws the skins, so a new season needs an app update before it starts.

**Quests** are daily, weekly and permanent goals for ranked lives, on a Quests tab in the home bar (and on the battle pass page). There are 4 daily quests (30 ATP each) and 7 weekly ones (100 ATP each); everyone has the same ones, and new sets come at midnight UTC and on Monday at midnight UTC (ISO weeks). Permanent quests are lifetime totals in four tiers that never reset: cells eaten (100 to 100,000), ranked lives, time alive, wins, top-3 finishes and daily quests finished, paying 100, 300, 1,000 and 3,000 ATP. A finished quest waits for its Claim, which pays the ATP, and for daily and weekly quests also their 100 / 300 pass XP while the battle pass is live for the player; a reward not claimed by the end of its day or week waits. Quests count only from what the server checks in `run/end` (the server-capped survival and the placing; cells eaten are the game's count, capped by the life's length), only ranked lives (casual has endless lives), and only lives of 20 s or more; placings need 4 or more in the round, as for XP. Signing in on a second device adds both devices' progress and totals together, and deleting the account deletes them. Quests have their own switch on `/admin/pass`, on unless switched off. The quests are `QUEST_SLOTS` and `PERMANENT` in economy.js; the achievements on the Profile stay as they are (single-life feats with no reward).

Practice and Nearby games pay nothing. There is no hourly cap, but the amounts are deliberately small: winning every ten-minute round is 150 ATP an hour. Most skins cost 300–2,500 ATP, Supernova 6,000, the Black Hole 10,000 and the One Cell to Rule Them All 12,000,000 (eighty $99.99 Biosphere packs), a very long grind, so the packs are the realistic way to get it:

| Pack | ATP |
| --- | --- |
| `atp_500` | 500 |
| `atp_1500` | 1,500 |
| `atp_5000` | 5,000 |
| `atp_12000` | 12,000 |
| `atp_150000` | 150,000 ($99.99) |

Prices are set in App Store Connect and the Play Console; the apps show them from there. Packs can only be bought inside the iOS and Android apps. The website earns ATP but does not sell it.

**Skins** (Nebula, Magma, Honeycomb, Circuit, Leopard, Glacier, Toxic, Eyeball, Galaxy, Gilded, Black Hole, One Cell to Rule Them All) are picked in Inventory (the first tab on the home screen), which shows only the skins you own next to the free colours and patterns; skins you don't own are in the Shop. Owned skins are visible to every other player. The list, with prices, lives in two places that must match: `PREMIUM` in `index.html` (how each skin is drawn) and `SKINS` in `economy.js` (what the server charges).

**Where it lives.** The server owns every wallet. The page only reports "this run ended", "buy this skin" and "credit this purchase"; the server decides the payout, caps it, checks the price and verifies receipts with Apple or Google. A player starts as a random device secret stored in the browser or app, so there is no sign-up. Clearing site data or deleting the app starts a fresh wallet.

**Accounts (Sign in with Apple / Google).** Settings → Account lets a player sign in so the wallet follows them: the app hands the server an identity token, the server verifies it against Apple's or Google's published keys (`auth.js`, no SDK) and links that account to the wallet. Signing in on another device with the same account joins it to that wallet, bringing along any ATP and skins the device earned on its own. Sign out detaches the device and gives it a fresh wallet; the account keeps everything. The iOS app offers Apple sign-in out of the box and Google once `GOOGLE_IOS_CLIENT_ID` is set in `ios/project.yml`; the Android app offers Google once `GOOGLE_WEB_CLIENT_ID` is set in its `build.gradle.kts`. The website shows the buttons only when the server has `APPLE_SERVICES_ID` / `GOOGLE_WEB_CLIENT_ID`, which need a real domain with https.

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
| `MAX_ROOMS` | Arena rooms the relay may open (default 8). Each holds 16 games with its own host and round; past 16 × `MAX_ROOMS` connected games, new ones are told the server is full |
| `APPLE_BUNDLE_ID` | Bundle id purchases must belong to (default `com.mitosisgame.app`). Apple purchases need nothing else: StoreKit 2 hands the app a transaction signed by Apple, and the server checks the certificate chain (to Apple Root CA G3, embedded in `iap.js`), the signature and the payload itself |
| `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Optional App Store Server API key (App Store Connect → Users and Access → Integrations → In-App Purchase). When set, the server also looks every transaction up at Apple. `APPLE_PRIVATE_KEY` is the `.p8` contents; `\n` may stand in for newlines |
| `GOOGLE_PACKAGE_NAME`, `GOOGLE_SERVICE_ACCOUNT` | Play Console service account with *View financial data* on the app. The variable holds the JSON key, raw or base64 |
| `GOOGLE_CLIENT_IDS` | Sign in with Google: comma-separated OAuth client ids (iOS, Android, web) whose ID tokens the server accepts. Unset = Google sign-in refused (HTTP 503) |
| `GOOGLE_WEB_CLIENT_ID` | The client id the website signs in with (also accepted). Needs the site's https origin registered in Google Cloud Console |
| `APPLE_SERVICES_ID` | Sign in with Apple from the website or Android (a Services ID from the Apple Developer portal, with the site's domain verified). The iOS app needs nothing: its tokens are for `APPLE_BUNDLE_ID` |
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

From a network that can't reach the server (some ship, school and office Wi-Fi), deploy through GitHub instead: add the server's SSH private key as the repository secret `DEPLOY_SSH_KEY`, then run Actions › Deploy › Run workflow (or `gh workflow run deploy.yml`). The workflow runs `deploy.sh` on the server and checks the server is serving that commit's `index.html`.

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

`ios/` is a native Swift app that bundles `index.html` in a full-screen `WKWebView` and adds StoreKit 2 purchases, haptics, Sign in with Apple and Nearby play (`Nearby.swift`, MultipeerConnectivity; Info.plist declares the local network use and the `_mitosis-play` Bonjour service). The game loads instantly and plays solo offline; because the page is bundled, game and UI changes reach iPhones through a new app build or a signed page update (below). Debug builds take `-nearby 1` to start in Nearby, so two simulators can test it without tapping either; multiplayer and ATP use the server in `MITOSIS_SERVER` (`ios/project.yml`, currently the OVH box by IP, which is why Info.plist allows arbitrary loads).

- Open `ios/Mitosis.xcodeproj` in Xcode 16+ and run. Signing is automatic for team `4M7HR323EA`; change `DEVELOPMENT_TEAM` and the bundle id in `project.yml` for another account, then `xcodegen generate` (`brew install xcodegen`).
- **Testing purchases in the simulator:** the scheme uses `Mitosis/Products.storekit`, a fake App Store with the four packs. Run a local server with `npm run dev` first: debug builds in the simulator use `http://localhost:3000` when it answers, and the production server otherwise.
- **App Store Connect:** create the app with bundle id `com.mitosisgame.app`, then five consumable in-app purchases with product ids `atp_500`, `atp_1500`, `atp_5000`, `atp_12000`, `atp_150000`. Create an In-App Purchase API key and set the `APPLE_*` variables on the server.
- **Sign in:** `Mitosis.entitlements` carries the Sign in with Apple capability; automatic signing adds it to the App ID. For Google, create an *iOS* OAuth client in Google Cloud Console (bundle id `com.mitosisgame.app`), put its id in `GOOGLE_IOS_CLIENT_ID` in `project.yml`, regenerate, and list the same id in the server's `GOOGLE_CLIENT_IDS`. The app signs in through `ASWebAuthenticationSession` (no Google SDK).
- **Purchase test:** `MitosisTests/PurchaseFlowTests.swift` buys a pack through the real Shop against the StoreKit test store and a local `npm run dev` server. Run it from Xcode; `xcodebuild test` cannot start the StoreKit test environment.
- **TestFlight:** Product → Archive, then Distribute App → App Store Connect. From the terminal: `xcodebuild -project ios/Mitosis.xcodeproj -scheme Mitosis -configuration Release archive -archivePath ios/build/Mitosis.xcarchive -allowProvisioningUpdates`, then export with `ios/ExportOptions.plist`.

- **Page updates (no App Store review):** from build 11 the app can take a newer `index.html` from the server, the way CodePush did for React Native apps. `node tools/page-update.js publish` signs the current `index.html` with the Ed25519 key in `~/.mitosis/page-update-key.pem` (made once with `keygen`; back it up, since apps trust only its public half, built into `PageUpdates.swift`) and writes `updates/ios/manifest.json` + `page.html`. Commit them and deploy the server. An app checks when it opens (and at most every 30 minutes when it returns to the foreground), checks the signature and SHA-256, and shows the page on its next launch. A page that loads but never sends `{type:'booted'}`, or that the app is killed twice before it does, is dropped and the built-in page used again. `publish` covers builds 11 to the one in `project.yml`; a page that needs new native code takes `--min <that build>`. `node tools/page-update.js off` sends every app back to its built-in page, and `check` verifies what is published. Only the page changes this way: native code still needs an App Store build, and Apple allows downloaded web code only while it doesn't change what the app is for.
- **Crash reports:** `CrashReporter.swift` sends MetricKit crash and hang diagnostics (on a later launch) and an immediate backtrace from the exception and signal handlers to the server's `/api/crash`. Read them with `docker logs mitosis | grep '!!'` or in `DATA_DIR/crashes/`.

Regenerate the icon with `swift ios/tools/make-icon.swift ios/Mitosis/Assets.xcassets/AppIcon.appiconset/icon-1024.png`.

## Android app

`android/` is a native Kotlin app that bundles `index.html` in a full-screen `WebView` and adds Google Play Billing and haptics. The build copies the page from the repo root, so the app always ships the current game.

- Open `android/` in Android Studio (Ladybug or newer, Android SDK 35) and run, or `cd android && ./gradlew assembleDebug`.
- The server address is `SERVER_URL` in `android/app/build.gradle.kts`. For a local server from the emulator use `http://10.0.2.2:3000`.
- **Play Console:** create the app with package `com.mitosisgame.app`, add four in-app products with the ids above, upload a signed build to a testing track, and add your Google account as a license tester so purchases are free. Create a service account with *View financial data* and set the `GOOGLE_*` variables on the server.
- Release builds need a signing key: add a `signingConfigs` block in `app/build.gradle.kts` or use Android Studio's *Generate Signed Bundle*.
- **Sign in with Google:** in Google Cloud Console create a *Web* OAuth client and an *Android* client (package `com.mitosisgame.app`, the signing key's SHA-1). Put the web client id in `GOOGLE_WEB_CLIENT_ID` in `app/build.gradle.kts` and in the server's `GOOGLE_CLIENT_IDS`. The app uses Credential Manager; Apple sign-in is not offered on Android until the server has an https domain.

## How it works

| File | What it does |
| --- | --- |
| `index.html` | The whole game: rendering, simulation, bot AI, skins, the ATP client and UI in one self-contained page |
| `server.js` | A zero-dependency Node server that serves the page, relays live state over WebSockets (`/ws`), hosts the economy API (`/api/*`) and a health check at `/health` |
| `economy.js` | ATP rules: run payouts, caps, the skin catalogue, crediting purchases |
| `iap.js` | Purchase verification: Apple-signed StoreKit 2 transactions checked offline (plus the App Store Server API when a key is set), Google Play Developer API for Android. `node iap.test.js` exercises the Apple check with a generated certificate chain |
| `auth.js` | Sign in with Apple / Google: verifies identity tokens (RS256 JWTs) against the providers' published keys, no SDK |
| `store.js` | Storage: SQLite built into Node, or a JSON file on older Node. Players, skins, runs, purchases, sign-in identities and device secrets |
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
| `POST /api/run/start` `{mode, relay}` | Begin a run (server timestamps it). `mode`: `arena`, `bots` (a ranked game of bots on the device) or `casual`; `relay`: the relay connection's key from its welcome. Both optional (older apps send neither) |
| `POST /api/run/end` `{runId, survived, eaten, peak, place, of, bestRank, name, relay, skill}` | Pay out the run by placement plus any win bonus and adjust the rating it was against; idempotent. `kind` says who it was against (`comp`, `ai`, `casual`, or `legacy` for older apps), `ratingDelta` and `aiDelta` how each rating moved (one is 0), `winBonus` the part of `payout` the win paid and `winCapped` whether the day's cap cut it. While the battle pass is on it also fills the pass and moves the quests on: `questsDone` and `questXp` are the quests this life finished, `passUp` the tiers it gained |
| `POST /api/run/life` `{runId, n}` | Buy an extra life on an open run for ATP: n is how many the game has bought (0 for the first), so a repeated tap is answered without paying twice. The price is `base × factor^n`, at most `max` a game. 402 not enough ATP (the message says how much more), 403 the cap or a mode without extra lives, 409 an ended run or a count out of step. |
| `POST /api/skins/buy` `{skinId}` | Spend ATP on a skin (battle pass skins are not for sale) |
| `POST /api/pass` | The battle pass: your tier (`pass.level`; the game says Tier so it is not mixed up with the profile level), Battle Stars, Battle Pass (premium) and claims, plus the season's pages, and `quests`: today's and this week's quests with their progress (`pass`, `quests` and `catalog.pass` are `null` while it is off). Every wallet response carries `quests` |
| `POST /api/pass/premium` `{bundle}` | Buy the Battle Pass for this season with ATP, or the Battle Bundle (the pass plus 10 tiers); once a season |
| `POST /api/quests/claim` `{period, id}` or `{all: true}` | Claim a finished quest (`'d2026-11-20'`/`'w2026-W47'` and the quest id, or `'perm'` and `'eaten-2'` for a permanent tier), or every reward that is ready: pays its ATP, and pass XP for daily and weekly quests while the pass is live; each once |
| `POST /api/pass/claim` `{reward}` | Spend Battle Stars on a reward (`'2c'`: page 2, third reward): it must be on an open page, free or covered by the Battle Pass, and not claimed yet |
| `POST /api/iap/apple` `{transactionId, jws}` | Verify a StoreKit 2 transaction and credit ATP |
| `POST /api/iap/google` `{purchaseToken, productId, orderId}` | Verify a Play purchase and credit ATP |
| `POST /api/auth/apple` `{identityToken, nonce}` | Sign in with Apple: link the account to this wallet, or join the account's wallet (`merged: true`) |
| `POST /api/auth/google` `{idToken, nonce}` | Sign in with Google, same behaviour |
| `POST /api/auth/signout` | Detach this device from the account (the page then starts a fresh secret) |
| `POST /api/account/delete` | `{confirm:'DELETE'}`: delete the player and everything linked (skins, runs, battle pass and quests, sign-ins, devices); purchase receipts stay as anonymous ids so they cannot be replayed. In the game: Profile › Account › Delete account, or Settings › Account & data |
| `POST /api/social/me` `{name, status}` | Friends: your friend code, friends with online status (`menu`, `arena`, `practice`, `nearby`, `spectating`, `offline`), friend requests, your party and party invites. The games call it every few seconds in the menus and every 30 s in a game, which is what makes them show as online |
| `POST /api/social/add` · `accept` · `remove` `{code}` | Send a friend request by friend code (or accept theirs if they already asked); accept one; unfriend, decline or cancel |
| `POST /api/social/party/invite` `{code}` · `join` · `decline` `{party}` · `leave` · `go` | Parties of two friends: invite, join (invites last 5 minutes), leave (ends the party), and `go` when one presses Play so the other follows. Parties live in memory; friend lists in `DATA_DIR/social.json` |
| `POST /api/crash` `{platform, kind, app, os, device, report}` | Crash and hang reports from the apps; logged (`!!` lines) and kept in `DATA_DIR/crashes/` |
| `POST /api/log` `{who, text}` | Client diagnostics: frame stalls, page errors, autopilot events; printed in the server log |
| `POST /api/net` | Connection quality from the game: ping samples, lost pings, frame rate, time zone (anonymous) |
| `GET /admin/net?token=…` | The connection report: ping and frame rate by area, time zone, platform and connection, and what most likely needs fixing. The token is `ADMIN_TOKEN`, or the one the server makes on first start in `data/admin-token` (also printed at start-up). `&days=30`, `&format=json` |
| `GET /admin/live?token=…` | Live players: who is online right now (website, iPhone app, Android app), what they are doing (live arena, searching, solo game, menus, away), arena rooms and their round clocks, peak today and a 24-hour chart. Updates live over `GET /admin/live/stream?token=…` (server-sent events); `&format=json` for the numbers. Same token as the connection report. Counts only; the 24-hour history is kept in `DATA_DIR/live-history.json` |
| `GET /admin/pass?token=…` | The battle pass switch (same token): whether it is on, the season and its dates, and how many players have progress, bought the Battle Pass, claimed rewards and finished quests today and this week. **Testers** see the pass before it is launched: while it is off, and before its season starts (they get the next season). Pick them on the same page from the players who opened the game in the last 30 minutes; what they earn and claim is real and carries into the season. A tester who signs in to another account stays a tester there; deleting the account removes it. The pass is off until you press Turn on; it is shown only while it is on and a season in `PASS_SEASONS` (economy.js) is running. The switch is kept in the database, so it survives deploys |
| `GET /api/catalog` | Skins, packs, payout rules, the battle pass season (while it is on) and which stores are verified |
