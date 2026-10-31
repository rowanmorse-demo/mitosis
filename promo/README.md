# Promo trailers

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
