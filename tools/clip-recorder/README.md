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

## Cut clips

```sh
python edit.py raw/take1 raw/take2 --out clips --per-take 4 --max 8
```

Use `--dry` to only print which moments it would cut. Clip kinds are `death` (the build-up and the moment it goes wrong, ending on the game's death card), `crown` (taking #1) and `feast` (a feeding streak).

## Notes

- The footage is real Mitosis gameplay from practice mode, with the player cell driven by the game's AI, not a human. The generated descriptions say so; keep it that way.
- Each recording is a different game, so every clip is unique.
- Fonts in `fonts/` are the game's own Google fonts (Bricolage Grotesque, IBM Plex Mono, SIL Open Font License). They are used for captions and served locally where Google Fonts is unreachable.
