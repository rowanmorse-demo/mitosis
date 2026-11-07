# Promo trailers

## The November cuts (hook-first, `hd/`)

Made for the feed, where most people leave in the first five seconds: the first frame is already the best moment in the
game, with huge words on it, and a new moment lands every second (a giant swallows a crowd, a split-and-swallow, a
phage blast). No logo until the end card. Then the redrawn premium skins up close, one a beat; the climb to #1 on the
leaderboard; the Victory screen counting the Elo up to a promotion; and "Download now".

| File (in `promo/out/`, not committed) | |
| --- | --- |
| `mitosis-15s-9x16.mp4` | 1080×1920, 60 fps, 15 s: TikTok, Reels, Shorts |
| `mitosis-6s-hook-9x16.mp4` | 1080×1920, 60 fps, 6 s: the hook and the end card, for ads |
| `mitosis-appstore-30s-1920x886.mp4` | App Store app preview for current iPhones: 1920×886, 30 fps, H.264 High 4.0 at 11 Mbps, AAC 256k stereo, 29.9 s, no prices on screen |
| `…-nomusic.mp4` | the same picture with the game sounds only |

```bash
node promo/capture.js --takes=hd --set=v        # film hd/takes.js in portrait (9:16) into promo/.work/v/
node promo/capture.js --takes=hd --set=h        # and in iPhone landscape for the App Store into promo/.work/h/
node promo/edit.js --cuts=hd                    # cut all three from them
node promo/edit.js --cuts=hd --only=mitosis-15s-9x16 --stills=0,.5,1,2,3,4   # single frames into out/stills/
node promo/edit.js --cuts=hd --only=mitosis-15s-9x16 --secs=5                # just the opening, as -first5s.mp4
```

Add `--preview` to capture and edit for a fast low-resolution pass. Each set is about 1–2 GB of JPEG frames: delete
`promo/.work/v` and `promo/.work/h` when the MP4s are done.

What is new for these, all usable by the October cuts too:
- **A directed camera** (`cam` in a take, `P.cam()` in a brain): the game itself renders the close-ups at full
  sharpness, instead of the editor blowing up a crop. `span` is how much of the world fits across the short side.
- **Clean frames**: `hud: 'clean'` hides the stick, buttons and HUD (the thumbs still press them); `'board'` keeps the
  leaderboard.
- **Sets**: the same take filmed in portrait for the feed and in iPhone landscape for the App Store; takes use
  `S.at`/`S.ang` so "ahead" runs along the long side of either frame.
- **Edit**: per-cut fps and encoder (`enc: 'appstore'`), BT.709 colour tagged properly, zoom and whip transitions,
  a vignette, the `hook` / `tag` / `end` title styles, `--stills` and `--secs`.
- Takes are filmed on Nov 10 (after Halloween, before the Battle Pass): no Halloween or pass skins on screen.

## Recording real play (`record.js`)

Scripted play reads as fake, so the ads are cut from real matches played on this Mac:

```bash
node promo/record.js                     # portrait 1080×1920 for TikTok, Reels and Shorts
node promo/record.js --shape=landscape   # 1920×886 for the App Store
node promo/record.js --skin=22           # wear Supernova (default 15, Black Hole); --name=… for the name on the cell
```

The game opens in its own window. Start a match, press **R** to start a take and **R** again to stop it. The mouse
steers, Space splits, W shoots, Shift boosts. Each take is the game's own canvas (no cursor, browser or HUD in the
video, though you see the HUD while playing) with the game's sound, saved as `promo/rec/<date-time>.mp4` at 60 fps. The
terminal says if any frames came late; retake if it warns of a hitch. Offline by default: the game fills the room
with its own bots on this Mac, so ship Wi-Fi can't make it lag, and the wallet owns every skin on sale. `--online` plays
on the live server instead. `--selftest=4` checks the plumbing headless (4 s of the lobby, no sound).

## The October trailers

Two trailers cut from real gameplay of the current `index.html`, filmed in headless Chrome and played through the
touch controls by a scripted "pilot" that steers like a thumb.

| File (in `promo/out/`, not committed) | |
| --- | --- |
| `mitosis-trailer-30s-16x9.mp4` | 1920×1080, 60 fps, game sounds + an original beat |
| `mitosis-trailer-15s-9x16.mp4` | 1080×1920, 60 fps, for TikTok, Reels and Shorts |
| `…-nomusic.mp4` | the same picture with the game sounds only, to lay a licensed or trending track under in CapCut / TikTok |

## Re-render

```bash
node promo/render.js            # film every take, then cut both trailers (10 minutes on an idle Mac, much longer on a busy one)
node promo/render.js --preview  # quick 768×432 pass to check timing (soft picture, same gameplay frame for frame)
node promo/capture.js --only=chain,finale   # re-film some takes
node promo/edit.js              # re-cut from the takes already filmed (a few minutes)
```

Needs Google Chrome at its default path (or `CHROME=…`), ffmpeg (`/opt/homebrew/bin/ffmpeg` or `FFMPEG=…`), Node 22+,
and a connection the first time (the game's fonts are fetched once into `promo/.work/`). One Chrome runs at a time
and is killed when a script ends or is interrupted.

## How it works

- **`capture.js`** films each take in `takes.js`. The page's clock is virtual (`lib/clock.js`): `performance.now`,
  `Date`, timers, `requestAnimationFrame` and CSS animations only move when the capture steps one 1/60 s frame,
  and `Math.random` is seeded, so a take renders identically every time, at any machine load. The network is
  stubbed: the live room fails (bots on the device) and the economy API answers with a wallet and a ranked result,
  so the lobby and Victory screen show real-looking numbers through the game's own code. Slow motion is filmed,
  not faked: the virtual clock takes smaller steps. Frames are 2560×1440 (a 768×432 phone-landscape viewport at
  3.33×) with the mobile HUD.
- **`pilot.js`** plays the hero by dispatching PointerEvents on the on-screen joystick and buttons, so the knob
  moves with every input. The thumb has a 150–300 ms reaction delay, a slightly underdamped spring, corner-cutting
  on fast turns, tremor and drift, and an aiming error it corrects. `takes.js` stages each moment (`S.hero`,
  `S.bot`, `S.roundAt`, `G.startEvent`…) and plays it (`P.chase`, `P.tap('split')`, `P.hold('shoot', s)`).
  Bots get people's names and a mix of free, premium and Halloween skins.
- **`edit.js`** cuts the takes per `cuts.js` (shots on a 128 BPM grid, anchored to marks the takes record, so a
  re-filmed take still cuts on its moment), composites each frame in Chrome (crops, punch-ins, shakes, titles in
  Bricolage Grotesque and IBM Plex Mono) and encodes with ffmpeg. Every `sfx(kind, …)` the game played is logged
  with its frame and re-rendered offline with the game's own sound code (`lib/audio.js`) at the moment it is on
  screen; `lib/music.js` synthesises the beat. Mixes are loudness-normalised (-14 LUFS with music, -16 without).

`index.html` is not modified. `lib/game.js` makes three capture-only edits to a scratch copy (a `__mt.x` eval hook
behind `?debug=1`, the canvas DPR cap, local fonts) and fails loudly if a later change moves those lines.

## Changing it

- Copy, timing, zooms, music cues: `cuts.js`. Titles are drawn in `lib/editor-page.js`.
- A moment that no longer works after a gameplay change: tune its setup or brain in `takes.js`, re-film it with
  `--preview --only=<id>` and look at the frames in `promo/.work/preview/<id>/frames/`.
- Seasonal: the Halloween caption is in `cuts.js`; the hero skins are `skin:` in each take.
