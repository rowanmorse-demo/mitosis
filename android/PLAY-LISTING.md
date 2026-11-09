# Google Play listing: Mitosis: Cell Arena (Android 2.3.0)

What to type into Play Console, field by field. Character limits are Google's. Written for the first Android
release: no Nearby (iPhone only), no Sign in with Google until `GOOGLE_WEB_CLIENT_ID` is set, and no ATP packs
until the Play products and the server's Google key exist (see RELEASE.md).

## Create app
- App name (30): **Mitosis: Cell Arena**
- Default language: English (United States)
- App or game: **Game**
- Free or paid: **Free** (this can't be changed to paid later)
- Declarations: Developer Program Policies, US export laws (Rowan ticks these himself)

## Main store listing
**Short description (80)**

Eat, split and evolve in a live 10-minute cell arena. Last cell standing wins.

**Full description (4000)**

Mitosis is a fast, free cell-eating arena. Absorb anything smaller than you, split to strike, and keep clear of anything bigger. Rounds last ten minutes, the arena closes in, and the last cell standing wins.

LIVE ROUNDS, ANDROID AND IPHONE TOGETHER
Jump into a shared arena in seconds. Android and iPhone players meet in the same live rounds, and if the arena is quiet, bots fill the empty slots so you're never left waiting.

A RATING THAT MEANS SOMETHING
Ranked rounds move your rating from Silver through Gold, Platinum and Diamond to Legend. Survive, absorb and place high to climb; go out early and it drops.

EVOLVE AS YOU GROW
At mass milestones your cell mutates on its own: faster flagella, a tougher membrane, digestive enzymes, mitotic splits and more. Every cell shows the traits it carries, so you can read an opponent before you commit.

A LIVING WORLD
Nutrient blooms make food worth more. Antibiotic tides close the well. Phage swarms break in through the rim. The Leviathan hunts the arena: lure it onto phages to break it up. The leader wears a crown and pays a bounty to whoever takes it.

SKINS AND ATP
Earn ATP by playing and placing well, and spend it in the shop on premium skins. Other players see your skin in every round.

PRACTICE ANY TIME
Play bots at Easy, Normal, Hard or Expert, offline and unranked.

Controls: a virtual joystick with Split, Shoot and Boost buttons. Landscape only. No chat, no ads, no tracking.

**Graphics**
- App icon: 512×512 PNG (from `ios/Mitosis/Assets.xcassets/AppIcon.appiconset/icon-1024.png`, or the new icon if it ships first)
- Feature graphic: 1024×500 PNG or JPEG
- Phone screenshots: 2 to 8, landscape 1920×1080 (Play allows at most 2:1, so the iPhone 2868×1320 shots don't fit)
- 7-inch and 10-inch tablet screenshots: optional

**Category and contact**
- Category: Game › Action. Tags: pick up to five in Play Console (e.g. Action, Arcade, Casual, Multiplayer, Competitive)
- Email: the developer email Google shows on Play
- Website (optional): https://github.com/rowanmorse-demo/mitosis
- Privacy policy: https://github.com/rowanmorse-demo/mitosis/blob/main/PRIVACY.md

## App content (Policy › App content)
- **Privacy policy:** the URL above. PRIVACY.md already names Catapult Consulting, LLC and covers Android.
- **Ads:** No, the app contains no ads.
- **App access:** All functionality is available without special access (no login needed; tap Play).
- **Content rating (IARC questionnaire):** category Game. Violence: none realistic; cells absorbing cells is abstract
  (if asked, cartoon/fantasy, mild). Fear, sexuality, language, controlled substances, crude humour: No. Gambling or
  simulated gambling: No. Users interact: Yes, in multiplayer rounds through display names only; no chat, no
  user-to-user messages, no sharing of photos or location. Digital purchases: Yes (ATP packs, once on sale).
  Expect Everyone / PEGI 3 to 7.
- **Target audience:** 13–15, 16–17 and 18+ (not under 13, matching PRIVACY.md). "Could appeal to children": No.
- **News app:** No. **Health app:** No. **Financial features:** None. **Government app:** No.
- **Advertising ID:** the app does not use it.
- **Data safety:**
  - Does the app collect or share user data? **Yes, collects; shares nothing** with third parties.
  - Encrypted in transit: **No** while the server is `http://51.81.81.166:3000` (an https address would make it Yes).
  - Users can ask for deletion: **Yes**. In the app: Settings › Account › Delete account (also Profile › Account). Delete-account URL
    (Play asks for one): https://github.com/rowanmorse-demo/mitosis/blob/main/PRIVACY.md#deleting-your-data
  - Data types, all **collected, not shared, required, processed for App functionality**:
    - Personal info › **Name** (the display name, a nickname shown to other players)
    - Personal info › **User IDs** (the account the device identity belongs to)
    - Device or other IDs › **Device or other IDs** (the random device identity the app creates)
    - Financial info › **Purchase history** (store transaction ids for ATP packs)
    - App activity › **App interactions** (run results: survival time, cells absorbed, placement); also Analytics
    - App info and performance › **Crash logs** and **Diagnostics** (crash reports, connection quality)
    - Add Personal info › **Email address** only once Sign in with Google is switched on.

## Testing tracks
- Internal testing: add a tester list (Rowan's Google account and any testers' emails), roll out, open the opt-in link
  on an Android phone.
- An organization developer account has no 12-testers-for-14-days closed-test rule; production can follow.
