# Mitosis 2.0

A multiplayer cell-eating arena set in a giant petri well. Absorb anything smaller than you, divide to strike, and keep clear of anything bigger.

**Play now: https://mitosis-zmbc.onrender.com**. Send the link to friends and everyone who opens it shares the same world.

> The free server sleeps after 15 minutes with nobody playing. The first visitor then waits about 50 seconds while it wakes up.

## Features

- **Soft-body cells** that squash against each other and the dish wall, with shadows, organelles and a nucleus that trails motion
- **Live multiplayer** for up to 16 players, with 40–80 AI microbes sharing the world
- **Smarter bots** with personalities (hunters, farmers, opportunists, snipers) that steer around threats, predict prey, split-kill, shoot hunter phages and fire viruses at big targets
- **Evolution**: at mass milestones, pick one of three permanent traits, six times a life
- **World events**: Nutrient Bloom, Antibiotic Tide, Phage Swarm and the Leviathan boss
- **Hunter phages** that breach the rim and inject cells; the cell bursts into up to 16 pieces 8–10 s later
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

On phones, drag to steer and use the on-screen buttons.

## Run it yourself

You only need [Node.js](https://nodejs.org) (LTS). There are no dependencies to install.

```bash
node server.js
# then open http://localhost:3000
```

On Windows, double-click `start.bat`. On macOS, double-click `start.command`.

- **Same Wi-Fi:** send friends the `http://192.168.x.x:3000` link shown in the game's *Play together* box.
- **Anywhere, from your PC:** keep `start.bat` running and double-click `share-online.bat`. It prints a temporary `https://….trycloudflare.com` link.

## Deploy

`render.yaml` is a Render Blueprint for a free web service:

1. Fork or clone this repository.
2. Open `https://render.com/deploy?repo=https://github.com/YOUR-NAME/mitosis` and click **Deploy Blueprint**.
3. To use your own domain, go to the service's **Settings → Custom Domains**.

Any host that runs Node 18+ and supports WebSockets will work. The server reads `PORT` from the environment.

## How it works

| File | What it does |
| --- | --- |
| `index.html` | The whole game: rendering, simulation, bot AI and UI in one self-contained page |
| `server.js` | A zero-dependency Node server that serves the page and relays live state over WebSockets (`/ws`), with a health check at `/health` |
| `render.yaml` | Render deployment settings |

Each player's browser simulates its own cells and shares a compact state snapshot about 15 times a second. The player who has been in the world longest hosts it, running the bots, phages, power-ups and events. If they leave, the next player takes over automatically. Food positions are derived from a shared seed, so only "who ate what" needs to be sent. When a cell is eaten, the eaten cell's own player decides, which keeps fights consistent without a central game server.
