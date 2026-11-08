# Still Human

A top-down, pixel-art zombie survival game set in an endless, procedurally generated world.
Every world is new. Every death is final.

## Play

Open `index.html` in a browser. It's fully self-contained, with all the art built in.

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Shift | Run |
| M | Open / close the map |
| Esc | Pause (save, quit to menu) |
| F3 | Debug info |

On the map: drag to pan, scroll to zoom, click to add a marker (1–4 picks its colour),
right-click to remove one, C to re-centre.

## Current build

- Endless world generated in 16×16-tile chunks around the player. Only nearby chunks are kept
  in memory, and saves only store what the player changed.
- Grassland biome: green grass, dense patches, dry ground, dirt patches, lakes, winding rivers
  (with occasional natural crossings), woods, and scattered rocks, bushes, logs and stumps.
- Player with 4-direction walk and run animations, collisions, and shadows. Trees fade
  when you walk behind them.
- Minimap and full map that only show explored areas, plus map markers.
- 3 save slots, autosave every 2 minutes, permadeath (the save is deleted on death).

## Project layout

```
assets/                  art (PNG sprite sheets and tiles)
src/world.js             world generation (noise, terrain, autotiling, objects)
src/game.js              rendering, player, map, menus, saves
src/index.template.html  page layout and styles
tools/build.py           bundles everything into index.html
index.html               the built game
```

To rebuild after changing anything in `src/` or `assets/`, run `python3 tools/build.py`.
