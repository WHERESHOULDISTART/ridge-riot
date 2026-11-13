# 🚵 RIDGE RIOT — Downhill Mayhem

A PS2-era style downhill mountain-bike racer that runs in your browser. No download, no install.

## ▶️ [PLAY NOW — ridge-riot.onrender.com](https://ridge-riot.onrender.com)

> The game runs on a free server that sleeps when nobody is playing. If the page takes up to a minute to open the first time, it is just waking up.

Best on a laptop or desktop with a keyboard or gamepad (no touch controls yet).

## What's in the game

- **12 long routes (3.8–5.2 km) around the world**, each a different kind of terrain:

  | # | Route | Place | Terrain |
  |---|-------|-------|---------|
  | 1 | Rohtang Thunder | Himachal Pradesh, India | High mountain |
  | 2 | Red Rock Rampage | Moab, Utah, USA | Desert canyon |
  | 3 | Amalfi Drop | Amalfi Coast, Italy | Ocean cliff road |
  | 4 | Valparaiso Plunge | Valparaíso, Chile | City streets |
  | 5 | Sakura Slide | Mount Fuji, Japan | Forest singletrack |
  | 6 | Kili Stampede | Kilimanjaro, Tanzania | Open savanna |
  | 7 | Fire & Ice | Fagradalsfjall, Iceland | Volcano ridge at night |
  | 8 | Dune Raider | Merzouga, Sahara, Morocco | Sand dunes |
  | 9 | Bear Claw Bike Park | Whistler, Canada | Jump park forest |
  | 10 | Favela Freefall | Rio de Janeiro, Brazil | City stairs |
  | 11 | Lakeside Lunge | Queenstown, New Zealand | Alpine lake trail |
  | 12 | Glacier Gauntlet | Zermatt, Switzerland | Glacier descent |

- **Solo race** against 7 AI riders, with a **world leaderboard** per route
- **Online**: quick race with whoever is online, or a **private room** you share with a code or invite link. Empty seats are filled with AI riders
- **Split-screen** for 2–4 players on one screen
- **Mid-air stunts**: backflips, frontflips, 360 spins, superman, tabletop, no-hander
- **Boost bar** that fills from air time, clean tricks and hitting rivals
- **11 power-ups**, five of them thrown: Snowballs, Coconut Bowl, Boomerang, Cherry Bomb, Goat Rocket, plus Turbo Chili, Mud Pie, Bubble Shield, Thunder Horn, Spring Boots and Blizzard
- **Hazards**: yaks, zebra herds, elephants, camels, bears, hikers, skiers, traffic, tornadoes and geysers
- **6 bikes** with different stats and **8 paint jobs**
- Kick other riders off their line
- Generated metal soundtrack and sound effects

## Controls

| Action | Keyboard 1 | Keyboard 2 | Gamepad |
|--------|-----------|-----------|---------|
| Pedal / brake | `W` / `S` | `↑` / `↓` | RT / LT |
| Steer | `A` / `D` | `←` / `→` | Left stick |
| Bunny hop | `Space` | `/` | A |
| Kick left / right | `Q` / `E` | `,` / `.` | LB / RB |
| Use or throw power-up | `F` | `Enter` | B |
| Trick button | `Shift` | `Right Shift` | X |
| Burn boost bar | `X` | `N` | Y |
| Camera zoom (3 steps) | `Z` | `Z` | R3 |
| Pause | `Esc` | `Esc` | Start |

In the air: **Trick + Down** backflip, **Trick + Up** frontflip, **Trick + Left/Right** spin, **Trick alone** no-hander, **Kick L** superman, **Kick R** tabletop. Land it straight or you crash.

Every key and gamepad button can be changed in **Controller & Options**.

## Run it on your own computer

```bash
python3 server.py
```

Then open http://localhost:3000. Needs only Python 3.9+ (standard library, nothing to install) and an internet connection, because the 3D engine loads from a CDN.

## Host your own copy

`render.yaml` is included: on [render.com](https://render.com) choose **New > Blueprint**, pick your fork, and deploy. One address then serves the game, the real-time rooms and the leaderboard.

If you host the `public` folder somewhere static instead, set the server address in `public/config.js`.

Free hosts may wipe `data/leaderboard.json` on restart; add a persistent disk to keep times.

## How it's built

- **Three.js** for rendering, plain JavaScript modules, no build step
- **Python standard-library server** (`server.py`): static files, WebSocket rooms, leaderboard API
- Routes, scenery, riders and animals are generated in code
- All audio is synthesised with the Web Audio API

| File | What it does |
|------|--------------|
| `server.py` | Web server, WebSocket rooms, leaderboard API |
| `public/js/track.js` | Route generation, terrain, scenery, buildings, ocean |
| `public/js/rider.js` | Bike and rider model, physics, stunts, AI |
| `public/js/game.js` | Race logic, power-ups, split-screen, net sync, HUD |
| `public/js/hazards.js` | Animals, people, vehicles, tornadoes, geysers |
| `public/js/levels.js` | Route themes, bikes, colours, power-up table |
| `public/js/audio.js` | Sound effects and music |
| `public/js/main.js` | Menus, lobby, leaderboard, options, results |

## Credits

- Ground, wall and rock textures and sky panoramas: [Poly Haven](https://polyhaven.com) (CC0)
- 3D engine: [Three.js](https://threejs.org) (MIT)
