# Name fonts

Players pick a font for their name in **Settings › Account › Name style**. Everyone sees it: on their cell in a match, on
the in-match board, in Ranks, in Friends, in the Nearby lobby and on the results screen (your name on a win, the
killer's name when you're eaten).

## Licences

Every font comes from Google Fonts' repository (github.com/google/fonts) under a licence that allows bundling in a
paid app:

- **SIL Open Font License 1.1** (59 fonts): free to use, bundle and sell with software. A copy of each
  font's licence and copyright must go with it. A modified font may not use a *Reserved Font Name*.
- **Apache License 2.0** (5 fonts: Luckiest Guy, Chewy, Permanent Marker, Satisfy, Fontdiner Swanky): free to use,
  bundle and sell. The licence must go with it, and a changed file must say it was changed.

How Mitosis meets those terms:

- `licenses/<font>.txt` is each font's licence as its makers published it; `CREDITS.md` lists every font with its
  designer and licence.
- The game carries the same notices: **Name style › Font credits and licences** lists each font's copyright and
  licence and shows the full OFL and Apache texts. Each embedded font also keeps its own copyright and licence
  fields.
- The fonts are changed (subset to the letters a name can use), so each one is renamed `MitosisName<id>` inside
  the file, and the game shows its own labels ("Marquee", "Arcade", …). No Reserved Font Name is used for a
  modified font; the credits name the original fonts only to thank their makers, as the OFL allows.

## How they're built

`tools/name-fonts.py` reads `fonts.json`, downloads each font and its licence, pins a variable font to one style,
subsets it (Basic Latin letters, digits, the name punctuation `space ! ' ( ) - . ? _ …`, and Latin-1 letters such
as é ñ ü ø), and writes into `index.html`:

- the `<style id="nameFonts">` block in `<head>`: one `@font-face` per font, WOFF2 inlined as base64, with a
  `size-adjust` so names come out about as wide and tall as in the game's own font;
- `NAME_FONTS`, `NF_CREDITS` and `NF_LICENCES` between the `@name-fonts:js` markers.

Letters outside the subset (Polish ł, Cyrillic, CJK and so on) fall back to the game's font one letter at a time.
The fonts are inline so they work offline and travel in a signed page update; 64 fonts add about 0.8 MB to
`index.html`.

```bash
/opt/homebrew/bin/python3 -m venv /tmp/fv && /tmp/fv/bin/pip install fonttools brotli
/tmp/fv/bin/python -I tools/name-fonts.py --cache ~/.cache/mitosis-fonts
```

(`/usr/bin/python3` is the Xcode shim, which hangs while `xcodebuild` runs, so use a venv.)

## Adding or removing a font

- Ids travel in play (presence `nf`) and are stored on the server (`players.name_font`). **Never reuse or renumber
  an id.** Add new fonts with the next free id (1-255). An app that doesn't have an id shows the plain name.
- Removing a font: players who had it see the default. Leave its id unused.
- Only add fonts under the OFL or Apache 2.0 (Google Fonts' `ofl/` and `apache/` folders), and check a new one at
  name sizes (13 px in lists) before adding it: very detailed fonts become a blur and cost a lot of bytes.

## Free or unlocked

All fonts are free. `FONT_LOCKS` in `economy.js` can lock any font by id behind a profile level (`{ lv: 10 }`), an
ATP price (`{ price: 1500 }`, bought once at `POST /api/font/buy`), or the battle pass (`{ pass: 's1' }`, opened by
a pass reward that carries `font: <id>`). The picker shows the locks the server sends.
