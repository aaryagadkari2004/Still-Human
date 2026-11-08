// ============================================================================
// Still Human — game: rendering, player, map, menus, saves
// ============================================================================
(() => {
'use strict';

// ---- Setup ------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const buf = document.createElement('canvas');        // native-resolution frame
const bctx = buf.getContext('2d');
let scale = 3, BW = 320, BH = 180;

function resize() {
  if (!vignette) makeVignette();
  const w = window.innerWidth, h = window.innerHeight;
  // Aim for roughly 20 x 11.5 tiles on screen, with whole-number pixel scaling.
  scale = Math.max(1, Math.round(Math.min(w / (TILE * 20), h / (TILE * 11.5))));
  BW = Math.ceil(w / scale); BH = Math.ceil(h / scale);
  buf.width = BW; buf.height = BH;
  canvas.width = w; canvas.height = h;
  ctx.imageSmoothingEnabled = false; bctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);

// ---- Assets ------------------------------------------------------------------
const IMG = {};
function loadImages() {
  return Promise.all(Object.entries(ASSETS).map(([name, src]) => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => { IMG[name] = im; res(); }; im.onerror = rej; im.src = src;
  })));
}
let waterPatterns = [];
function prepareAssets() {
  waterPatterns = [0, 1, 2, 3].map(f => {
    const c = document.createElement('canvas'); c.width = c.height = TILE;
    c.getContext('2d').drawImage(IMG.water, f * TILE, 0, TILE, TILE, 0, 0, TILE, TILE);
    return bctx.createPattern(c, 'repeat');
  });
}
const DETAIL_CELLS = [[128, 64], [192, 64], [0, 128], [64, 128], [128, 128], [192, 128]];

// Player sheet: 64x64 frames, 4 per row.
// Rows: idle S, walk S, walk E, walk N, walk W, idle N, idle E, idle W.
const PF = 64, P_AX = 32, P_AY = 58;
const DIR_ROW = { S: 1, E: 2, N: 3, W: 4 };
const IDLE_ROW = { S: 0, N: 5, E: 6, W: 7 };

// ---- Storage (3 save slots) ---------------------------------------------------
const memStore = {};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return memStore[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { memStore[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { delete memStore[k]; } },
};
const slotKey = n => 'stillhuman.slot.' + n;
function readSlot(n) { try { const s = store.get(slotKey(n)); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

function packBits(a) {
  const b = new Uint8Array(32);
  for (let i = 0; i < 256; i++) if (a[i]) b[i >> 3] |= 1 << (i & 7);
  let s = ''; for (let i = 0; i < 32; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function unpackBits(str) {
  const s = atob(str), a = new Uint8Array(256);
  for (let i = 0; i < 256; i++) a[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return a;
}

// ---- Game state --------------------------------------------------------------------
let state = 'loading';    // loading | menu | play | pause | map | dead
let world = null;         // WorldGen
let slot = 0;
let player = null;
let explored = new Map(); // "cx,cy" -> Uint8Array(256)
let markers = [];         // {x, y, c} in tile coords
let playTime = 0, created = 0;
let lastAutosave = 0;

const dataCache = new Map();    // chunk data (small)
const canvasCache = new Map();  // chunk ground canvases (big)
const mapCache = new Map();     // 16x16 map images for explored chunks
const ck = (cx, cy) => cx + ',' + cy;

function resetCaches() { dataCache.clear(); canvasCache.clear(); mapCache.clear(); }

function getData(cx, cy) {
  const key = ck(cx, cy);
  let d = dataCache.get(key);
  if (!d) {
    d = world.genChunk(cx, cy);
    dataCache.set(key, d);
    if (dataCache.size > 700) dataCache.delete(dataCache.keys().next().value); // drop oldest
  }
  return d;
}
function tileAt(tx, ty) {
  const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
  const d = getData(cx, cy), i = (ty - cy * CHUNK) * CHUNK + (tx - cx * CHUNK);
  return { t: d.type[i], e: d.edge[i] };
}

// ---- Chunk ground canvases ------------------------------------------------------------
function drawEdge(g, img, e, dx, dy) {
  let sx, sy;
  if (e < 9) { sx = (e % 3) * TILE; sy = Math.floor(e / 3) * TILE; }
  else { sx = (e - 9) * TILE; sy = 3 * TILE; }
  g.drawImage(img, sx, sy, TILE, TILE, dx, dy, TILE, TILE);
}
function buildChunkCanvas(cx, cy) {
  const d = getData(cx, cy);
  const c = document.createElement('canvas'); c.width = c.height = CPX;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  for (let i = 0; i < CHUNK * CHUNK; i++) {
    const dx = (i % CHUNK) * TILE, dy = Math.floor(i / CHUNK) * TILE;
    const t = d.type[i], e = d.edge[i], v = d.vari[i];
    if (t === T_WATER) { if (e !== EDGE_CENTER) drawEdge(g, IMG.edgeWater, e, dx, dy); }
    else if (t === T_DIRT) {
      if (e !== EDGE_CENTER) drawEdge(g, IMG.edgeDirt, e, dx, dy);
      else if (v < 2) drawEdge(g, IMG.edgeDirt, EDGE_CENTER, dx, dy);
      else g.drawImage(IMG.ground, ((v - 2) % 4) * TILE, 64 + (v > 5 ? TILE : 0), TILE, TILE, dx, dy, TILE, TILE);
    }
    else if (t === T_DRY) g.drawImage(IMG.grass, v * TILE, TILE, TILE, TILE, dx, dy, TILE, TILE);
    else g.drawImage(IMG.grass, v * TILE, 0, TILE, TILE, dx, dy, TILE, TILE);
  }
  for (const det of d.details) {
    const [sx, sy] = DETAIL_CELLS[det.d];
    g.drawImage(IMG.ground, sx + 16, sy + 16, TILE, TILE, det.x, det.y, TILE, TILE);
  }
  return c;
}
function getChunkCanvas(cx, cy, mustHave) {
  const key = ck(cx, cy);
  let c = canvasCache.get(key);
  if (!c && mustHave) { c = buildChunkCanvas(cx, cy); canvasCache.set(key, c); }
  return c;
}
function unloadFarChunks(camX, camY) {
  const ccx = (camX + BW / 2) / CPX, ccy = (camY + BH / 2) / CPX;
  const lim = Math.max(BW, BH) / CPX / 2 + 2.5;
  for (const [key, c] of canvasCache) {
    const [x, y] = key.split(',').map(Number);
    if (Math.abs(x + 0.5 - ccx) > lim || Math.abs(y + 0.5 - ccy) > lim) canvasCache.delete(key);
  }
}

// ---- Map images (1 pixel per tile) ------------------------------------------------------
const MAP_COL = {
  [T_GRASS]: [79, 90, 42], [T_DRY]: [112, 94, 64], [T_DIRT]: [116, 82, 62], [T_WATER]: [58, 88, 92],
};
const MAP_TREE = [44, 56, 28];
function buildMapImage(cx, cy) {
  const d = getData(cx, cy), ex = explored.get(ck(cx, cy));
  const c = document.createElement('canvas'); c.width = c.height = CHUNK;
  const g = c.getContext('2d'), im = g.createImageData(CHUNK, CHUNK);
  const trees = new Uint8Array(256);
  for (const o of d.objects) if (KINDS[o.k].tall && o.k !== K.boulder) {
    const tx = Math.floor(o.x / TILE) - cx * CHUNK, ty = Math.floor(o.y / TILE) - cy * CHUNK;
    if (tx >= 0 && ty >= 0 && tx < CHUNK && ty < CHUNK) trees[ty * CHUNK + tx] = 1;
  }
  for (let i = 0; i < 256; i++) {
    if (!ex || !ex[i]) continue;
    const col = trees[i] ? MAP_TREE : MAP_COL[d.type[i]];
    im.data[i * 4] = col[0]; im.data[i * 4 + 1] = col[1]; im.data[i * 4 + 2] = col[2]; im.data[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}
let mapBuildBudget = 0;
function getMapImage(cx, cy) {
  const key = ck(cx, cy);
  const m = mapCache.get(key);
  if (m && !m.dirty) return m.c;
  if (mapBuildBudget <= 0) return m ? m.c : null;
  mapBuildBudget--;
  const c = buildMapImage(cx, cy);
  mapCache.set(key, { c, dirty: false });
  return c;
}

const REVEAL_R = 14;
function revealAround(px, py) {
  const ptx = Math.floor(px / TILE), pty = Math.floor(py / TILE);
  const touched = new Set();
  for (let dy = -REVEAL_R; dy <= REVEAL_R; dy++) for (let dx = -REVEAL_R; dx <= REVEAL_R; dx++) {
    if (dx * dx + dy * dy > REVEAL_R * REVEAL_R) continue;
    const tx = ptx + dx, ty = pty + dy;
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK), key = ck(cx, cy);
    let ex = explored.get(key);
    if (!ex) { ex = new Uint8Array(256); explored.set(key, ex); }
    const i = (ty - cy * CHUNK) * CHUNK + (tx - cx * CHUNK);
    if (!ex[i]) { ex[i] = 1; touched.add(key); }
  }
  for (const key of touched) { const m = mapCache.get(key); if (m) m.dirty = true; }
}

// ---- Collision ------------------------------------------------------------------------------
const SHORE = 10; // pixels of walkable bank inside water edge tiles
function rectsHit(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) { return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0; }
function blocked(x0, y0, x1, y1) {
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 0.01) / TILE); ty++)
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x1 - 0.01) / TILE); tx++) {
      const { t, e } = tileAt(tx, ty);
      if (t !== T_WATER) continue;
      let wx0 = tx * TILE, wy0 = ty * TILE, wx1 = wx0 + TILE, wy1 = wy0 + TILE;
      if (e < 9) {
        const col = e % 3, row = Math.floor(e / 3);
        if (col === 0) wx0 += SHORE; if (col === 2) wx1 -= SHORE;
        if (row === 0) wy0 += SHORE; if (row === 2) wy1 -= SHORE;
      }
      if (rectsHit(x0, y0, x1, y1, wx0, wy0, wx1, wy1)) return true;
    }
  const cx0 = Math.floor((x0 - 64) / CPX), cx1 = Math.floor((x1 + 64) / CPX);
  const cy0 = Math.floor((y0 - 32) / CPX), cy1 = Math.floor((y1 + 32) / CPX);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    for (const o of getData(cx, cy).objects) {
      const k = KINDS[o.k]; if (!k.cw) continue;
      if (rectsHit(x0, y0, x1, y1, o.x - k.cw / 2, o.y - k.ch, o.x + k.cw / 2, o.y)) return true;
    }
  }
  return false;
}

// ---- Player ------------------------------------------------------------------------------------
const WALK = 72, RUN = 138;     // pixels per second (a tile is ~1 metre)
const FEET_W = 14, FEET_H = 6;
function newPlayer(x, y) { return { x, y, dir: 'S', moving: false, running: false, anim: 0, hp: 100 }; }
function feetBlocked(x, y) { return blocked(x - FEET_W / 2, y - FEET_H, x + FEET_W / 2, y); }

function findSpawn(seedRand) {
  // Random spot far from the origin, then search outward for clear land.
  const ang = seedRand() * Math.PI * 2, dist = 2000 + seedRand() * 20000;
  const sx = Math.round(Math.cos(ang) * dist), sy = Math.round(Math.sin(ang) * dist);
  for (let r = 0; r < 200; r += 3) for (let a = 0; a < 16; a++) {
    const tx = sx + Math.round(Math.cos(a / 16 * Math.PI * 2) * r), ty = sy + Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
    let ok = true;
    for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3 && ok; dx++) if (tileAt(tx + dx, ty + dy).t === T_WATER) ok = false;
    const px = tx * TILE + 16, py = ty * TILE + 24;
    if (ok && !feetBlocked(px, py) && !blocked(px - 24, py - 24, px + 24, py + 8)) return { x: px, y: py };
  }
  return { x: sx * TILE + 16, y: sy * TILE + 24 };
}

const keys = new Set();
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
  if (!e.repeat) onKeyPress(k);
  keys.add(k);
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function updatePlayer(dt) {
  let vx = 0, vy = 0;
  if (keys.has('w') || keys.has('arrowup')) vy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) vy += 1;
  if (keys.has('a') || keys.has('arrowleft')) vx -= 1;
  if (keys.has('d') || keys.has('arrowright')) vx += 1;
  const p = player;
  p.moving = vx !== 0 || vy !== 0;
  p.running = p.moving && keys.has('shift');
  if (p.moving) {
    const len = Math.hypot(vx, vy), sp = (p.running ? RUN : WALK) * dt;
    const mx = vx / len * sp, my = vy / len * sp;
    if (Math.abs(vx) > Math.abs(vy)) p.dir = vx > 0 ? 'E' : 'W';
    else if (Math.abs(vy) > Math.abs(vx)) p.dir = vy > 0 ? 'S' : 'N';
    else if (!((vx > 0 && p.dir === 'E') || (vx < 0 && p.dir === 'W') || (vy > 0 && p.dir === 'S') || (vy < 0 && p.dir === 'N'))) p.dir = vx > 0 ? 'E' : 'W';
    if (!feetBlocked(p.x + mx, p.y)) p.x += mx;
    if (!feetBlocked(p.x, p.y + my)) p.y += my;
    p.anim += dt * (p.running ? 11 : 7);
  } else {
    p.anim += dt * 3;
  }
}
function playerFrame(p) {
  const f = Math.floor(p.anim) % 4;
  return [f, p.moving ? DIR_ROW[p.dir] : IDLE_ROW[p.dir]];
}

// ---- Player health & hurt effects -----------------------------------------------------------
const MAX_HP = 100;
const hurtFx = { shake: 0, flash: 0, lagHp: MAX_HP, deathT: 0 };
function hurtPlayer(amount, cause) {
  if (state !== 'play' && state !== 'map') return;
  if (state === 'map') closeMap();
  player.hp = Math.max(0, player.hp - amount);
  hurtFx.shake = 1; hurtFx.flash = 1;
  if (player.hp <= 0) startDying(cause);
}
function updateHurtEffects(dt) {
  hurtFx.shake = Math.max(0, hurtFx.shake - dt * 3.2);
  hurtFx.flash = Math.max(0, hurtFx.flash - dt * 2.2);
  if (player) {
    // The pale "lag" bar drains toward real health after a short delay.
    if (hurtFx.lagHp > player.hp) hurtFx.lagHp = Math.max(player.hp, hurtFx.lagHp - dt * 30 * (hurtFx.flash > 0.6 ? 0 : 1));
    else hurtFx.lagHp = player.hp;
  }
}
function shakeOffset() {
  if (hurtFx.shake <= 0) return [0, 0];
  const m = 2.5 * hurtFx.shake * hurtFx.shake;
  return [Math.round((Math.random() * 2 - 1) * m), Math.round((Math.random() * 2 - 1) * m)];
}

// ---- Zombies ------------------------------------------------------------------------------------
// Each type: art (one or more looks, picked at random), speeds (px/s), health,
// attack, senses. New types go here.
const ZOMBIE_TYPES = {
  walker: {
    imgs: ['zWalker', 'zWalker2'], speed: 46, wanderSpeed: 18, hp: 100,
    damage: 12, reach: 27, windup: 0.45, cooldown: 1.4,
    sight: 8 * TILE, notice: 3 * TILE, forget: 5, animRate: 5,
  },
};
const Z_CAP = 9;              // most zombies around the player at once
const Z_DESPAWN = 42 * TILE;  // zombies further than this are removed
let zombies = [];
let zSpawnT = 0;
function makeZombie(type, x, y) {
  const T = ZOMBIE_TYPES[type];
  return { type, look: Math.floor(Math.random() * T.imgs.length), x, y, dir: 'NSEW'[Math.floor(Math.random() * 4)], moving: false, anim: Math.random() * 4,
    mode: 'idle', t: 1 + Math.random() * 3, gx: x, gy: y, atk: 0, cd: 0, hp: T.hp, lostT: 0, stuck: 0, detour: 0, dx: 0, dy: 0 };
}
function faceToward(a, vx, vy) {
  if (Math.abs(vx) > Math.abs(vy)) a.dir = vx > 0 ? 'E' : 'W'; else a.dir = vy > 0 ? 'S' : 'N';
}
function moveZombie(z, vx, vy, speed, dt) {
  const len = Math.hypot(vx, vy); if (len < 0.001) { z.moving = false; return; }
  let ux = vx / len, uy = vy / len;
  if (z.detour > 0) { z.detour -= dt; ux = z.dx; uy = z.dy; }
  const sp = speed * dt;
  const ox = z.x, oy = z.y;
  const tryMove = (nx, ny) => {
    if (feetBlocked(nx, ny)) return false;
    if (Math.hypot(nx - player.x, ny - player.y) < 20) return false;          // don't walk into the player
    for (const o of zombies) if (o !== z && Math.hypot(nx - o.x, ny - o.y) < 13 && Math.hypot(z.x - o.x, z.y - o.y) >= 13) return false;
    return true;
  };
  if (tryMove(z.x + ux * sp, z.y)) z.x += ux * sp;
  if (tryMove(z.x, z.y + uy * sp)) z.y += uy * sp;
  const moved = Math.hypot(z.x - ox, z.y - oy);
  z.moving = moved > sp * 0.2;
  faceToward(z, ux, uy);
  // Stuck on a tree or shoreline: side-step for a moment.
  if (moved < sp * 0.3) z.stuck += dt; else z.stuck = Math.max(0, z.stuck - dt);
  if (z.stuck > 0.35 && z.detour <= 0) {
    const side = Math.random() < 0.5 ? 1 : -1;
    z.dx = -uy * side; z.dy = ux * side; z.detour = 0.5 + Math.random() * 0.5; z.stuck = 0;
  }
}
function updateZombie(z, dt) {
  const T = ZOMBIE_TYPES[z.type];
  const ddx = player.x - z.x, ddy = player.y - z.y, d = Math.hypot(ddx, ddy);
  const alive = player.hp > 0;
  const sees = alive && (d < T.notice || d < T.sight);
  z.cd = Math.max(0, z.cd - dt);

  if (z.mode === 'attack') {
    z.moving = false; faceToward(z, ddx, ddy);
    z.atk -= dt;
    if (z.atk <= 0) {
      if (alive && d <= T.reach + 8) hurtPlayer(T.damage, 'Killed by a zombie.');
      z.cd = T.cooldown; z.mode = 'chase';
    }
  } else if (sees) {
    z.mode = 'chase'; z.lostT = 0; z.gx = player.x; z.gy = player.y;
    if (d <= T.reach && z.cd <= 0) { z.mode = 'attack'; z.atk = T.windup; z.moving = false; }
    else if (d > T.reach - 4) moveZombie(z, ddx, ddy, T.speed, dt);
    else { z.moving = false; faceToward(z, ddx, ddy); }
  } else if (z.mode === 'chase') {
    // Lost sight: walk to where the player was last seen, then give up.
    z.lostT += dt;
    const gx = z.gx - z.x, gy = z.gy - z.y;
    if (Math.hypot(gx, gy) > 6 && z.lostT < T.forget) moveZombie(z, gx, gy, T.speed, dt);
    else { z.mode = 'idle'; z.t = 2 + Math.random() * 3; z.moving = false; }
  } else if (z.mode === 'wander') {
    const gx = z.gx - z.x, gy = z.gy - z.y;
    z.t -= dt;
    if (Math.hypot(gx, gy) < 4 || z.t <= 0) { z.mode = 'idle'; z.t = 2 + Math.random() * 4; z.moving = false; }
    else moveZombie(z, gx, gy, T.wanderSpeed, dt);
  } else {
    z.moving = false; z.t -= dt;
    if (z.t <= 0) {
      const a = Math.random() * Math.PI * 2, r = (2 + Math.random() * 5) * TILE;
      z.mode = 'wander'; z.gx = z.x + Math.cos(a) * r; z.gy = z.y + Math.sin(a) * r; z.t = 12;
    }
  }
  z.anim += dt * (z.moving ? T.animRate * (z.mode === 'chase' ? 1 : 0.6) : 2.5);
}
function zombieFrame(z) {
  const f = Math.floor(z.anim) % 4;
  if (z.mode === 'attack') return [Math.floor((1 - z.atk / ZOMBIE_TYPES[z.type].windup) * 3.99), DIR_ROW[z.dir]];
  return [f, z.moving ? DIR_ROW[z.dir] : IDLE_ROW[z.dir]];
}
function trySpawnZombie(minR, maxR) {
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, r = (minR + Math.random() * (maxR - minR)) * TILE;
    const x = player.x + Math.cos(a) * r, y = player.y + Math.sin(a) * r;
    // Never pop in on screen.
    if (Math.abs(x - player.x) < BW / 2 + 48 && Math.abs(y - player.y) < BH / 2 + 96) continue;
    if (tileAt(Math.floor(x / TILE), Math.floor(y / TILE)).t === T_WATER || feetBlocked(x, y)) continue;
    zombies.push(makeZombie('walker', x, y));
    return true;
  }
  return false;
}
function updateZombies(dt) {
  zombies = zombies.filter(z => Math.hypot(z.x - player.x, z.y - player.y) < Z_DESPAWN);
  zSpawnT -= dt;
  if (zSpawnT <= 0) {
    zSpawnT = 7 + Math.random() * 9;
    if (zombies.length < Z_CAP) {
      const group = Math.random() < 0.25 ? 2 : 1;
      for (let i = 0; i < group && zombies.length < Z_CAP; i++) trySpawnZombie(16, 28);
    }
  }
  for (const z of zombies) updateZombie(z, dt);
}

// ---- Dying ---------------------------------------------------------------------------------------
let deathCause = '';
function startDying(cause) {
  deathCause = cause || '';
  state = 'dying'; hurtFx.deathT = 0;
  player.moving = false;
  store.del(slotKey(slot)); // permadeath: the save is gone as soon as you die
  ui.hint.classList.add('hidden');
}

// ---- World rendering ---------------------------------------------------------------------------
let frameTime = 0;
function drawShadow(x, y, rx, ry) {
  if (!rx) return;
  bctx.beginPath();
  bctx.ellipse(Math.round(x + rx * 0.25), Math.round(y - 1), rx, ry, 0, 0, Math.PI * 2);
  bctx.fill();
}
function renderWorld(camX, camY, withPlayer) {
  const frame = Math.floor(frameTime / 450) % 4;
  bctx.setTransform(1, 0, 0, 1, -camX, -camY);
  bctx.fillStyle = waterPatterns[frame];
  bctx.fillRect(camX, camY, BW, BH);

  const cx0 = Math.floor(camX / CPX), cy0 = Math.floor(camY / CPX);
  const cx1 = Math.floor((camX + BW) / CPX), cy1 = Math.floor((camY + BH) / CPX);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++)
    bctx.drawImage(getChunkCanvas(cx, cy, true), cx * CPX, cy * CPX);
  // Pre-build one chunk canvas just outside the view each frame, so walking stays smooth.
  outer: for (let cy = cy0 - 1; cy <= cy1 + 1; cy++) for (let cx = cx0 - 1; cx <= cx1 + 1; cx++)
    if (!canvasCache.has(ck(cx, cy))) { getChunkCanvas(cx, cy, true); break outer; }

  // Objects in view (tall sprites reach up from chunks below the view).
  const items = [];
  for (let cy = cy0; cy <= cy1 + 1; cy++) for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) {
    for (const o of getData(cx, cy).objects) {
      const k = KINDS[o.k], sx = o.x - k.ax, sy = o.y - k.ay;
      if (sx + k.sw < camX || sx > camX + BW || sy + k.sh < camY || sy > camY + BH + 8) continue;
      items.push(o);
    }
  }
  if (withPlayer) {
    items.push({ k: -1, x: player.x, y: player.y });
    for (const z of zombies) {
      if (z.x < camX - 40 || z.x > camX + BW + 40 || z.y < camY - 8 || z.y > camY + BH + 64) continue;
      items.push({ k: -2, x: z.x, y: z.y, z });
    }
  }
  items.sort((a, b) => a.y - b.y);

  bctx.fillStyle = 'rgba(16, 20, 8, 0.32)';
  for (const o of items) {
    if (o.k < 0) drawShadow(o.x, o.y, 9, 3);
    else { const k = KINDS[o.k]; drawShadow(o.x, o.y, k.rx, k.ry); }
  }

  const pbx0 = withPlayer ? player.x - 11 : 0, pby0 = withPlayer ? player.y - 46 : 0;
  for (const o of items) {
    if (o.k === -1) {
      const [fx, fy] = playerFrame(player);
      bctx.drawImage(IMG.player, fx * PF, fy * PF, PF, PF, Math.round(o.x - P_AX), Math.round(o.y - P_AY), PF, PF);
      continue;
    }
    if (o.k === -2) {
      const [fx, fy] = zombieFrame(o.z);
      // Lunge forward slightly at the end of an attack.
      let lx = 0, ly = 0;
      if (o.z.mode === 'attack' && o.z.atk < 0.15) { const v = { N: [0, -3], S: [0, 3], E: [3, 0], W: [-3, 0] }[o.z.dir]; lx = v[0]; ly = v[1]; }
      bctx.drawImage(IMG[ZOMBIE_TYPES[o.z.type].imgs[o.z.look] || ZOMBIE_TYPES[o.z.type].imgs[0]], fx * PF, fy * PF, PF, PF, Math.round(o.x - P_AX + lx), Math.round(o.y - P_AY + ly), PF, PF);
      continue;
    }
    const k = KINDS[o.k], sx = o.x - k.ax, sy = o.y - k.ay;
    let fade = false;
    if (withPlayer && k.tall && player.y < o.y &&
        rectsHit(pbx0, pby0, pbx0 + 22, player.y, sx + 4, sy, sx + k.sw - 4, o.y - k.ch)) fade = true;
    if (fade) bctx.globalAlpha = 0.45;
    bctx.drawImage(IMG.objects, k.sx, k.sy, k.sw, k.sh, sx, sy, k.sw, k.sh);
    if (fade) bctx.globalAlpha = 1;
  }
  bctx.setTransform(1, 0, 0, 1, 0, 0);
}


// ---- Health bar & hurt overlay ---------------------------------------------------------------
const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
function renderHealthBar() {
  const x = 6, y = 7, hp = player.hp;
  const low = hp / MAX_HP <= 0.25 && hp > 0;
  const beat = low && Math.floor(frameTime / 280) % 2 === 0;
  // Heart icon with a black outline.
  bctx.fillStyle = '#000';
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]])
    HEART.forEach((row, r) => { for (let c = 0; c < 7; c++) if (row[c] === '#') bctx.fillRect(x + c + ox, y + r + oy, 1, 1); });
  HEART.forEach((row, r) => { for (let c = 0; c < 7; c++) if (row[c] === '#') {
    bctx.fillStyle = (r === 1 && (c === 1 || c === 2)) ? '#f4a090' : beat ? '#8e231c' : '#d33a2f';
    bctx.fillRect(x + c, y + r, 1, 1);
  } });
  // Bar.
  const bx = x + 11, by = y - 1, w = 64, h = 8;
  bctx.fillStyle = '#000'; bctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
  bctx.fillStyle = '#2b0f0c'; bctx.fillRect(bx, by, w, h);
  const lw = Math.min(w, Math.round(w * hurtFx.lagHp / MAX_HP)), fw = Math.min(w, Math.round(w * hp / MAX_HP));
  bctx.fillStyle = '#e9d9b2'; bctx.fillRect(bx, by, lw, h);
  if (fw > 0) {
    bctx.fillStyle = beat ? '#a32a21' : '#c8392d'; bctx.fillRect(bx, by, fw, h);
    bctx.fillStyle = '#ea6a52'; bctx.fillRect(bx, by + 1, fw, 1);
    bctx.fillStyle = '#8a2119'; bctx.fillRect(bx, by + h - 2, fw, 2);
  }
  if (hurtFx.flash > 0.55) { bctx.fillStyle = 'rgba(255,255,255,0.7)'; bctx.fillRect(bx, by, fw, h); }
  bctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let i = 1; i < 10; i++) bctx.fillRect(bx + Math.round(w * i / 10), by, 1, h);
}
let vignette = null;
function makeVignette() {
  vignette = document.createElement('canvas'); vignette.width = 320; vignette.height = 180;
  const g = vignette.getContext('2d');
  const gr = g.createRadialGradient(160, 90, 40, 160, 90, 200);
  gr.addColorStop(0, 'rgba(150,0,0,0)'); gr.addColorStop(0.55, 'rgba(150,0,0,0.35)'); gr.addColorStop(1, 'rgba(110,0,0,0.95)');
  g.fillStyle = gr; g.fillRect(0, 0, 320, 180);
}
function renderHurtOverlay() {
  if (!player) return;
  const missing = 1 - player.hp / MAX_HP;
  let a = missing * 0.6 + hurtFx.flash * 0.35, tint = missing * 0.1 + hurtFx.flash * 0.1;
  if (state === 'dying' || state === 'dead') { const t = Math.min(1, hurtFx.deathT / 1.6); a = Math.max(a, t); tint = Math.max(tint, t * 0.45); }
  if (a < 0.01) return;
  const w = canvas.width, h = canvas.height;
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(vignette, 0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = `rgba(120,0,0,${Math.min(0.6, tint)})`;
  ctx.fillRect(0, 0, w, h);
}

// ---- Minimap --------------------------------------------------------------------------------------
const MM = 72; // minimap size in native pixels (1 px per tile)
const MARKER_COLORS = ['#e8c547', '#e05a4f', '#5fb0e8', '#8be06a'];
function drawPlayerArrow(g, x, y, dir) {
  g.fillStyle = '#000';
  g.fillRect(x - 2, y - 2, 5, 5);
  g.fillStyle = '#fff';
  g.fillRect(x - 1, y - 1, 3, 3);
  g.fillStyle = '#ff5a3c';
  const o = { N: [0, -2], S: [0, 2], E: [2, 0], W: [-2, 0] }[dir];
  g.fillRect(x + o[0], y + o[1], 1, 1);
}
function drawMarker(g, x, y, c) {
  g.fillStyle = '#000'; g.fillRect(x - 2, y - 2, 5, 5);
  g.fillStyle = MARKER_COLORS[c % MARKER_COLORS.length]; g.fillRect(x - 1, y - 1, 3, 3);
}
function renderMinimap() {
  const x0 = BW - MM - 6, y0 = 6;
  const ptx = player.x / TILE, pty = player.y / TILE;
  bctx.fillStyle = '#0d0e0a';
  bctx.fillRect(x0 - 2, y0 - 2, MM + 4, MM + 4);
  bctx.fillStyle = '#16180f';
  bctx.fillRect(x0, y0, MM, MM);
  bctx.save();
  bctx.beginPath(); bctx.rect(x0, y0, MM, MM); bctx.clip();
  const left = ptx - MM / 2, top = pty - MM / 2;
  const cx0 = Math.floor(left / CHUNK), cy0 = Math.floor(top / CHUNK);
  const cx1 = Math.floor((left + MM) / CHUNK), cy1 = Math.floor((top + MM) / CHUNK);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    if (!explored.has(ck(cx, cy))) continue;
    const im = getMapImage(cx, cy);
    if (im) bctx.drawImage(im, Math.round(x0 + cx * CHUNK - left), Math.round(y0 + cy * CHUNK - top));
  }
  for (const m of markers) drawMarker(bctx, Math.round(x0 + m.x - left), Math.round(y0 + m.y - top), m.c);
  bctx.restore();
  bctx.strokeStyle = '#6b6a4e'; bctx.lineWidth = 1;
  bctx.strokeRect(x0 - 1.5, y0 - 1.5, MM + 3, MM + 3);
  drawPlayerArrow(bctx, x0 + MM / 2, y0 + MM / 2, player.dir);
  bctx.fillStyle = '#c9c4a0'; bctx.font = '8px monospace'; bctx.textAlign = 'center';
  bctx.fillText('N', x0 + MM / 2, y0 + 8);
}

// ---- Full map -------------------------------------------------------------------------------------
const mapView = { x: 0, y: 0, zoom: 4, drag: null, color: 0 };
function openMap() {
  state = 'map';
  mapView.x = player.x / TILE; mapView.y = player.y / TILE;
  ui.maphelp.classList.remove('hidden');
  updateMapHelp();
}
function closeMap() { state = 'play'; ui.maphelp.classList.add('hidden'); }
function updateMapHelp() {
  ui.mapColor.style.background = MARKER_COLORS[mapView.color];
}
function renderFullMap() {
  bctx.fillStyle = '#0b0c08'; bctx.fillRect(0, 0, BW, BH);
  const z = mapView.zoom;
  const left = mapView.x - BW / 2 / z, top = mapView.y - BH / 2 / z;
  const cx0 = Math.floor(left / CHUNK), cy0 = Math.floor(top / CHUNK);
  const cx1 = Math.floor((left + BW / z) / CHUNK), cy1 = Math.floor((top + BH / z) / CHUNK);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    if (!explored.has(ck(cx, cy))) continue;
    const im = getMapImage(cx, cy);
    if (im) bctx.drawImage(im, Math.round((cx * CHUNK - left) * z), Math.round((cy * CHUNK - top) * z), CHUNK * z, CHUNK * z);
  }
  for (const m of markers) drawMarker(bctx, Math.round((m.x - left) * z), Math.round((m.y - top) * z), m.c);
  drawPlayerArrow(bctx, Math.round((player.x / TILE - left) * z), Math.round((player.y / TILE - top) * z), player.dir);
}
function screenToMapTile(sx, sy) {
  const z = mapView.zoom;
  return { x: mapView.x + (sx / scale - BW / 2) / z, y: mapView.y + (sy / scale - BH / 2) / z };
}
canvas.addEventListener('mousedown', e => {
  if (state !== 'map') return;
  mapView.drag = { sx: e.clientX, sy: e.clientY, x: mapView.x, y: mapView.y, moved: false, btn: e.button };
});
window.addEventListener('mousemove', e => {
  const d = mapView.drag; if (!d || state !== 'map') return;
  const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
  if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
  if (d.moved) { mapView.x = d.x - dx / scale / mapView.zoom; mapView.y = d.y - dy / scale / mapView.zoom; }
});
window.addEventListener('mouseup', e => {
  const d = mapView.drag; mapView.drag = null;
  if (!d || state !== 'map' || d.moved) return;
  const t = screenToMapTile(e.clientX, e.clientY);
  if (d.btn === 0) markers.push({ x: Math.round(t.x), y: Math.round(t.y), c: mapView.color });
  else if (d.btn === 2) {
    let best = -1, bd = 8 / mapView.zoom;
    markers.forEach((m, i) => { const dd = Math.hypot(m.x - t.x, m.y - t.y); if (dd < bd) { bd = dd; best = i; } });
    if (best >= 0) markers.splice(best, 1);
  }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  if (state !== 'map') return;
  e.preventDefault();
  const zs = [1, 2, 4, 8], i = zs.indexOf(mapView.zoom);
  const ni = Math.max(0, Math.min(zs.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
  // Keep the tile under the cursor fixed while zooming.
  const before = screenToMapTile(e.clientX, e.clientY);
  mapView.zoom = zs[ni];
  const after = screenToMapTile(e.clientX, e.clientY);
  mapView.x += before.x - after.x; mapView.y += before.y - after.y;
}, { passive: false });

// ---- UI (menus) ---------------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const ui = {
  menu: $('menu'), slots: $('slots'), pause: $('pause'), dead: $('dead'), hint: $('hint'),
  maphelp: $('maphelp'), mapColor: $('mapcolor'), debug: $('debug'), toast: $('toast'), loading: $('loading'),
};
function fmtTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(t) {
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function renderSlots() {
  ui.slots.innerHTML = '';
  for (let n = 1; n <= 3; n++) {
    const s = readSlot(n);
    const el = document.createElement('div');
    el.className = 'slot' + (s ? '' : ' empty');
    if (s) {
      el.innerHTML = `<div class="slot-title">Survivor ${n}</div>
        <div class="slot-info">Survived ${fmtTime(s.playTime || 0)} · saved ${fmtDate(s.updated)}</div>
        <div class="slot-actions"><button data-act="continue">Continue</button><button data-act="delete" class="ghost">Delete</button></div>`;
    } else {
      el.innerHTML = `<div class="slot-title">Empty slot ${n}</div>
        <div class="slot-info">A new world, never seen before.</div>
        <div class="slot-actions"><button data-act="new">New Game</button></div>`;
    }
    el.addEventListener('click', ev => {
      const act = ev.target.dataset && ev.target.dataset.act; if (!act) return;
      if (act === 'new') newGame(n);
      else if (act === 'continue') loadGame(n);
      else if (act === 'delete') {
        el.querySelector('.slot-actions').innerHTML = `<span class="warn">Delete this survivor for good?</span>
          <button data-act="confirm" class="danger">Delete</button><button data-act="cancel" class="ghost">Keep</button>`;
      } else if (act === 'confirm') { store.del(slotKey(n)); renderSlots(); }
      else if (act === 'cancel') renderSlots();
    });
    ui.slots.appendChild(el);
  }
}
function showMenu() {
  state = 'menu';
  if (!world || player) { world = new WorldGen((Math.random() * 2 ** 32) >>> 0); resetCaches(); }
  player = null; zombies = [];
  menuCam.x = 0; menuCam.y = 0;
  ui.menu.classList.remove('hidden'); ui.pause.classList.add('hidden'); ui.dead.classList.add('hidden');
  ui.maphelp.classList.add('hidden'); ui.hint.classList.add('hidden');
  renderSlots();
}
function toast(msg) {
  ui.toast.textContent = msg; ui.toast.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => ui.toast.classList.remove('show'), 1800);
}
$('btn-resume').onclick = () => resume();
$('btn-save').onclick = () => { saveGame(); toast('Game saved'); };
$('btn-quit').onclick = () => { saveGame(); showMenu(); };
$('btn-dead-menu').onclick = () => showMenu();

function resume() { state = 'play'; ui.pause.classList.add('hidden'); }
function onKeyPress(k) {
  if (state === 'play') {
    if (k === 'escape') { state = 'pause'; ui.pause.classList.remove('hidden'); keys.clear(); }
    else if (k === 'm') openMap();
    else if (k === 'f3') ui.debug.classList.toggle('hidden');
  } else if (state === 'pause') {
    if (k === 'escape') resume();
  } else if (state === 'map') {
    if (k === 'escape' || k === 'm') closeMap();
    else if (['1', '2', '3', '4'].includes(k)) { mapView.color = +k - 1; updateMapHelp(); }
    else if (k === 'c') { mapView.x = player.x / TILE; mapView.y = player.y / TILE; }
  }
}

// ---- Start / save / load / death --------------------------------------------------------------
function startPlaying() {
  ui.menu.classList.add('hidden');
  ui.hint.classList.remove('hidden', 'fade');
  setTimeout(() => ui.hint.classList.add('fade'), 9000);
  state = 'play';
  lastAutosave = performance.now();
  hurtFx.shake = 0; hurtFx.flash = 0; hurtFx.deathT = 0; hurtFx.lagHp = player.hp;
  revealAround(player.x, player.y);
}
function newGame(n) {
  slot = n;
  const seed = (Math.random() * 2 ** 32) >>> 0;
  world = new WorldGen(seed); resetCaches();
  explored = new Map(); markers = []; playTime = 0; created = Date.now();
  const sp = findSpawn(Math.random);
  player = newPlayer(sp.x, sp.y);
  zombies = []; zSpawnT = 12;
  startPlaying();
  saveGame();
}
function loadGame(n) {
  const s = readSlot(n); if (!s) { renderSlots(); return; }
  slot = n;
  world = new WorldGen(s.seed); resetCaches();
  player = newPlayer(s.player.x, s.player.y); player.dir = s.player.dir || 'S';
  explored = new Map(Object.entries(s.explored || {}).map(([k, v]) => [k, unpackBits(v)]));
  markers = s.markers || []; playTime = s.playTime || 0; created = s.created || Date.now();
  player.hp = s.player.hp ?? MAX_HP;
  zombies = (s.zombies || []).filter(z => ZOMBIE_TYPES[z.t]).map(z => { const o = makeZombie(z.t, z.x, z.y); o.hp = z.hp; o.dir = z.dir || 'S'; if (z.look != null) o.look = z.look; return o; });
  zSpawnT = 8;
  startPlaying();
}
function saveGame() {
  if (!player || !slot) return;
  const ex = {};
  for (const [k, v] of explored) ex[k] = packBits(v);
  store.set(slotKey(slot), JSON.stringify({
    v: 1, seed: world.seed, created, updated: Date.now(), playTime: Math.floor(playTime),
    player: { x: Math.round(player.x), y: Math.round(player.y), dir: player.dir, hp: player.hp },
    zombies: zombies.map(z => ({ t: z.type, look: z.look, x: Math.round(z.x), y: Math.round(z.y), hp: z.hp, dir: z.dir })),
    explored: ex, markers,
  }));
  lastAutosave = performance.now();
}
// Permadeath: the save was deleted when the player died (see startDying).
function showGameOver() {
  slot = 0; state = 'dead';
  $('dead-cause').textContent = deathCause;
  $('dead-time').textContent = 'You survived ' + fmtTime(playTime) + '.';
  ui.dead.classList.remove('hidden');
}
window.addEventListener('beforeunload', () => { if (state === 'play' || state === 'pause' || state === 'map') saveGame(); });

// ---- Main loop --------------------------------------------------------------------------------------
const menuCam = { x: 0, y: 0 };
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0, revealT = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  frameTime = now;
  mapBuildBudget = 6;

  if (state === 'menu') {
    menuCam.x += dt * 22; menuCam.y += dt * 9;
    renderWorld(Math.round(menuCam.x), Math.round(menuCam.y), false);
  } else if (player) {
    if (state === 'play' || state === 'map') {
      if (state === 'play') updatePlayer(dt);
      playTime += dt;
      updateZombies(dt);
      revealT -= dt;
      if (revealT <= 0) { revealAround(player.x, player.y); revealT = 0.2; }
      if (now - lastAutosave > 120000) saveGame();
    } else if (state === 'dying') {
      for (const z of zombies) updateZombie(z, dt);
      hurtFx.deathT += dt;
      if (hurtFx.deathT > 1.6) showGameOver();
    } else if (state === 'dead') {
      hurtFx.deathT += dt;
    }
    updateHurtEffects(dt);
    if (state === 'map') renderFullMap();
    else {
      const [sx, sy] = shakeOffset();
      const camX = Math.round(player.x - BW / 2) + sx, camY = Math.round(player.y - 24 - BH / 2) + sy;
      renderWorld(camX, camY, true);
      unloadFarChunks(camX, camY);
    }
  }

  ctx.drawImage(buf, 0, 0, BW * scale, BH * scale);
  if (state !== 'menu' && state !== 'map') renderHurtOverlay();
  // HUD goes on top of the red overlay so it stays readable.
  if (player && (state === 'play' || state === 'pause')) {
    bctx.clearRect(0, 0, BW, BH);
    renderMinimap(); renderHealthBar();
    ctx.drawImage(buf, 0, 0, BW * scale, BH * scale);
  }

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
    if (!ui.debug.classList.contains('hidden') && player) {
      ui.debug.textContent = `${fps} fps · tile ${Math.floor(player.x / TILE)}, ${Math.floor(player.y / TILE)} · zombies ${zombies.length} · hp ${Math.ceil(player.hp)} · chunks ${canvasCache.size} drawn / ${dataCache.size} data / ${explored.size} explored`;
    }
  }
  requestAnimationFrame(loop);
}

// ---- Boot ---------------------------------------------------------------------------------------------
resize();
loadImages().then(() => {
  prepareAssets();
  ui.loading.classList.add('hidden');
  showMenu();
  requestAnimationFrame(loop);
}).catch(err => { ui.loading.textContent = 'Could not load game art: ' + err; });

// Hooks for automated testing.
window.__SH = { get state() { return state; }, get player() { return player; }, get world() { return world; }, tileAt, newGame, saveGame, loadGame, killPlayer: c => startDying(c), hurtPlayer, zombies: () => zombies,
  spawnZombie(dx, dy) { const z = makeZombie('walker', player.x + dx, player.y + dy); zombies.push(z); return z; }, openMap, closeMap, markers: () => markers, explored: () => explored, canvasCache, dataCache };
})();
