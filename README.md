# Still Human

A top-down, pixel-art zombie survival game set in an endless, procedurally generated world.
Every world is new. Every death is final.

## Play

Open `index.html` in a browser. It's fully self-contained, with all the art built in.

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Shift | Run |
| Left click | Attack toward the mouse (hold to keep swinging) |
| I / Tab | Open / close the inventory (the game keeps running) |
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
- Walker zombies (5 looks): wander, notice you within about 8 tiles, chase more slowly than you walk,
  lose interest when they lose sight of you, and lunge to attack.
- Zombie speed varies: 70% normal, 18% slower, 10% faster (up to your walking speed), and a rare 2%
  sprint up to your full running speed.
- Fist fighting: click to punch toward the mouse. Fists only reach about a metre and hit within a
  ~110° arc. Each punch does 9-14 damage (zombies have 100), staggers the zombie, interrupts its
  attack and knocks it back a little. Weapons will plug into the same system.
- Every zombie gets its own clothing colours (top and bottom; dresses are one colour). Skin, hair,
  eyes, blood and shoes keep the original art.
- Hordes: lone zombies are most common (55%), then groups of 2-4 (28%), hordes of 5-8 (12%) and
  large hordes of 10-15 (5%). Hordes drift around together, and when one spots you the whole
  horde comes. Bigger hordes spawn further out. Up to 36 zombies around you at once.
- Body-part health: head, torso, each arm, hand, leg and foot. Where a zombie hits you depends on
  where it is relative to the way you're facing. If any part reaches 0%, you die. The top-left bar
  shows your most injured part.
- Bleeding: below 70% a part bleeds lightly (clots by itself after 30 s unless hit again),
  below 45% it bleeds steadily, and below 20% it bleeds severely. Bleeding drains that part
  until treated, leaves a blood trail, shows as drops next to the health bar, and pulses on the body figure.
- Inventory: body health figure (parts turn red as they're hurt, hover for %), clothing slots
  (helmet, clothes, pants, shoes), primary and secondary weapon, backpack, and 6 storage slots.
  Backpacks add storage: small +3, medium +6, large +12. Drag items between slots; slots only accept the right kind of item.
- Pixel health bar. Damage tints the screen redder the more you're hurt, and hits shake the camera.
- 3 save slots, autosave every 2 minutes, permadeath (the save is deleted on death) and a game over screen.

## Project layout

```
assets/                  art (PNG sprite sheets and tiles)
src/world.js             world generation (noise, terrain, autotiling, objects)
src/game.js              rendering, player, zombies, inventory, map, menus, saves
src/index.template.html  page layout and styles
tools/build.py           bundles everything into index.html
tools/make_body_labels.py  finds the body parts in the inventory art (re-run if the figure changes)
tools/make_clothing_masks.py  finds the clothes on each zombie sheet so they can be recoloured
                         (run it for every new zombie sheet, check with --preview; add --hooded for hoods)
index.html               the built game
```

To rebuild after changing anything in `src/` or `assets/`, run `python3 tools/build.py`.
