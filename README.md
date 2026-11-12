# RIDGE RIOT — Downhill Mayhem

An original PS2-era style downhill mountain-bike racer that runs in the browser.

## Run it

```bash
python3 server.py
```

Then open http://localhost:3000. No installs needed (Python 3.9+ standard library only; the 3D engine loads from a CDN, so you need an internet connection).

Friends on the same Wi-Fi can join at `http://<your-computer's-IP>:3000`. To play over the internet, host `server.py` on any service that runs Python and allows WebSockets (set the `PORT` environment variable if the host requires it).

## Put it online so anyone can play

Online rooms and the shared leaderboard need `server.py` running somewhere public. GitHub itself
only stores the code (GitHub Pages cannot run a server), so:

1. Push this folder to a GitHub repository.
2. On render.com choose **New > Blueprint** and pick the repository. `render.yaml` sets everything up.
   You get one address (for example `https://ridge-riot.onrender.com`) that serves the game, the
   rooms and the leaderboard. Share that address; invite links from private rooms work for anyone.
3. Optional: if you also want the game on GitHub Pages, publish the `public` folder there and put
   the Render address in `public/config.js` (`window.RR_SERVER = 'https://...'`).

Free hosts sleep when idle (the first visitor waits a few seconds) and may wipe
`data/leaderboard.json` on redeploy; add a persistent disk if you want times kept forever.

## What's in it

- 12 long routes (3.8-5.2 km), each a different kind of terrain:
  Himachal Pradesh, Moab, Amalfi Coast, Valparaiso, Mount Fuji, Kilimanjaro, Iceland,
  Sahara dunes, Whistler bike park, Rio de Janeiro, Queenstown, Zermatt glacier
- Photo textures and sky panoramas (CC0, from polyhaven.com) in `public/assets`
- Hazards: crossing animals, hikers and pedestrians, oncoming and cross traffic, parked cars, tornadoes, geysers
- Solo race vs 7 AI riders with a shared leaderboard (`data/leaderboard.json`)
- 2-4 player split-screen (two keyboard layouts + gamepads)
- Online quick race and private invite rooms; empty seats are filled with AI
- 6 bikes, 8 paint jobs, mid-air stunts that pay out turbo boost, kicking
- 11 power-ups, five of them thrown: Snowballs, Coconut Bowl, Boomerang, Cherry Bomb, Goat Rocket
- Boost bar (fills from air time, tricks, hitting rivals, and slowly on its own) and a 3-step camera zoom on `Z`
- Controller & Options menu: rebind keys and gamepad buttons, volumes, vibration, PS2 retro resolution
- Generated metal soundtrack and sound effects (no audio files)

## Files

- `server.py` — web server, WebSocket rooms, leaderboard API
- `public/js/track.js` — procedural mountains and scenery
- `public/js/rider.js` — bike model, physics, stunts, AI
- `public/js/game.js` — race logic, power-ups, split-screen, net sync, HUD
- `public/js/levels.js` — level themes, bikes, colours, power-up table
- `public/js/hazards.js` — animals, people, vehicles, tornadoes, geysers
- `public/js/assets.js` — texture and sky loading
- `public/js/audio.js` — sound effects and music
- `public/js/main.js` — menus, lobby, leaderboard, results
