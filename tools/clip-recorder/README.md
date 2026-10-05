# Mitosis clip recorder

Films Mitosis practice games and cuts them into edited vertical Shorts (1080×1920, 30 fps, with sound).

- **record.py** plays a practice round and films it frame by frame. The game's own bot brain steers the player cell (the same `think()` the AI microbes use), so the footage looks like competent play. The game runs on a fake clock, one game frame per video frame, so the result is smooth however slow the machine is.
- **edit.py** reads what happened in a take (meals, deaths, evolutions, the #1 crown) and picks the best 25–30 s windows. Each clip gets a hook title, event captions (`+86`, `COMBO x3`, `EATEN`), zoom punches on big meals, an original soundtrack with eat and death sounds, and a Mitosis end card. It also writes a `.json` with a title, description and tags for uploading.
- **audio.py** generates the music and sound effects from scratch, so there are no copyright issues.

The game file is never modified. `record.py` loads `../../index.html`, applies a few recording-only patches in memory, and serves it to a headless Chromium. Practice mode needs no server and no network. The patches are: the bot brain drives the player, any skin can be worn, no automatic low-detail mode, and hooks for reading state.

## Setup (Windows, macOS or Linux)

```sh
cd tools/clip-recorder
python -m pip install -r requirements.txt
python -m playwright install chromium
```

`ffmpeg` must be on PATH. On Windows, `winget install Gyan.FFmpeg` works, then open a new terminal.

## Make lots of clips (the easy way)

```sh
python batch.py --clips 30 --jobs 4
```

This keeps playing games until `clips/` holds 30 clips, then stops. Each game gets a new seed, skin, cell name and play style, and the filming plans alternate:

- **mid**: around the 2-minute mark.
- **late**: minutes 3–5, when cells are huge.
- **endgame**: from about 7:00 through the final ring and the results screen.

Each plan fast-forwards to its start without drawing (about 10× faster than filming) and tries more seeds if the player's cell is too small at that point. Finished takes are cut into their best moments (weak ones are skipped), raw footage is deleted, and every clip is added to `clips/manifest.csv` with its title and description. Set `--jobs` to roughly your CPU core count. Run it again with a different `--seed` for a fresh batch.

## Film a take

```sh
python record.py --out raw/take1 --seed 31 --skin 16 --name Nucleus --diff calm --warmup 75 --seconds 200 --respawn
```

This writes `raw/take1.mp4` (1080×1920 master) and `raw/take1.jsonl` (per-frame stats). On a 2-core cloud box, 200 s of gameplay takes about 15 minutes; a desktop is much faster. You can run several takes in parallel with different seeds and skins.

| Option | Meaning |
| --- | --- |
| `--seed` | Random seed. A different seed gives a different game |
| `--skin` | Skin id: 0–4 free stains, 5 Nebula, 6 Magma, 7 Honeycomb, 8 Circuit, 9 Leopard, 10 Glacier, 11 Toxic, 12 Eyeball, 13 Galaxy, 14 Gilded, 15 Black Hole, 16 One Cell to Rule Them All |
| `--name` | Name shown on the player's cell |
| `--diff` | `calm`, `standard` or `hostile` (the game's own difficulty settings). On `calm` the player grows big enough to hunt, which gives more action |
| `--pers`, `--aggr` | Bot personality for the player (`hunter`, `farmer`, `opportunist`, `sniper`) and aggression 0–1 |
| `--warmup` | Seconds of play before filming starts. Skips the slow pellet-grazing start |
| `--seconds` | Seconds of gameplay to film |
| `--respawn` | Respawn after a death and keep filming. Without it, filming stops 5 s after the first death |
| `--film-from` | Start filming at this second of the round clock, fast-forwarding there without drawing (replaces `--warmup`) |
| `--min-mass`, `--tries` | With `--film-from`: if the cell is smaller than this when filming would start, try the next seed (up to `--tries` seeds) |
| `--until-end` | Stop filming a few seconds after the round ends, so the take finishes on the results screen |

## Cut clips

```sh
python edit.py raw/take1 raw/take2 --out clips --per-take 4 --max 8
```

Use `--dry` to only print which moments it would cut, and `--min-score 5` to skip weak moments. Clip kinds:

- `death`: the build-up and the moment it goes wrong, ending on the game's death card. The caption says DISSOLVED instead of EATEN when the closing arena did it.
- `endgame`: the final ring, ending on the results screen with VICTORY or the placement.
- `crown`: taking #1.
- `feast`: a feeding streak.

The player's AI re-plans every 0.1 s, like a player steering continuously, instead of the bots' slower Calm-difficulty rate.

## Notes

- The footage is real Mitosis gameplay from practice mode, with the player cell driven by the game's AI, not a human. The generated descriptions say so; keep it that way.
- Each recording is a different game, so every clip is unique.
- Fonts in `fonts/` are the game's own Google fonts (Bricolage Grotesque, IBM Plex Mono, SIL Open Font License). They are used for captions and served locally where Google Fonts is unreachable.
