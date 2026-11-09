// ---- Wild animals ----------------------------------------------------------------------------------
// Animals roam the world around the player like zombies do (spawned out of sight, removed far away).
//   bear     territorial: attacks people and zombies that come too close, then goes back home
//   moose    passive until hit, then charges whoever hit it for a while
//   deer     skittish: bolts away from people, zombies and loud noises
//   rabbit   skittish: same, but only notices you up close
//   raccoon  passive; sneaks up to crates left outside (camp crates) and runs off with something
// All of them can be killed. Bodies stay on the ground (hunting will let you butcher them later).
const ANIMAL_TYPES = {
  bear:    { name: 'Bear',    img: 'animalBear', death: 'animalBearDeath', attack: 'animalBearAttack',    hp: 320, walk: 24, run: 126, radius: 14, shadow: [17, 4], animRate: 3,
             kind: 'territorial', territory: 4.5 * TILE, leash: 12 * TILE, damage: 30, zDamage: 55, reach: 36, windup: 0.5, cooldown: 1.3, shove: 16,
             knockMul: 0.15, stunMul: 0.2, cause: 'Mauled by a bear.' },
  moose:   { name: 'Moose',   img: 'animalMoose', death: 'animalMooseDeath', attack: 'animalMooseAttack',   hp: 380, walk: 22, run: 112, radius: 15, shadow: [18, 4], animRate: 2.8,
             kind: 'defensive', angerTime: 18, damage: 34, zDamage: 50, reach: 38, windup: 0.6, cooldown: 1.6, shove: 22,
             knockMul: 0.12, stunMul: 0.2, cause: 'Trampled by a moose.' },
  deer:    { name: 'Deer',    img: 'animalDeer', death: 'animalDeerDeath',    hp: 60,  walk: 26, run: 160, radius: 9,  shadow: [12, 3], animRate: 3.4,
             kind: 'skittish', fear: 7 * TILE, knockMul: 0.5, stunMul: 0.5 },
  rabbit:  { name: 'Rabbit',  img: 'animalRabbit', death: 'animalRabbitDeath',  hp: 10,  walk: 20, run: 150, radius: 4,  shadow: [5, 2],  animRate: 6,
             kind: 'skittish', fear: 3.5 * TILE, knockMul: 1, stunMul: 1 },
  raccoon: { name: 'Raccoon', img: 'animalRaccoon', death: 'animalRaccoonDeath', hp: 24,  walk: 22, run: 112, radius: 7,  shadow: [9, 2],  animRate: 5,
             kind: 'thief', fear: 2.5 * TILE, knockMul: 0.8, stunMul: 0.8 },
 // Farm animals: only on farms, living in the paddock. All passive; hit one and it runs.
  cow:     { name: 'Cow',     img: 'farmCow', death: 'farmCowDeath',     hp: 200, walk: 16, run: 92,  radius: 14, shadow: [16, 4], animRate: 2.6, kind: 'farm', knockMul: 0.15, stunMul: 0.3 },
  pig:     { name: 'Pig',     img: 'farmPig', death: 'farmPigDeath',     hp: 90,  walk: 18, run: 104, radius: 10, shadow: [12, 3], animRate: 3.4, kind: 'farm', knockMul: 0.4,  stunMul: 0.5 },
  chicken: { name: 'Chicken', img: 'farmChicken', death: 'farmChickenDeath', hp: 8,   walk: 20, run: 112, radius: 4,  shadow: [5, 2],  animRate: 6,   kind: 'farm', scatter: 1.5 * TILE, knockMul: 1, stunMul: 1 },
  horse:   { name: 'Horse',   img: 'farmHorse', death: 'farmHorseDeath',   hp: 220, walk: 24, run: 170, radius: 14, shadow: [16, 4], animRate: 3,   kind: 'farm', knockMul: 0.15, stunMul: 0.3 },
  // Farm dogs: wary of strangers, but they come over if you carry food, and feeding one tames it.
  // A tame dog follows you around.
  shepherd: { name: 'German shepherd',    img: 'dogShepherd', death: 'dogShepherdDeath', hp: 60, walk: 30, run: 150, radius: 7, shadow: [9, 2], animRate: 4, kind: 'dog', knockMul: 0.6, stunMul: 0.6 },
  collie:   { name: 'Border collie',      img: 'dogCollie', death: 'dogCollieDeath',   hp: 50, walk: 30, run: 155, radius: 7, shadow: [9, 2], animRate: 4, kind: 'dog', knockMul: 0.7, stunMul: 0.7 },
  terrier:  { name: 'Jack Russell terrier', img: 'dogTerrier', death: 'dogTerrierDeath', hp: 35, walk: 30, run: 145, radius: 5, shadow: [7, 2], animRate: 5, kind: 'dog', knockMul: 0.9, stunMul: 0.9 },
};
// Foods a dog will take from you.
const DOG_FOODS = ['dogfood', 'peanutbutter'];
const A_CAP = 8;                   // most animals around the player at once
const BEAR_GAP = 50 * TILE;        // bears keep well apart from each other
const RACCOON_STEAL_CHANCE = 0.6;  // chance a raccoon actually takes something from a crate it rummages in
const RUMMAGE_TIME = 3;
const A_ANCHOR = 60;
// Death and attack sheets: 4 frames per row, one row per facing.
const A_DIR4_ROW = { S: 0, E: 1, N: 2, W: 3 };
const A_DEATH_TIME = 0.6;          // seconds for the 4-frame collapse
const A_STRIKE_HOLD = 0.2;         // the impact frame stays up a moment after the blow lands               // the animals' feet sit at y=60 in their 64px frames
let animals = [];
let aSpawnT = 4;

function makeAnimal(sp, x, y) {
  const T = ANIMAL_TYPES[sp];
  return { sp, x, y, dir: 'NSEW'[Math.floor(Math.random() * 4)], hp: T.hp, mode: 'idle', t: 1 + Math.random() * 3,
    gx: x, gy: y, home: { x, y }, anim: Math.random() * 4, moving: false, speed: 0, atk: 0, cd: 0, flash: 0, stun: 0,
    target: null, angry: 0, loot: null, visited: [], stuck: 0, detour: 0, dx: 0, dy: 0 };
}

// Animals keep to dry land and walk around trees, rocks and houses.
function moveAnimal(a, vx, vy, speed, dt) {
  const len = Math.hypot(vx, vy); if (len < 0.001) { a.moving = false; return; }
  let ux = vx / len, uy = vy / len;
  if (a.detour > 0) { a.detour -= dt; ux = a.dx; uy = a.dy; }
  const sp = speed * dt, ox = a.x, oy = a.y, r = ANIMAL_TYPES[a.sp].radius;
  const ok = (nx, ny) => !feetBlocked(nx, ny) && Math.hypot(nx - player.x, ny - player.y) >= 10 + r &&
    !animals.some(o => o !== a && !o.dead && Math.hypot(nx - o.x, ny - o.y) < r + ANIMAL_TYPES[o.sp].radius && Math.hypot(a.x - o.x, a.y - o.y) >= r + ANIMAL_TYPES[o.sp].radius);
  if (ok(a.x + ux * sp, a.y)) a.x += ux * sp;
  if (ok(a.x, a.y + uy * sp)) a.y += uy * sp;
  const moved = Math.hypot(a.x - ox, a.y - oy);
  a.moving = moved > sp * 0.2; a.speed = speed;
  faceToward(a, ux, uy);
  if (moved < sp * 0.3) a.stuck += dt; else a.stuck = Math.max(0, a.stuck - dt);
  if (a.stuck > 0.3 && a.detour <= 0) {
    const side = Math.random() < 0.5 ? 1 : -1;
    a.dx = -uy * side; a.dy = ux * side; a.detour = 0.4 + Math.random() * 0.5; a.stuck = 0;
  }
}

// Who's a threat nearby: the player (if outdoors and alive) and zombies. Returns the closest within range.
function closestThreat(a, range, withZombies) {
  let best = null, bd = range;
  if (player.hp > 0 && !buildingAt(player.x, player.y - 4)) {
    const d = Math.hypot(player.x - a.x, player.y - a.y) / (player.crouch ? 0.6 : 1);
    if (d < bd) { bd = d; best = player; }
  }
  if (withZombies) for (const z of zombies) {
    if (z.dead || buildingAt(z.x, z.y - 4)) continue;
    const d = Math.hypot(z.x - a.x, z.y - a.y);
    if (d < bd) { bd = d; best = z; }
  }
  return best;
}
function startFlee(a, fromX, fromY, t) {
  a.mode = 'flee'; a.t = t || 2.5 + Math.random() * 1.5;
  const dx = a.x - fromX, dy = a.y - fromY, d = Math.hypot(dx, dy) || 1;
  // Run away, with a little sideways scatter so a herd doesn't move in lockstep.
  const s = (Math.random() - 0.5) * 0.8;
  a.fx = dx / d - dy / d * s; a.fy = dy / d + dx / d * s;
}
function startCharge(a, target) {
  if (a.mode !== 'charge' && a.mode !== 'maul') { a.mode = 'warn'; a.t = a.sp === 'bear' ? 0.6 : 0.35; }
  a.target = target;
}

function updateAnimal(a, dt) {
  const T = ANIMAL_TYPES[a.sp];
  if (a.flash > 0) a.flash -= dt;
  a.cd = Math.max(0, a.cd - dt);
  if (a.strikeT > 0) a.strikeT -= dt;
  if (a.stun > 0) { a.stun -= dt; a.moving = false; return; }
  a.moving = false;

  if (T.kind === 'farm' || T.kind === 'dog') { updateFarmAnimal(a, T, dt); a.anim += dt * (a.moving ? T.animRate * Math.sqrt(Math.max(0.5, a.speed / T.walk)) : 2.5); return; }
  // Skittish animals and raccoons bolt from people, zombies and loud noises.
  if ((T.kind === 'skittish' || T.kind === 'thief') && a.mode !== 'flee') {
    const th = closestThreat(a, T.fear, true);
    if (th) {
      startFlee(a, th.x, th.y);
      if (a.mode === 'flee' && T.kind === 'skittish') for (const o of animals)   // the herd goes too
        if (o !== a && o.sp === a.sp && o.mode !== 'flee' && Math.hypot(o.x - a.x, o.y - a.y) < 5 * TILE) startFlee(o, th.x, th.y);
    }
  }
  // Bears guard the ground around them.
  if (T.kind === 'territorial' && a.mode !== 'charge' && a.mode !== 'maul' && a.mode !== 'warn') {
    const th = closestThreat(a, T.territory, true);
    if (th && Math.hypot(th.x - a.home.x, th.y - a.home.y) < T.leash) startCharge(a, th);
  }
  // An angry moose keeps after whoever hit it until it calms down.
  if (a.angry > 0) {
    a.angry -= dt;
    if (a.angry <= 0 && (a.mode === 'charge' || a.mode === 'warn')) { a.mode = 'idle'; a.t = 2; a.target = null; }
  }

  const tgt = a.target;
  const tgtGone = !tgt || (tgt === player ? player.hp <= 0 || buildingAt(player.x, player.y - 4) : tgt.dead || buildingAt(tgt.x, tgt.y - 4));

  switch (a.mode) {
    case 'flee': {
      a.t -= dt;
      moveAnimal(a, a.fx, a.fy, T.run, dt);
      if (a.t <= 0) {
        const th = closestThreat(a, T.fear * 1.6, true);
        if (th) startFlee(a, th.x, th.y, 1.5); else { a.mode = 'idle'; a.t = 1 + Math.random() * 2; }
      }
      break;
    }
    case 'warn':   // a bear rears up and faces you for a moment before it charges
      if (tgtGone) { a.mode = 'idle'; a.t = 2; a.target = null; break; }
      faceToward(a, tgt.x - a.x, tgt.y - a.y);
      a.t -= dt; if (a.t <= 0) a.mode = 'charge';
      break;
    case 'charge': {
      if (tgtGone) { a.mode = 'return'; a.target = null; break; }
      const dx = tgt.x - a.x, dy = tgt.y - a.y, d = Math.hypot(dx, dy);
      // A bear gives up once you're out of its territory; a moose once it has calmed down.
      if (T.kind === 'territorial' && (Math.hypot(tgt.x - a.home.x, tgt.y - a.home.y) > T.leash || d > T.territory * 2.2)) { a.mode = 'return'; a.target = null; break; }
      if (T.kind === 'defensive' && a.angry <= 0) { a.mode = 'idle'; a.t = 2; a.target = null; break; }
      const reach = T.reach + (tgt === player ? 0 : ZOMBIE_TYPES[tgt.type].radius);
      if (d <= reach && a.cd <= 0) { a.mode = 'maul'; a.atk = T.windup; faceToward(a, dx, dy); }
      else if (d > reach - 6) moveAnimal(a, dx, dy, T.run, dt);
      else faceToward(a, dx, dy);
      break;
    }
    case 'maul': {
      a.atk -= dt;
      if (tgt) faceToward(a, tgt.x - a.x, tgt.y - a.y);
      if (a.atk > 0) break;
      a.cd = T.cooldown; a.mode = 'charge'; a.strikeT = A_STRIKE_HOLD;
      if (tgtGone) break;
      const dx = tgt.x - a.x, dy = tgt.y - a.y, d = Math.hypot(dx, dy) || 1;
      if (d > T.reach + 14 + (tgt === player ? 0 : ZOMBIE_TYPES[tgt.type].radius)) break;
      makeNoise(a.x, a.y, NOISE.punch, false);
      if (tgt === player) {
        hurtPlayer(T.damage, T.cause, a.x, a.y);
        if (state === 'play') {
          const sx = dx / d * T.shove, sy = dy / d * T.shove;
          if (!feetBlocked(player.x + sx, player.y)) player.x += sx;
          if (!feetBlocked(player.x, player.y + sy)) player.y += sy;
          hurtFx.shake = 1.6;
        }
      } else damageZombie(tgt, T.zDamage, Math.atan2(dy, dx), T.shove * 0.6);
      break;
    }
    case 'return':   // back to the den after a chase
      if (Math.hypot(a.home.x - a.x, a.home.y - a.y) > 10) moveAnimal(a, a.home.x - a.x, a.home.y - a.y, T.walk * 1.4, dt);
      else { a.mode = 'idle'; a.t = 2; }
      break;
    case 'rummage': {   // a raccoon digging through a crate
      a.t -= dt;
      if (a.t > 0) break;
      const c = a.crate; a.crate = null;
      if (Math.random() < RACCOON_STEAL_CHANCE) stealFromCrate(a, c);
      a.mode = 'wander'; [a.gx, a.gy] = wanderTarget(a.x, a.y, 6, 10); a.t = 12;
      break;
    }
    case 'toCrate': {
      const c = a.crate;
      const tx = c.o.x, ty = c.o.y + 10;
      if (Math.hypot(tx - a.x, ty - a.y) < 8 || a.stuck > 2) { a.mode = 'rummage'; a.t = RUMMAGE_TIME; faceToward(a, 0, -1); break; }
      a.t -= dt; if (a.t <= 0) { a.mode = 'idle'; a.crate = null; break; }
      moveAnimal(a, tx - a.x, ty - a.y, T.walk * 1.3, dt);
      break;
    }
    case 'wander':
      a.t -= dt;
      if (Math.hypot(a.gx - a.x, a.gy - a.y) < 6 || a.t <= 0) { a.mode = 'idle'; a.t = 2 + Math.random() * 5; }
      else moveAnimal(a, a.gx - a.x, a.gy - a.y, T.walk, dt);
      break;
    default: {   // idle: graze, look around, then wander off
      a.t -= dt;
      if (a.t > 0) break;
      if (T.kind === 'thief' && !a.loot) {
        const c = findCrateFor(a);
        if (c) { a.crate = c; a.mode = 'toCrate'; a.t = 25; a.visited.push(c.key); break; }
      }
      if (T.kind === 'territorial') {
        // Bears stay near home.
        const a2 = Math.random() * Math.PI * 2, r = Math.random() * T.territory;
        a.gx = a.home.x + Math.cos(a2) * r; a.gy = a.home.y + Math.sin(a2) * r;
      } else [a.gx, a.gy] = wanderTarget(a.x, a.y, a.sp === 'rabbit' ? 1 : 2, a.sp === 'rabbit' ? 3 : 6);
      a.mode = 'wander'; a.t = 10;
    }
  }
  const rate = a.moving ? T.animRate * Math.sqrt(Math.max(0.5, a.speed / T.walk)) : 2.5;
  a.anim += dt * rate;
}

// ---- Farm animals and dogs ------------------------------------------------------------------------
function penTarget(a) {
  // Somewhere inside the paddock (one tile in from the fence).
  const p = a.pen;
  return [(p.x + 1 + Math.random() * (p.w - 2)) * TILE, (p.y + 1 + Math.random() * (p.h - 2)) * TILE + 20];
}
function carriesDogFood() { return carriedItems().find(i => DOG_FOODS.includes(i.key)); }
function updateFarmAnimal(a, T, dt) {
  const dp = Math.hypot(player.x - a.x, player.y - a.y), alive = player.hp > 0;
  if (a.tamed) {
    // Follow the player: trot to catch up, sit still when close.
    if (a.mode === 'flee') { a.t -= dt; moveAnimal(a, a.fx, a.fy, T.run, dt); if (a.t <= 0) a.mode = 'idle'; return; }
    if (dp > 16 * TILE && !onScreen(a.x, a.y)) {   // got left far behind: catch up out of sight
      const [x, y] = behindPlayer(); if (x != null) { a.x = x; a.y = y; }
      return;
    }
    if (dp > 2.5 * TILE) moveAnimal(a, player.x - a.x, player.y - a.y, dp > 6 * TILE ? T.run : T.walk * 2.2, dt);
    else faceToward(a, player.x - a.x, player.y - a.y);
    return;
  }
  if (a.mode === 'flee') {
    a.t -= dt; moveAnimal(a, a.fx, a.fy, T.run, dt);
    if (a.t <= 0) { a.mode = 'idle'; a.t = 1 + Math.random() * 2; }
    return;
  }
  // Chickens scatter if you walk right up to them.
  if (T.scatter && alive && dp < T.scatter) { startFlee(a, player.x, player.y, 1.2); return; }
  if (T.kind === 'dog' && alive && !buildingAt(player.x, player.y - 4)) {
    if (carriesDogFood() && dp < 7 * TILE) {
      // Smells food: comes over and waits a step away from you.
      if (dp > 1.6 * TILE) moveAnimal(a, player.x - a.x, player.y - a.y, T.walk * 1.6, dt);
      else faceToward(a, player.x - a.x, player.y - a.y);
      a.anim += dt * 2; return;
    }
    if (dp < 2.2 * TILE) { startFlee(a, player.x, player.y, 1.2); return; }   // wary of strangers
  }
  if (a.mode === 'wander') {
    a.t -= dt;
    if (Math.hypot(a.gx - a.x, a.gy - a.y) < 6 || a.t <= 0) { a.mode = 'idle'; a.t = 2 + Math.random() * 6; }
    else moveAnimal(a, a.gx - a.x, a.gy - a.y, T.walk, dt);
    return;
  }
  a.t -= dt;
  if (a.t <= 0) { [a.gx, a.gy] = a.pen ? penTarget(a) : wanderTarget(a.x, a.y, 2, 5); a.mode = 'wander'; a.t = 10; }
}
function onScreen(x, y) { return Math.abs(x - player.x) < BW / 2 + 48 && Math.abs(y - player.y) < BH / 2 + 80; }
function behindPlayer() {
  for (let i = 0; i < 12; i++) {
    const ang = Math.random() * Math.PI * 2, r = (12 + Math.random() * 3) * TILE;
    const x = player.x + Math.cos(ang) * r, y = player.y + Math.sin(ang) * r;
    if (!onScreen(x, y) && animalCanStand(x, y)) return [x, y];
  }
  return [null, null];
}
function feedDog(a) {
  const food = carriesDogFood();
  if (!food) { flashMsg('You have nothing a dog would eat'); return; }
  for (const k in inv.equip) if (inv.equip[k] === food) inv.equip[k] = null;
  inv.storage = inv.storage.map(i => i === food ? null : i);
  a.tamed = true; a.mode = 'idle'; a.pen = null;
  if (a.farmRef) { const s = bState(a.farmRef); s.tamed = s.tamed || {}; s.tamed[a.fi] = true; }
  flashMsg(`The ${ANIMAL_TYPES[a.sp].name.toLowerCase()} is yours now. It will follow you`);
  if (invOpen) layoutInventory();
}
// Each farm's animals are fixed by its seed: which kinds it keeps and how many.
function farmStock(f) {
  if (f._stock) return f._stock;
  const r = k => hash01(f.seed, k, 0xfa12), out = [];
  const add = (sp, n) => { for (let i = 0; i < n; i++) out.push(sp); };
  if (r(1) < 0.55) add('cow', 1 + Math.floor(r(2) * 3));
  if (r(3) < 0.45) add('pig', 1 + Math.floor(r(4) * 3));
  if (r(5) < 0.6) add('chicken', 2 + Math.floor(r(6) * 4));
  if (r(7) < 0.3) add('horse', 1 + Math.floor(r(8) * 2));
  if (r(9) < 0.5) add(['shepherd', 'collie', 'terrier'][Math.floor(r(10) * 3)], 1);
  if (!out.length) add('cow', 2);
  return (f._stock = out);
}
// Farms near the player get their animals (the ones still alive and not taken), inside the paddock.
function spawnFarmAnimals() {
  const tx = Math.floor(player.x / TILE), ty = Math.floor(player.y / TILE), R = 34;
  for (const f of plansInRect(world, tx - R, ty - R, tx + R, ty + R).farms) {
    if (!f.pen) continue;
    const s = bstate.get(f.id) || {};
    farmStock(f).forEach((sp, i) => {
      if ((s.dead && s.dead[i]) || (s.tamed && s.tamed[i])) return;
      if (animals.some(a => a.farm === f.id && a.fi === i)) return;
      for (let k = 0; k < 8; k++) {
        const [x, y] = penTarget({ pen: f.pen });
        if (!animalCanStand(x, y)) continue;
        const a = makeAnimal(sp, x, y);
        a.farm = f.id; a.farmRef = f; a.fi = i; a.pen = f.pen;
        animals.push(a);
        return;
      }
    });
  }
}

// ---- Raccoons and crates ---------------------------------------------------------------------------
// Camp crates near a raccoon that it hasn't been through yet (and that the player isn't standing by).
function findCrateFor(a) {
  const R = 14;
  const tx = Math.floor(a.x / TILE), ty = Math.floor(a.y / TILE);
  let best = null, bd = Infinity;
  for (const c of plansInRect(world, tx - R, ty - R, tx + R, ty + R).camps) for (const o of c.objects) {
    if (o.ci === undefined) continue;
    const key = c.id + ':' + o.ci;
    if (a.visited.includes(key)) continue;
    if (Math.hypot(player.x - o.x, player.y - o.y) < 6 * TILE) continue;   // too close to a person
    const d = Math.hypot(o.x - a.x, o.y - a.y);
    if (d < bd) { bd = d; best = { camp: c, o, key }; }
  }
  return best;
}
function stealFromCrate(a, c) {
  const k = KINDS[c.o.k], f = { i: c.o.ci, name: k.crate, crate: true }, s = bState(c.camp);
  if (!s.c[f.i]) s.c[f.i] = rollLoot(c.camp, f);
  const full = s.c[f.i].map((it, i) => it ? i : -1).filter(i => i >= 0);
  if (!full.length) return;
  const i = full[Math.floor(Math.random() * full.length)];
  a.loot = s.c[f.i][i]; s.c[f.i][i] = null;
  if (container && container.items === s.c[f.i] && invOpen) layoutInventory();
  if (Math.hypot(player.x - a.x, player.y - a.y) < 12 * TILE) toast('A raccoon ran off with something');
}

// ---- Getting hurt --------------------------------------------------------------------------------
function hitAnimal(a, W, ang) {
  const T = ANIMAL_TYPES[a.sp];
  const dmg = W.damage[0] + Math.random() * (W.damage[1] - W.damage[0]);
  a.hp -= dmg; a.flash = 0.12;
  a.stun = W.stun * T.stunMul;
  const kx = Math.cos(ang) * W.knockback * T.knockMul, ky = Math.sin(ang) * W.knockback * T.knockMul;
  if (!feetBlocked(a.x + kx, a.y)) a.x += kx;
  if (!feetBlocked(a.x, a.y + ky)) a.y += ky;
  for (let i = 0; i < 2; i++) blood.push({ x: a.x + (Math.random() * 10 - 5), y: a.y - 1 - Math.random() * 4, t: performance.now(), s: 2 });
  if (a.hp <= 0) { killAnimal(a, ang); return; }
  if (T.kind === 'skittish' || T.kind === 'thief' || T.kind === 'farm' || T.kind === 'dog') startFlee(a, player.x, player.y, 4);
  else if (T.kind === 'defensive') { a.angry = T.angerTime; a.target = player; a.mode = 'charge'; }
  else { a.target = player; a.mode = 'charge'; a.home = { x: a.x, y: a.y }; }   // a bear fights back wherever it is
}
function killAnimal(a, ang) {
  const T = ANIMAL_TYPES[a.sp];
  a.dead = true; a.moving = false;
  if (a.farmRef) { const s = bState(a.farmRef); s.dead = s.dead || {}; s.dead[a.fi] = true; }
  // Plays the animal's own collapse animation for the way it was facing.
  corpses.push({ animal: a.sp, x: a.x, y: a.y, sheet: IMG[T.death || T.img], noDeathSheet: !T.death, fx: 0,
    fy: T.death ? A_DIR4_ROW[a.dir] : (a.dir === 'W' ? IDLE_ROW.W : IDLE_ROW.E),
    side: 0, kx: Math.cos(ang) * 3, ky: Math.sin(ang) * 2, t: 0, pool: T.radius * 0.7 + 2, loot: a.loot });
  if (corpses.length > CORPSE_MAX) corpses.shift();
  for (let i = 0; i < Math.ceil(T.radius / 2); i++) blood.push({ x: a.x + (Math.random() * 2 - 1) * T.radius, y: a.y - 2 + Math.random() * 5, t: performance.now(), s: 3 });
}
// Zombies hit by a bear or moose.
function damageZombie(z, dmg, ang, knock) {
  if (z.dead) return;
  const ZT = ZOMBIE_TYPES[z.type];
  z.hp -= dmg; z.flash = 0.12; z.stun = 0.5 * ZT.stunMul;
  const kx = Math.cos(ang) * knock * ZT.knockMul, ky = Math.sin(ang) * knock * ZT.knockMul;
  if (!feetBlocked(z.x + kx, z.y, { water: true })) z.x += kx;
  if (!feetBlocked(z.x, z.y + ky, { water: true })) z.y += ky;
  for (let i = 0; i < 3; i++) blood.push({ x: z.x + (Math.random() * 12 - 6), y: z.y - 1 - Math.random() * 5, t: performance.now(), s: 3 });
  if (z.hp <= 0) { z.dead = true; z.deadT = 0; z.moving = false; addCorpse(z, ang); }
}
// Loud noises scare off skittish animals.
function scareAnimals(x, y, tiles) {
  for (const a of animals) {
    const T = ANIMAL_TYPES[a.sp];
    if (a.dead || T.kind !== 'skittish' || a.mode === 'flee') continue;
    if (Math.hypot(a.x - x, a.y - y) < tiles * TILE * 0.8) startFlee(a, x, y);
  }
}

// ---- Spawning ------------------------------------------------------------------------------------
// Which animals live where depends on how wooded it is. Bears only in proper forest.
function animalWeights(f) {
  return {
    rabbit: f < 0.6 ? 30 : 12,
    deer: f > 0.1 ? 18 : 6,
    raccoon: f > 0.3 ? 9 : 2,
    moose: f > 0.15 && f < 0.85 ? 5 : 1.5,
    bear: f > 0.55 ? 6 : 0,
  };
}
function animalCanStand(x, y) {
  if (buildingAt(x, y - 4) || feetBlocked(x, y) || inWater(x, y)) return false;
  return !animals.some(o => Math.abs(o.x - x) < 16 && Math.abs(o.y - y) < 16);
}
function spawnAnimals() {
  for (let i = 0; i < 10; i++) {
    const ang = Math.random() * Math.PI * 2, r = (14 + Math.random() * 10) * TILE;
    const x = player.x + Math.cos(ang) * r, y = player.y + Math.sin(ang) * r;
    if (Math.abs(x - player.x) < BW / 2 + 64 && Math.abs(y - player.y) < BH / 2 + 96) continue;   // never pop in on screen
    if (!animalCanStand(x, y)) continue;
    const W = animalWeights(world.forest(Math.floor(x / TILE), Math.floor(y / TILE)));
    if (animals.some(a => a.sp === 'bear' && Math.hypot(a.x - x, a.y - y) < BEAR_GAP)) W.bear = 0;
    let roll = Math.random() * Object.values(W).reduce((s, v) => s + v, 0), sp = 'rabbit';
    for (const [k, v] of Object.entries(W)) { roll -= v; if (roll <= 0) { sp = k; break; } }
    const n = sp === 'deer' ? 1 + Math.floor(Math.random() * 3) : sp === 'rabbit' ? 1 + Math.floor(Math.random() * 2) : 1;
    let made = 0;
    for (let k = 0; k < n * 5 && made < n; k++) {
      const ox = made ? (Math.random() * 2 - 1) * 40 : 0, oy = made ? (Math.random() * 2 - 1) * 30 : 0;
      if (!animalCanStand(x + ox, y + oy)) continue;
      animals.push(makeAnimal(sp, x + ox, y + oy)); made++;
    }
    return made;
  }
  return 0;
}
// Raccoons turn up around camps that have crates.
function spawnRaccoonNearCamp() {
  const tx = Math.floor(player.x / TILE), ty = Math.floor(player.y / TILE);
  const camps = plansInRect(world, tx - 30, ty - 30, tx + 30, ty + 30).camps.filter(c => c.objects.some(o => o.ci !== undefined));
  if (!camps.length) return 0;
  const c = camps[Math.floor(Math.random() * camps.length)];
  if (animals.some(a => a.sp === 'raccoon' && Math.hypot(a.x - c.tx * TILE, a.y - c.ty * TILE) < 16 * TILE)) return 0;
  for (let i = 0; i < 10; i++) {
    const ang = Math.random() * Math.PI * 2, r = (7 + Math.random() * 6) * TILE;
    const x = c.tx * TILE + 16 + Math.cos(ang) * r, y = c.ty * TILE + 20 + Math.sin(ang) * r;
    if (Math.abs(x - player.x) < BW / 2 + 64 && Math.abs(y - player.y) < BH / 2 + 96) continue;
    if (!animalCanStand(x, y)) continue;
    animals.push(makeAnimal('raccoon', x, y));
    return 1;
  }
  return 0;
}
function updateAnimals(dt) {
  animals = animals.filter(a => !a.dead && (a.tamed || Math.hypot(a.x - player.x, a.y - player.y) < Z_DESPAWN));
  aSpawnT -= dt;
  if (aSpawnT <= 0) {
    aSpawnT = 8 + Math.random() * 7;
    spawnFarmAnimals();
    if (animals.filter(a => !a.farm && !a.tamed).length < A_CAP) { if (Math.random() < 0.3) spawnRaccoonNearCamp() || spawnAnimals(); else spawnAnimals(); }
  }
  for (const a of animals) updateAnimal(a, dt);
}
// Returns [frame, row, sheet].
function animalFrame(a) {
  const T = ANIMAL_TYPES[a.sp], f = Math.floor(a.anim) % 4;
  if (T.attack) {
    // Wind-up runs through frames 0-2; frame 3 is the blow, held for a moment after it lands.
    if (a.mode === 'maul') return [Math.max(0, Math.min(2, Math.floor((1 - a.atk / T.windup) * 3))), A_DIR4_ROW[a.dir], T.attack];
    if (a.strikeT > 0) return [3, A_DIR4_ROW[a.dir], T.attack];
  }
  return [f, a.moving ? DIR_ROW[a.dir] : IDLE_ROW[a.dir], T.img];
}
function drawAnimal(a) {
  const [fx, fy, sheet] = animalFrame(a);
  if (a.flash > 0) bctx.filter = 'brightness(2.4) saturate(0.3)';
  bctx.drawImage(IMG[sheet], fx * PF, fy * PF, PF, PF, Math.round(a.x - 32), Math.round(a.y - A_ANCHOR), PF, PF);
  if (a.flash > 0) bctx.filter = 'none';
}
function saveAnimals() {
  return animals.filter(a => !a.dead && (!a.farm || a.tamed)).map(a => ({ sp: a.sp, x: Math.round(a.x), y: Math.round(a.y), hp: a.hp, dir: a.dir,
    hx: Math.round(a.home.x), hy: Math.round(a.home.y), loot: a.loot, visited: a.visited, tamed: a.tamed || undefined }));
}
function loadAnimals(list) {
  animals = (list || []).filter(s => ANIMAL_TYPES[s.sp]).map(s => {
    const a = makeAnimal(s.sp, s.x, s.y);
    a.hp = s.hp; a.dir = s.dir || 'S'; a.home = { x: s.hx ?? s.x, y: s.hy ?? s.y }; a.loot = s.loot || null; a.visited = s.visited || []; a.tamed = !!s.tamed;
    return a;
  });
  aSpawnT = 4;
}
