# Still Human

A top-down, pixel-art zombie survival game set in an endless, procedurally generated world.
Every world is new. Every death is final.

## Play

Open `index.html` in a browser. It's fully self-contained, with all the art built in.

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Shift | Run |
| C | Crouch / stand (sneak: 60% speed, almost silent, zombies spot you from closer) |
| Space | Jump (clear rocks, stumps and logs; a mid-air jump dodges a zombie's lunge) |
| Left click | Attack toward the mouse (hold to keep swinging) |
| X | Swap primary and secondary weapon |
| Click a door / furniture | Open or close it / search it (white dots mark what's in reach) |
| Right click (inventory) | Use an item (e.g. bandage) |
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
- Brutes: big, slow zombies with 2.5x health and double damage. They barely stagger, shove you
  back when they hit, and show up alone (about 1 in 20 lone zombies) or mixed into larger hordes.
- Sight and sound: zombies see what's in front of them (about 10 tiles, in a wide cone; up close they
  notice you from any side) and can see into houses through windows and open doors near you. Noise
  draws them over to investigate: footsteps 2.5 tiles, running 7, fighting 4, searching 6, doors 8,
  zombies banging on a door 10, a door or window breaking 13. Walls cut sound by about half. If
  they lose sight of you and hear nothing, they give up.
- Zombie speed varies: 70% normal, 18% slower, 10% faster (up to your walking speed), and a rare 2%
  sprint up to your full running speed.
- Fist fighting: click to punch toward the mouse. Fists only reach about a metre and hit within a
  ~110° arc. Each punch does 9-14 damage (zombies have 100), staggers the zombie, interrupts its
  attack and knocks it back a little.
- Melee weapons (equip in the primary slot): kitchen knife, rolling pin, frying pan, lead pipe,
  crowbar, baseball bat, hatchet and axe, each with its own reach, swing width, damage, speed,
  knockback and noise.
- Zombie deaths: the body staggers from the last blow, topples away from it, bounces as it lands,
  and a blood pool spreads underneath. Bodies stay for 90 seconds, then fade.
- Every zombie gets its own clothing colours (top and bottom; dresses are one colour). Skin, hair,
  eyes, blood and shoes keep the original art.
- Hordes: lone zombies are most common (72%), then groups of 2-4 (22%), hordes of 5-8 (about 5%)
  and large hordes of 10-15 (about 1%). Hordes drift around together, and when one spots you the
  whole horde comes. Groups keep their distance: a new group never spawns within 30 tiles of
  another (60 tiles if either is a big horde), only one big horde is around at a time, and no
  zombie spawns within 7 tiles of another. Up to 36 zombies around you at once.
- Body-part health: head, torso, each arm, hand, leg and foot. Where a zombie hits you depends on
  where it is relative to the way you're facing. If any part reaches 0%, you die. The top-left bar
  shows your most injured part.
- Bleeding: below 70% a part bleeds lightly (clots by itself after 30 s unless hit again),
  below 45% it bleeds steadily, and below 20% it bleeds severely. Bleeding drains that part
  until treated, leaves a blood trail, shows as drops next to the health bar, and pulses on the body figure.
- Day and night: dawn (1.5 min), day (10 min), dusk (1.5 min), night (9 min), in real time while
  playing. Dawn and dusk turn everything warm orange. At night you see clearly up close but the
  distance fades to black; how dark it gets changes from night to night. Campfires, tents and houses
  (through their windows and open doors) give off light, and the lights are on inside houses.
  Zombies spawn a bit more often at night.
- Weather changes every few minutes, blending in over half a minute: clear, overcast (greyer and
  dimmer), rain (pixel rain streaks and splashes; it drowns out sound, so zombies hear less far),
  thunderstorms (heavy wind-blown rain, darker skies, and lightning that flashes the whole screen
  and briefly lights up the night) and fog (drifting fog banks, clear only around you; zombies see
  much less far). Fog is more likely at night and around dawn and dusk. Rain stays outside houses.
- Wild animals roam the world (more in the woods):
  - Bears (forest only) are territorial: get within about 4 tiles and a bear faces you, then
    charges. They maul zombies that wander close too, and return to their spot after a chase.
  - Moose are passive until you hit one, then it charges you for a while.
  - Deer (in small herds) and rabbits run from people, zombies and loud noises. Crouching lets you
    get closer.
  - Raccoons are passive and sneak up to camp crates when nobody is near, sometimes running off with
    something from inside.
  - All of them can be killed: each plays its own collapse animation and leaves a body (hunting and
    drops are coming later). Bears and moose have their own attack animations.
- General stores: every hamlet has one brick store facing the road, with wide shop windows, a
  glass door and a flat roof. Inside: shelf aisles (groceries, candy, batteries, matches...),
  drinks coolers, a checkout counter (lighters, matches, candy) and a stockroom of boxes.
  (Store furniture uses stand-in sprites until its art is made.)
- Flashlight: press F (or right-click it) to switch it on; it lights a cone toward the mouse at
  night. Batteries last about 10 minutes; right-click batteries to refill it.
- Matches and lighters: click a cold campfire to light it (matches and lighters have limited uses).
- Farms: rare, standalone, only on open grassland. A red barn (double doors that open and break
  together, a side door, loft windows) with a dirt yard and track, a fenced paddock with a gate,
  and a field of dead corn. Barn loot: farm tools (pitchfork, shovel, sickle, shears), duct tape,
  rope, work gloves, jars of preserves. Fences can be jumped; click a gate to open or close it.
  Crouching in the corn makes you much harder to spot. (Barn furniture uses stand-in sprites.)
- Farm animals live in farm paddocks only: cows, pigs, chickens, horses and a farm dog (German
  shepherd, border collie or Jack Russell). Each farm keeps its own mix. All are passive and run
  when hit; chickens scatter if you walk right up to them. Dogs are wary of strangers but come over
  if you carry food: click one while carrying peanut butter to feed and tame it, and it follows
  you from then on. Killed farm animals stay dead; a tamed dog is kept in your save.
- Butchering: click a dead animal to butcher it (a couple of seconds the first time), then take
  the meat like loot: beef (cow, 4), pork (pig, 3), chicken (1), bear meat (4), moose meat (4),
  venison (deer, 3), rabbit (1), raccoon (1, plus anything it stole). Carcasses last 10 minutes.
  Meat is raw for now (cooking later). Dogs and horses give no meat.
- Inventory tooltips show what an item is under its name: Weapon, Clothing, Consumable, Craftable
  or Tool, each in its own colour.
- Camps: abandoned campsites deep in thick forest, with a tent, a campfire (usually still burning,
  with flickering flame and drifting smoke) and none, one or a few crates (small, medium, large)
  holding canned food, water, medical supplies and camping gear. Click a crate to search it.
- Houses: lone cabins and small hamlets (3-5 houses along a dirt road), from 4 floor plans that are
  randomly mirrored, with 3 exterior materials. Each house has a condition (abandoned, looted or
  locked up) that sets its doors, windows and loot. Roofs fade and the outside goes dark when you
  walk in; windows and open doors let a little light and sight through. Walls, furniture, closed doors
  and unbroken windows block movement. Zombies find their way in through open doors and broken
  windows; 3 or more together can break doors and windows down (fewer can't). Some houses have
  zombies inside.
- Swimming: walk into rivers and lakes to swim (half speed, splashy, can't attack or use things,
  hunger drains faster). Zombies swim too, but slowly.
- Clothing, headwear and backpacks in the jump, swim and crouch animations are generated from the
  standing sprites by tools/make_wear_moves.py (no extra sheets to draw).
- Healing (right-click to treat the worst wound, or drag onto a body part): cloth rag heals a little
  and slows bleeding; bandage heals more and stops it; first aid kit fully heals the part and stops
  it; antiseptic is kept for infection (coming later). Hoodies, winter coats and beanies can be torn
  into rags (right-click).
- Headwear shows on your character in every animation and protects your head: beanie 5%, bike
  helmet 25%, hard hat 35%, military helmet 50%, motorcycle helmet 60% less damage to the head.
- Tops show on your character too: hoodie (arms/torso +10%), winter coat (+20%), leather jacket
  (arms +35%, torso +30%), utility vest (torso +20%). Backpacks show on your back too. A backpack
  can only come off once its extra slots are empty.
- Searching: hold E at a fridge, counter, dresser or shelves; contents open in a panel beside the
  inventory. Early items: bandages and first aid kits (stop bleeding), food and water (for later),
  kitchen knife and hatchet (weapons), clothes, and small/medium/large backpacks.
- Inventory: body health figure (parts turn red as they're hurt, hover for %), clothing slots
  (helmet, clothes, pants, shoes), primary and secondary weapon, backpack, and 6 storage slots.
  Backpacks add storage: small +3, medium +6, large +12. Drag items between slots; slots only accept the right kind of item.
- Hunger and thirst bars under the health bar. Hunger empties in about 50 minutes and thirst in
  about 30 (faster when running). At zero you start dying. Right-click food or drink to consume it:
  canned beans, canned soup, bread, chips, water, soda and juice, each restoring different amounts.
- Pixel health bar. Damage tints the screen redder the more you're hurt, and hits shake the camera.
- 3 save slots, autosave every 2 minutes, permadeath (the save is deleted on death) and a game over screen.

## Project layout

```
assets/                  art (PNG sprite sheets and tiles)
src/world.js             world generation (noise, terrain, autotiling, objects)
src/buildings_world.js   house floor plans and where hamlets and cabins go
src/game.js              rendering, player, zombies, inventory, map, menus, saves
src/animals.js           wild animals (inlined into game.js by the build)
src/daynight.js          day/night cycle and lighting (inlined into game.js by the build)
src/weather.js           weather: rain, storms, lightning, fog (inlined into game.js by the build)
src/index.template.html  page layout and styles
tools/build.py           bundles everything into index.html
tools/make_body_labels.py  finds the body parts in the inventory art (re-run if the figure changes)
tools/make_wear_moves.py   builds worn-item frames for jump/swim/crouch (re-run when worn items change)
tools/make_clothing_masks.py  finds the clothes on each zombie sheet so they can be recoloured
                         (run it for every new zombie sheet, check with --preview; add --hooded for hoods)
index.html               the built game
```

To rebuild after changing anything in `src/` or `assets/`, run `python3 tools/build.py`.
