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
// Item icons: [sheet, column, row] on a 32 px grid, cropped to the drawn pixels.
const ICONS = {
  beans: ['itemsFood', 0, 0], soup: ['itemsFood', 1, 0], water: ['itemsFood', 2, 0], soda: ['itemsFood', 3, 0],
  juice: ['itemsFood', 0, 1], chips: ['itemsFood', 1, 1], bread: ['itemsFood', 2, 1],
  // Weapon icons are drawn small on their sheet, so they're shown at 2x.
  knife: ['itemsMelee', 0, 0, 2], hatchet: ['itemsMelee', 1, 0, 2], axe: ['itemsMelee', 2, 0, 2], pipe: ['itemsMelee', 3, 0, 2],
  // Headwear icons come from the front-facing frame of the worn sprite, at 2x.
  beanie: ['wearBeanie', 0, 0, 2, 64], bikehelmet: ['wearBike', 0, 0, 2, 64], hardhat: ['wearHardhat', 0, 0, 2, 64],
  motohelmet: ['wearMoto', 0, 0, 2, 64], militaryhelmet: ['wearMilitary', 0, 0, 2, 64],
  // Backpack icons: the back-facing frame of the worn sprite.
  bagS: ['wearBagS', 0, 5, 2, 64], bagM: ['wearBagM', 0, 5, 2, 64], bagL: ['wearBagL', 0, 5, 2, 64],
  hoodie: ['wearHoodie', 0, 0, 1, 64], leatherjacket: ['wearLeather', 0, 0, 1, 64], wintercoat: ['wearCoat', 0, 0, 1, 64], utilityvest: ['wearVest', 0, 0, 1, 64],
  rag: ['itemsMed', 0, 0], bandage: ['itemsMed', 1, 0], firstaid: ['itemsMed', 0, 1], antiseptic: ['itemsMed', 1, 1],
  bat: ['itemsMelee', 0, 1, 2], crowbar: ['itemsMelee', 1, 1, 2], pan: ['itemsMelee', 2, 1, 2], rollingpin: ['itemsMelee', 3, 1, 2],
};
const iconCache = {};
function iconFor(key) {
  if (key in iconCache) return iconCache[key];
  const def = ICONS[key]; if (!def || !IMG[def[0]]) return (iconCache[key] = null);
  const [sheet, c, r] = def, cell = def[4] || 32, t = document.createElement('canvas'); t.width = t.height = cell;
  const g = t.getContext('2d', { willReadFrequently: true }); g.drawImage(IMG[sheet], c * cell, r * cell, cell, cell, 0, 0, cell, cell);
  const d = g.getImageData(0, 0, cell, cell).data; let x0 = cell, y0 = cell, x1 = -1, y1 = -1;
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) if (d[(y * cell + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < 0) return (iconCache[key] = null);
  const sc = def[3] || 1, w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = document.createElement('canvas'); out.width = w * sc; out.height = h * sc;
  const og = out.getContext('2d'); og.imageSmoothingEnabled = false;
  og.drawImage(t, x0, y0, w, h, 0, 0, w * sc, h * sc);
  return (iconCache[key] = out);
}
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

function resetCaches() { dataCache.clear(); canvasCache.clear(); mapCache.clear(); regionCache.clear(); }

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
const MAP_TREE = [44, 56, 28], MAP_BLD = [96, 70, 56];
function buildMapImage(cx, cy) {
  const d = getData(cx, cy), ex = explored.get(ck(cx, cy));
  const c = document.createElement('canvas'); c.width = c.height = CHUNK;
  const g = c.getContext('2d'), im = g.createImageData(CHUNK, CHUNK);
  const trees = new Uint8Array(256);
  for (const o of d.objects) if (KINDS[o.k].tree) {
    const tx = Math.floor(o.x / TILE) - cx * CHUNK, ty = Math.floor(o.y / TILE) - cy * CHUNK;
    if (tx >= 0 && ty >= 0 && tx < CHUNK && ty < CHUNK) trees[ty * CHUNK + tx] = 1;
  }
  for (let i = 0; i < 256; i++) {
    if (!ex || !ex[i]) continue;
    const col = d.bld && d.bld[i] ? MAP_BLD : trees[i] ? MAP_TREE : MAP_COL[d.type[i]];
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
// opt.water: can enter water (swimming). opt.low: can pass over low obstacles (mid-jump).
function waterRect(tx, ty, e) {
  let wx0 = tx * TILE, wy0 = ty * TILE, wx1 = wx0 + TILE, wy1 = wy0 + TILE;
  if (e < 9) {
    const col = e % 3, row = Math.floor(e / 3);
    if (col === 0) wx0 += SHORE; if (col === 2) wx1 -= SHORE;
    if (row === 0) wy0 += SHORE; if (row === 2) wy1 -= SHORE;
  }
  return [wx0, wy0, wx1, wy1];
}
function inWater(x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor((y - 3) / TILE), { t, e } = tileAt(tx, ty);
  if (t !== T_WATER) return false;
  const [a, b, c, d] = waterRect(tx, ty, e);
  return x > a && x < c && y - 3 > b && y - 3 < d;
}
function blocked(x0, y0, x1, y1, opt) {
  if (!(opt && opt.water)) for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 0.01) / TILE); ty++)
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
  if (buildingBlocked(x0, y0, x1, y1)) return true;
  const cx0 = Math.floor((x0 - 64) / CPX), cx1 = Math.floor((x1 + 64) / CPX);
  const cy0 = Math.floor((y0 - 32) / CPX), cy1 = Math.floor((y1 + 32) / CPX);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    for (const o of getData(cx, cy).objects) {
      const k = KINDS[o.k]; if (!k.cw || (opt && opt.low && k.low)) continue;
      if (rectsHit(x0, y0, x1, y1, o.x - k.cw / 2, o.y - k.ch, o.x + k.cw / 2, o.y)) return true;
    }
  }
  return false;
}

// ---- Player ------------------------------------------------------------------------------------
const WALK = 72, RUN = 138;     // pixels per second (a tile is ~1 metre)
const FEET_W = 14, FEET_H = 6;
// Body parts. Each has its own health (0-100); if any reaches 0 the player dies.
// The player's overall health (player.hp) is their most injured part.
const BODY_PARTS = [
  { id: 'head',   name: 'Head',       side: 0,  mult: 1.3 },
  { id: 'torso',  name: 'Torso',      side: 0,  mult: 0.8 },
  { id: 'rArm',   name: 'Right arm',  side: 1,  mult: 0.9 },
  { id: 'lArm',   name: 'Left arm',   side: -1, mult: 0.9 },
  { id: 'rHand',  name: 'Right hand', side: 1,  mult: 1.0 },
  { id: 'lHand',  name: 'Left hand',  side: -1, mult: 1.0 },
  { id: 'rLeg',   name: 'Right leg',  side: 1,  mult: 0.9 },
  { id: 'lLeg',   name: 'Left leg',   side: -1, mult: 0.9 },
  { id: 'rFoot',  name: 'Right foot', side: 1,  mult: 0.9 },
  { id: 'lFoot',  name: 'Left foot',  side: -1, mult: 0.9 },
];
function newPlayer(x, y) {
  const p = { x, y, dir: 'S', moving: false, running: false, anim: 0, parts: {}, wounds: {}, lastHit: null, lastHitT: 0, hunger: 80, thirst: 75 };
  for (const b of BODY_PARTS) p.parts[b.id] = 100;
  Object.defineProperty(p, 'hp', {
    get() { let m = 100; for (const k in this.parts) m = Math.min(m, this.parts[k]); return m; },
    set(v) { for (const k in this.parts) this.parts[k] = Math.max(0, Math.min(100, v)); },
  });
  return p;
}
function feetBlocked(x, y, opt) { return blocked(x - FEET_W / 2, y - FEET_H, x + FEET_W / 2, y, opt); }

function findSpawn(seedRand) {
  // Random spot far from the origin, then search outward for clear land.
  const ang = seedRand() * Math.PI * 2, dist = 2000 + seedRand() * 20000;
  const sx = Math.round(Math.cos(ang) * dist), sy = Math.round(Math.sin(ang) * dist);
  for (let r = 0; r < 200; r += 3) for (let a = 0; a < 16; a++) {
    const tx = sx + Math.round(Math.cos(a / 16 * Math.PI * 2) * r), ty = sy + Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
    let ok = true;
    for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3 && ok; dx++) if (tileAt(tx + dx, ty + dy).t === T_WATER) ok = false;
    const px = tx * TILE + 16, py = ty * TILE + 24;
    if (ok && !feetBlocked(px, py) && !blocked(px - 24, py - 24, px + 24, py + 8) && !buildingAt(px, py - 4)) return { x: px, y: py };
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

// Movement states: crouching (C), jumping (Space), swimming (automatic in water).
const CROUCH_SPEED = 0.6, SWIM_SPEED = 0.5;
const JUMP_TIME = 0.62, JUMP_AIR = [0.1, 0.5], JUMP_HEIGHT = 14;
const MOVE_DIR = { S: 0, E: 1, N: 2, W: 3 };
function jumpAirborne(p) { return p.jump && p.jump.t > JUMP_AIR[0] && p.jump.t < JUMP_AIR[1]; }
function jumpHeight(p) {
  if (!p.jump) return 0;
  const t = (p.jump.t - JUMP_AIR[0]) / (JUMP_AIR[1] - JUMP_AIR[0]);
  return t <= 0 || t >= 1 ? 0 : Math.round(Math.sin(Math.PI * t) * JUMP_HEIGHT);
}
function toggleCrouch() {
  const p = player; if (!p || p.swimming || p.jump) return;
  p.crouch = !p.crouch;
}
function startJump() {
  const p = player; if (!p || p.jump || p.swimming || p.attack || (p.jumpCd || 0) > 0) return;
  let vx = 0, vy = 0;
  if (keys.has('w') || keys.has('arrowup')) vy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) vy += 1;
  if (keys.has('a') || keys.has('arrowleft')) vx -= 1;
  if (keys.has('d') || keys.has('arrowright')) vx += 1;
  const len = Math.hypot(vx, vy) || 1, speed = (vx || vy) ? (keys.has('shift') ? RUN * 0.95 : WALK * 1.25) : 0;
  p.crouch = false; p.crouchT = 0;
  p.jump = { t: 0, vx: vx / len * speed, vy: vy / len * speed };
  player.hunger = Math.max(0, player.hunger - 0.05);
}
function updatePlayer(dt) {
  let vx = 0, vy = 0;
  if (keys.has('w') || keys.has('arrowup')) vy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) vy += 1;
  if (keys.has('a') || keys.has('arrowleft')) vx -= 1;
  if (keys.has('d') || keys.has('arrowright')) vx += 1;
  const p = player;
  p.jumpCd = Math.max(0, (p.jumpCd || 0) - dt);
  p.swimming = !jumpAirborne(p) && inWater(p.x, p.y);
  if (p.swimming) p.crouch = false;
  // Running stands you up.
  if (p.crouch && keys.has('shift') && (vx || vy)) p.crouch = false;
  const ct = p.crouch ? 1 : 0;
  p.crouchT = p.crouchT == null ? ct : p.crouchT + Math.sign(ct - p.crouchT) * Math.min(Math.abs(ct - p.crouchT), dt / 0.22);
  // Low obstacles (rocks, logs, stumps) can be cleared mid-jump; if you land on one you can walk off it.
  const opt = { water: true, low: jumpAirborne(p) || feetBlocked(p.x, p.y, { water: true }) };
  if (p.jump) {
    p.jump.t += dt;
    const mx = p.jump.vx * dt, my = p.jump.vy * dt;
    if (!feetBlocked(p.x + mx, p.y, opt)) p.x += mx;
    if (!feetBlocked(p.x, p.y + my, opt)) p.y += my;
    p.moving = false; p.running = false;
    if (p.jump.t >= JUMP_TIME) {
      p.jump = null; p.jumpCd = 0.25;
      makeNoise(p.x, p.y, inWater(p.x, p.y) ? NOISE.swim : NOISE.land, true);
    }
    return;
  }
  p.moving = vx !== 0 || vy !== 0;
  p.running = p.moving && keys.has('shift') && !p.swimming && !p.crouch;
  if (p.moving) {
    if (p.attack) p.running = false;
    const base = p.swimming ? WALK * SWIM_SPEED : p.crouch ? WALK * CROUCH_SPEED : p.running ? RUN : WALK;
    const len = Math.hypot(vx, vy), sp = base * dt * (p.attack ? (p.attack.w.heavy ? 0.3 : 0.5) : 1);
    const mx = vx / len * sp, my = vy / len * sp;
    if (p.attack) { /* keep facing the punch */ }
    else if (Math.abs(vx) > Math.abs(vy)) p.dir = vx > 0 ? 'E' : 'W';
    else if (Math.abs(vy) > Math.abs(vx)) p.dir = vy > 0 ? 'S' : 'N';
    else if (!((vx > 0 && p.dir === 'E') || (vx < 0 && p.dir === 'W') || (vy > 0 && p.dir === 'S') || (vy < 0 && p.dir === 'N'))) p.dir = vx > 0 ? 'E' : 'W';
    if (!feetBlocked(p.x + mx, p.y, opt)) p.x += mx;
    if (!feetBlocked(p.x, p.y + my, opt)) p.y += my;
    p.anim += dt * (p.running ? 11 : p.swimming ? 5 : p.crouch ? 6 : 7);
  } else {
    p.anim += dt * (p.swimming ? 3.5 : 3);
  }
}
// Returns [frame, row, sheet] — sheet 'moves' is the jump / swim / crouch sheet.
function playerFrame(p) {
  if (p.attack) return [Math.min(3, Math.floor(p.attack.t / p.attack.w.duration * 4)), PUNCH_ROW[p.dir], 'base'];
  const di = MOVE_DIR[p.dir], f = Math.floor(p.anim) % 4;
  if (p.jump) {
    const t = p.jump.t, jf = t < 0.1 ? 0 : t < 0.2 ? 1 : t < JUMP_AIR[1] ? 2 : 3;
    return [jf, di, 'moves'];
  }
  if (p.swimming) return [f, 4 + di, 'moves'];
  if (p.crouchT > 0) {
    if (p.crouchT < 1) return [Math.min(3, Math.floor(p.crouchT * 4)), 8 + di, 'moves'];
    return p.moving ? [f, 12 + di, 'moves'] : [3, 8 + di, 'moves'];
  }
  return [f, p.moving ? DIR_ROW[p.dir] : IDLE_ROW[p.dir], 'base'];
}

// ---- Player health & hurt effects -----------------------------------------------------------
const MAX_HP = 100;
const hurtFx = { shake: 0, flash: 0, lagHp: MAX_HP, deathT: 0 };
// Where a zombie's hit lands depends on where it is relative to the way the
// player is facing: from the front it's mostly hands and arms (blocking, being
// grabbed), from behind it's the back, neck and head, and the near side's
// limbs are hit more than the far side's. Legs and feet are hit least.
const HIT_WEIGHTS = {
  //            front  behind
  head:  [10, 22], torso: [18, 30],
  arm:   [15, 12], hand:  [15, 4],
  leg:   [4.5, 6], foot:  [1.5, 1.5],
};
const DIR_VEC = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
function pickHitPart(ax, ay) {
  const f = DIR_VEC[player.dir];
  let vx = ax - player.x, vy = ay - player.y; const len = Math.hypot(vx, vy) || 1; vx /= len; vy /= len;
  const front = (vx * f[0] + vy * f[1] + 1) / 2;          // 1 = in front, 0 = behind
  const side = vx * -f[1] + vy * f[0];                    // +1 = on the player's right
  const weights = BODY_PARTS.map(b => {
    const key = b.id.replace(/^[rl]/, '').toLowerCase();
    const w = HIT_WEIGHTS[key] || HIT_WEIGHTS[b.id];
    const base = w[0] * front + w[1] * (1 - front);
    return base * (b.side === 0 ? 1 : Math.max(0.25, 1 + b.side * side * 1.3));
  });
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return BODY_PARTS[i]; }
  return BODY_PARTS[1];
}
const DEATH_BY_PART = {
  head: 'A zombie tore into your head and neck.', torso: 'You were mauled — torso wounds.',
  rArm: 'You bled out from your right arm.', lArm: 'You bled out from your left arm.',
  rHand: 'Your right hand was torn apart.', lHand: 'Your left hand was torn apart.',
  rLeg: 'You bled out from your right leg.', lLeg: 'You bled out from your left leg.',
  rFoot: 'Your right foot was mangled.', lFoot: 'Your left foot was mangled.',
};
function hurtPlayer(amount, cause, fromX, fromY) {
  if (state !== 'play' && state !== 'map') return;
  if (state === 'map') closeMap();
  if (player.god) return;
  if (fromX != null && jumpAirborne(player)) return;   // jumped clear of the lunge
  const part = fromX != null ? pickHitPart(fromX, fromY) : BODY_PARTS[1];
  let dmg = amount * part.mult * (0.8 + Math.random() * 0.4);
  // Worn gear stops part of the damage to the body part it covers.
  let cover = 0;
  for (const id in inv.equip) { const it = inv.equip[id], def = it && (ITEMS[it.key] || it); if (def && def.protect && def.protect[part.id]) cover += def.protect[part.id]; }
  dmg *= 1 - Math.min(0.8, cover);
  player.parts[part.id] = Math.max(0, player.parts[part.id] - dmg);
  player.lastHit = part.id; player.lastHitT = performance.now();
  player.wounds[part.id] = { t: 0, clotted: false }; // a fresh hit reopens the wound
  hurtFx.shake = 1; hurtFx.flash = 1;
  if (player.parts[part.id] <= 0) startDying(DEATH_BY_PART[part.id] || cause);
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
// Each type: looks (sprite sheets, picked at random), speeds (px/s), health, attack, senses.
// onePiece looks (like a dress) get one colour for the whole outfit. New types go here.
const ZOMBIE_TYPES = {
  walker: {
    looks: [{ img: 'zWalker' }, { img: 'zWalker2' }, { img: 'zWalker3' }, { img: 'zWalker4', onePiece: true }, { img: 'zWalker5' }],
    speed: 46, wanderSpeed: 18, hp: 100,
    damage: 14, reach: 27, windup: 0.45, cooldown: 1.4,
    sight: 10 * TILE, notice: 3 * TILE, forget: 5, animRate: 5,
    radius: 6.5, stunMul: 1, knockMul: 1, interrupt: 1,
  },
  // Brutes: big, slow and tough. 2.5x the health, hit twice as hard, shrug off most
  // stagger and knockback, and shove the player back when they connect.
  brute: {
    looks: [{ img: 'zBrute' }],
    speed: 33, wanderSpeed: 13, hp: 250, speedVar: [0.9, 1.1],
    damage: 28, reach: 33, windup: 0.75, cooldown: 2.0, shove: 14,
    sight: 9 * TILE, notice: 3 * TILE, forget: 8, animRate: 3.4,
    radius: 11, stunMul: 0.35, knockMul: 0.25, interrupt: 0.3, shadow: [14, 4],
  },
};
// How often brutes show up: alone sometimes, and mixed into bigger hordes.
const BRUTE_SOLO_CHANCE = 0.06, BRUTE_IN_HORDE_CHANCE = 0.08;
// Speed varies per zombie: most shamble at the normal pace, some are slower,
// a few are faster, and rare sprinters can match the player's full sprint.
const Z_SPEEDS = [
  { weight: 70, min: 0.95, max: 1.05 },   // normal
  { weight: 18, min: 0.65, max: 0.85 },   // slow
  { weight: 10, min: 1.2,  max: WALK / 46 }, // fast (up to walking pace)
  { weight: 2,  min: 2.2,  max: RUN / 46 },  // rare sprinters (up to the player's sprint)
];
function rollSpeed() {
  let r = Math.random() * Z_SPEEDS.reduce((a, b) => a + b.weight, 0);
  for (const b of Z_SPEEDS) { r -= b.weight; if (r <= 0) return b.min + Math.random() * (b.max - b.min); }
  return 1;
}
function zSpeed(z, T) { return Math.min(RUN, T.speed * z.speedMul); }
const Z_CAP = 36;             // most zombies around the player at once
const Z_DESPAWN = 46 * TILE;  // zombies further than this are removed

// Horde sizes: solo zombies are common, big hordes are rare.
const HORDES = [
  { weight: 72,  min: 1,  max: 1 },   // lone zombie
  { weight: 22,  min: 2,  max: 4 },   // small group
  { weight: 4.8, min: 5,  max: 8 },   // horde
  { weight: 1.2, min: 10, max: 15 },  // large horde
];
// Groups keep their distance from each other: a new group never spawns within HORDE_GAP of
// another group (or a big horde within BIG_HORDE_GAP), and only one big horde is ever around.
const HORDE_GAP = 30 * TILE, BIG_HORDE_GAP = 60 * TILE, ZOMBIE_GAP = 7 * TILE, BIG_HORDE = 5;

// ---- Zombie outfits: each zombie's clothes get their own colours ----
// Muted, dirty colours so they still read as worn clothing.
const TOP_COLORS = ['#3b4a6b', '#5a2e2e', '#4d5b3a', '#6b5a3a', '#2f3f45', '#5b3d5c', '#7a6a4a', '#3d3d42',
                    '#6e3b2a', '#2e4a3f', '#7b7468', '#4a3a2c', '#5c6b78', '#7a4a3a', '#2c2f3a', '#6a6040'];
const BOTTOM_COLORS = ['#34405a', '#2b3550', '#4a4436', '#2a2a2e', '#4d3f30', '#555a50', '#3a4a5e', '#5e5240', '#3a3232'];
const outfitCache = new Map();
let maskData = {};
function hexRgb(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
function prepareZombieMasks() {
  for (const T of Object.values(ZOMBIE_TYPES)) for (const L of T.looks) {
    const img = IMG[L.img], m = IMG[L.img + 'Mask'];
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0); const src = g.getImageData(0, 0, c.width, c.height);
    g.clearRect(0, 0, c.width, c.height);
    let mask = null;
    if (m) { g.drawImage(m, 0, 0); const md = g.getImageData(0, 0, c.width, c.height).data; mask = new Uint8Array(c.width * c.height); for (let i = 0; i < mask.length; i++) mask[i] = md[i * 4 + 3] ? md[i * 4] : 0; }
    // Average brightness of each garment, so shading is kept when recoloured.
    const sum = [0, 0, 0], n = [0, 0, 0];
    if (mask) for (let i = 0; i < mask.length; i++) if (mask[i]) { const d = src.data; sum[mask[i]] += (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3; n[mask[i]]++; }
    maskData[L.img] = { src, mask, w: c.width, h: c.height, mean: [0, sum[1] / (n[1] || 1), sum[2] / (n[2] || 1)] };
  }
}
function outfitSheet(look, top, bottom) {
  const key = look.img + '|' + top + '|' + bottom;
  let c = outfitCache.get(key);
  if (c) return c;
  const M = maskData[look.img];
  if (!M || !M.mask) return IMG[look.img];
  const cols = [null, hexRgb(TOP_COLORS[top % TOP_COLORS.length]), hexRgb(look.onePiece ? TOP_COLORS[top % TOP_COLORS.length] : BOTTOM_COLORS[bottom % BOTTOM_COLORS.length])];
  const out = new ImageData(new Uint8ClampedArray(M.src.data), M.w, M.h), d = out.data;
  for (let i = 0; i < M.mask.length; i++) {
    const g = M.mask[i]; if (!g) continue;
    const k = i * 4, lum = (d[k] + d[k + 1] + d[k + 2]) / 3;
    const f = Math.min(1.8, lum / Math.max(8, M.mean[g])) * 0.82, base = cols[g];
    // Mostly the new colour with the original shading, plus a little of the old grime.
    for (let j = 0; j < 3; j++) d[k + j] = Math.min(255, base[j] * f * 0.85 + d[k + j] * 0.15);
  }
  c = document.createElement('canvas'); c.width = M.w; c.height = M.h;
  c.getContext('2d').putImageData(out, 0, 0);
  outfitCache.set(key, c);
  if (outfitCache.size > 60) outfitCache.delete(outfitCache.keys().next().value);
  return c;
}
function zombieSheet(z) {
  const T = ZOMBIE_TYPES[z.type], look = T.looks[z.look] || T.looks[0];
  return outfitSheet(look, z.top, z.bottom);
}

let zombies = [];
let hordes = new Map();   // id -> { id, gx, gy, t }
let nextHordeId = 1;
let zSpawnT = 0;
function makeZombie(type, x, y) {
  const T = ZOMBIE_TYPES[type];
  return { type, look: Math.floor(Math.random() * T.looks.length),
    top: Math.floor(Math.random() * TOP_COLORS.length), bottom: Math.floor(Math.random() * BOTTOM_COLORS.length),
    x, y, dir: 'NSEW'[Math.floor(Math.random() * 4)], moving: false, anim: Math.random() * 4,
    mode: 'idle', t: 1 + Math.random() * 3, gx: x, gy: y, atk: 0, cd: 0, hp: T.hp, lostT: 0, stuck: 0, detour: 0, dx: 0, dy: 0,
    horde: 0, ox: 0, oy: 0, speedMul: T.speedVar ? T.speedVar[0] + Math.random() * (T.speedVar[1] - T.speedVar[0]) : rollSpeed() };
}
function faceToward(a, vx, vy) {
  if (Math.abs(vx) > Math.abs(vy)) a.dir = vx > 0 ? 'E' : 'W'; else a.dir = vy > 0 ? 'S' : 'N';
}
function moveZombie(z, vx, vy, speed, dt) {
  const len = Math.hypot(vx, vy); if (len < 0.001) { z.moving = false; return; }
  let ux = vx / len, uy = vy / len;
  if (z.detour > 0) { z.detour -= dt; ux = z.dx; uy = z.dy; }
  const sp = speed * dt * (inWater(z.x, z.y) ? 0.45 : 1);   // zombies swim, slowly
  const ox = z.x, oy = z.y;
  const tryMove = (nx, ny) => {
    if (feetBlocked(nx, ny, { water: true })) return false;
    const zr = ZOMBIE_TYPES[z.type].radius;
    if (Math.hypot(nx - player.x, ny - player.y) < 13.5 + zr) return false;          // don't walk into the player
    for (const o of zombies) {
      if (o === z || o.dead || Math.abs(nx - o.x) > 24 || Math.abs(ny - o.y) > 24) continue;
      const rr = zr + ZOMBIE_TYPES[o.type].radius;
      if (Math.hypot(nx - o.x, ny - o.y) < rr && Math.hypot(z.x - o.x, z.y - o.y) >= rr) return false;
    }
    for (const o of animals) {
      if (o.dead || Math.abs(nx - o.x) > 30 || Math.abs(ny - o.y) > 30) continue;
      const rr = zr + ANIMAL_TYPES[o.sp].radius;
      if (Math.hypot(nx - o.x, ny - o.y) < rr && Math.hypot(z.x - o.x, z.y - o.y) >= rr) return false;
    }
    return true;
  };
  if (tryMove(z.x + ux * sp, z.y)) z.x += ux * sp;
  if (tryMove(z.x, z.y + uy * sp)) z.y += uy * sp;
  const moved = Math.hypot(z.x - ox, z.y - oy);
  z.moving = moved > sp * 0.2;
  faceToward(z, ux, uy);
  // Stuck on a tree, shoreline or another zombie: side-step for a moment.
  if (moved < sp * 0.3) z.stuck += dt; else z.stuck = Math.max(0, z.stuck - dt);
  if (z.stuck > 0.35 && z.detour <= 0) {
    const side = Math.random() < 0.5 ? 1 : -1;
    z.dx = -uy * side; z.dy = ux * side; z.detour = 0.5 + Math.random() * 0.5; z.stuck = 0;
  }
}
// One zombie spotting you sets off the rest of its horde (and any zombie close by).
function alertAround(z) {
  for (const o of zombies) {
    if (o === z || o.dead || o.mode === 'chase' || o.mode === 'attack') continue;
    const sameHorde = z.horde && o.horde === z.horde;
    if (sameHorde || Math.hypot(o.x - z.x, o.y - z.y) < 5 * TILE) {
      o.mode = 'chase'; o.lostT = 0; o.gx = player.x; o.gy = player.y;
    }
  }
}
// Zombie animation for investigating counts as walking.
function updateZombie(z, dt) {
  const T = ZOMBIE_TYPES[z.type];
  const ddx = player.x - z.x, ddy = player.y - z.y, d = Math.hypot(ddx, ddy);
  const alive = player.hp > 0;
  // Walls block sight. In the open a zombie sees what's in front of it; between inside and
  // outside it can only see you through a window or open doorway near you.
  const zb = buildingAt(z.x, z.y - 4), pb = buildingAt(player.x, player.y - 4), together = zb === pb;
  const sees = alive && (together ? inView(z, ddx, ddy, d, T) : (d < 1.5 * TILE || (pb && !zb && d < T.sight && seesThroughOpening(z, pb))));
  z.cd = Math.max(0, z.cd - dt);
  if (z.flash > 0) z.flash -= dt;
  if (z.dead) { z.deadT += dt; return; }
  if (z.stun > 0) { z.stun -= dt; z.moving = false; return; }
  const goTo = (tx, ty, speed) => {
    const nav = navTarget(z, tx, ty);
    if (nav.bang) {
      z.mode = 'bang'; z.bang = nav.bang; z.moving = false; faceToward(z, nav.x - z.x, nav.y - z.y);
      z.atk = (z.atk > 0 ? z.atk : T.windup) - dt; if (z.atk <= 0) z.atk = T.windup;
      return false;
    }
    if (z.mode === 'bang') z.mode = 'chase';
    z.bang = null;
    moveZombie(z, nav.x - z.x, nav.y - z.y, speed, dt);
    return true;
  };

  if (z.mode === 'attack') {
    z.moving = false; faceToward(z, ddx, ddy);
    z.atk -= dt;
    if (z.atk <= 0) {
      if (alive && d <= T.reach + 8 && together) {
        hurtPlayer(T.damage, 'Killed by a zombie.', z.x, z.y);
        if (T.shove && state === 'play') {
          // A brute's blow shoves the player back.
          const sx = ddx / (d || 1) * T.shove, sy = ddy / (d || 1) * T.shove;
          if (!feetBlocked(player.x + sx, player.y)) player.x += sx;
          if (!feetBlocked(player.x, player.y + sy)) player.y += sy;
          hurtFx.shake = 1.6;
        }
      }
      z.cd = T.cooldown; z.mode = 'chase';
    }
  } else if (sees) {
    if (z.mode !== 'chase' && z.mode !== 'bang') alertAround(z);
    if (z.mode !== 'bang') z.mode = 'chase';
    z.lostT = 0; z.gx = player.x; z.gy = player.y;
    if (together && d <= T.reach && z.cd <= 0) { z.mode = 'attack'; z.atk = T.windup; z.moving = false; }
    else if (!together || d > T.reach - 4) goTo(player.x, player.y, zSpeed(z, T));
    else { z.moving = false; faceToward(z, ddx, ddy); }
  } else if (z.mode === 'investigate') {
    // Heard something: shuffle over to where it came from, look around, then lose interest.
    z.lostT += dt;
    if (Math.hypot(z.gx - z.x, z.gy - z.y) > 8 && z.lostT < 25) goTo(z.gx, z.gy, zSpeed(z, T) * 0.75);
    else { z.mode = 'idle'; z.t = 3 + Math.random() * 4; z.moving = false; if (z.bang) z.bang = null; }
    if (z.mode === 'bang') { z.mode = 'idle'; z.t = 2; z.bang = null; }   // a noise alone won't make them break in
  } else if (z.mode === 'chase' || z.mode === 'bang') {
    // Lost sight (or was alerted): head to where the player was last seen, then give up.
    z.lostT += dt;
    const gx = z.gx - z.x, gy = z.gy - z.y;
    if (Math.hypot(gx, gy) > 6 && z.lostT < T.forget + (z.mode === 'bang' ? 20 : 4)) goTo(z.gx, z.gy, zSpeed(z, T));
    else {
      z.mode = 'idle'; z.t = 2 + Math.random() * 3; z.moving = false; z.bang = null;
      const h = hordes.get(z.horde); if (h) { h.gx = z.x; h.gy = z.y; } // the horde regroups here
    }
  } else if (z.horde && hordes.has(z.horde)) {
    // Horde members drift together toward the horde's goal, each keeping its own spot.
    const h = hordes.get(z.horde);
    const gx = h.gx + z.ox - z.x, gy = h.gy + z.oy - z.y, dist = Math.hypot(gx, gy);
    if (dist > 10) { moveZombie(z, gx, gy, T.wanderSpeed * (dist > 3 * TILE ? 1.6 : 1) * Math.min(1, z.speedMul), dt); z.mode = 'wander'; }
    else { z.moving = false; z.mode = 'idle'; }
  } else if (z.mode === 'wander') {
    z.t -= dt;
    if (Math.hypot(z.gx - z.x, z.gy - z.y) < 6 || z.t <= 0) { z.mode = 'idle'; z.t = 2 + Math.random() * 4; z.moving = false; }
    else goTo(z.gx, z.gy, T.wanderSpeed * z.speedMul);
  } else {
    z.moving = false; z.t -= dt;
    if (z.t <= 0) {
      let gx, gy;
      if (z.home && zb && zb.id === z.home) {
        // Residents shuffle around inside their house.
        const L = layoutBuilding(zb), floor = [];
        for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (L.cells[y][x] === '.') floor.push([x, y]);
        const [fx, fy] = floor[Math.floor(Math.random() * floor.length)];
        gx = (zb.x + fx) * TILE + 16; gy = (zb.y + fy) * TILE + 22;
        if (buildingBlocked(gx - 7, gy - 6, gx + 7, gy)) { z.t = 1; return; }
      } else [gx, gy] = wanderTarget(z.x, z.y, 2, 5);
      z.mode = 'wander'; z.gx = gx; z.gy = gy; z.t = 12;
    }
  }
  z.anim += dt * (z.moving ? T.animRate * z.speedMul * (z.mode === 'chase' ? 1 : z.mode === 'investigate' ? 0.8 : 0.6) : 2.5);
}
function zombieFrame(z) {
  const f = Math.floor(z.anim) % 4;
  if (z.mode === 'attack' || z.mode === 'bang') return [Math.max(0, Math.min(3, Math.floor((1 - z.atk / ZOMBIE_TYPES[z.type].windup) * 3.99))), DIR_ROW[z.dir]];
  return [f, z.moving ? DIR_ROW[z.dir] : IDLE_ROW[z.dir]];
}
function canStand(x, y) {
  if (buildingAt(x, y - 4)) return false;
  return tileAt(Math.floor(x / TILE), Math.floor(y / TILE)).t !== T_WATER && !feetBlocked(x, y) &&
    !zombies.some(o => Math.abs(o.x - x) < 14 && Math.abs(o.y - y) < 14);
}
function pickHordeSize() {
  let r = Math.random() * HORDES.reduce((a, h) => a + h.weight, 0);
  for (const h of HORDES) { r -= h.weight; if (r <= 0) return h.min + Math.floor(Math.random() * (h.max - h.min + 1)); }
  return 1;
}
// Where each group is (the middle of its members) and how big it is.
function groupCenters() {
  const g = new Map();
  for (const z of zombies) {
    if (z.dead || !z.horde) continue;
    const c = g.get(z.horde) || { x: 0, y: 0, n: 0 };
    c.x += z.x; c.y += z.y; c.n++; g.set(z.horde, c);
  }
  return [...g.values()].map(c => ({ x: c.x / c.n, y: c.y / c.n, n: c.n }));
}
function groupSpaceOk(x, y, size) {
  // Nobody spawns right on top of other zombies.
  if (zombies.some(z => !z.dead && Math.hypot(z.x - x, z.y - y) < ZOMBIE_GAP)) return false;
  if (size === 1) return true;
  for (const c of groupCenters()) {
    const big = size >= BIG_HORDE || c.n >= BIG_HORDE;
    if (size >= BIG_HORDE && c.n >= BIG_HORDE) return false;   // one big horde at a time
    if (Math.hypot(c.x - x, c.y - y) < (big ? BIG_HORDE_GAP : HORDE_GAP)) return false;
  }
  return true;
}
// Spawns a lone zombie or a horde out of sight. Bigger hordes appear further away.
function spawnGroup(size) {
  const minR = size > 4 ? 17 : 13, maxR = size > 4 ? 24 : 19;
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, r = (minR + Math.random() * (maxR - minR)) * TILE;
    const cx = player.x + Math.cos(a) * r, cy = player.y + Math.sin(a) * r;
    if (Math.abs(cx - player.x) < BW / 2 + 64 && Math.abs(cy - player.y) < BH / 2 + 112) continue; // never pop in on screen
    if (!canStand(cx, cy)) continue;
    if (!groupSpaceOk(cx, cy, size)) continue;
    let hid = 0;
    if (size > 1) { hid = nextHordeId++; hordes.set(hid, { id: hid, gx: cx, gy: cy, t: 3 + Math.random() * 6 }); }
    const spread = 14 + Math.sqrt(size) * 14;
    let made = 0;
    for (let k = 0; k < size * 6 && made < size; k++) {
      const oa = Math.random() * Math.PI * 2, orr = made === 0 ? 0 : Math.sqrt(Math.random()) * spread;
      const x = cx + Math.cos(oa) * orr, y = cy + Math.sin(oa) * orr;
      if (!canStand(x, y)) continue;
      const bruteChance = size === 1 ? BRUTE_SOLO_CHANCE : size >= 5 && made > 0 ? BRUTE_IN_HORDE_CHANCE : 0;
      const z = makeZombie(Math.random() < bruteChance ? 'brute' : 'walker', x, y);
      if (hid) { z.horde = hid; z.ox = x - cx; z.oy = y - cy; z.dir = 'NSEW'[(hid * 7) % 4]; }
      zombies.push(z); made++;
    }
    return made;
  }
  return 0;
}
// Zombies wander aimlessly; they only come your way if they see or hear you.
function wanderTarget(x, y, minT, maxT) {
  const a = Math.random() * Math.PI * 2;
  const r = (minT + Math.random() * (maxT - minT)) * TILE;
  return [x + Math.cos(a) * r, y + Math.sin(a) * r];
}
function updateHordes(dt) {
  for (const h of hordes.values()) {
    h.t -= dt;
    if (h.t <= 0) {
      // Pick a new spot to shamble toward.
      const [gx, gy] = wanderTarget(h.gx, h.gy, 3, 7);
      h.gx = gx; h.gy = gy; h.t = 8 + Math.random() * 10;
    }
  }
}
function updateZombies(dt) {
  zombies = zombies.filter(z => Math.hypot(z.x - player.x, z.y - player.y) < Z_DESPAWN && !z.dead);
  const alive = new Set(zombies.map(z => z.horde));
  for (const id of hordes.keys()) if (!alive.has(id)) hordes.delete(id);
  zSpawnT -= dt;
  if (zSpawnT <= 0) {
    zSpawnT = 7 + Math.random() * 8;
    const size = pickHordeSize();
    if (zombies.length + size <= Z_CAP) spawnGroup(size);
  }
  updateHordes(dt);
  for (const z of zombies) updateZombie(z, dt);
}


// {{ANIMALS}}

// ---- Bleeding ------------------------------------------------------------------------------------
// A body part starts bleeding once its health drops below a threshold; the worse the wound, the
// faster it bleeds (health % lost per second). Light bleeding clots on its own after a while
// unless the part is hit again; heavier bleeding keeps going until treated (bandages, later).
const BLEED_LEVELS = [
  null,
  { below: 70, rate: 0.25, name: 'Light bleeding', clotsAfter: 30 },
  { below: 45, rate: 0.8,  name: 'Bleeding' },
  { below: 20, rate: 1.8,  name: 'Severe bleeding' },
];
function bleedLevel(id) {
  const hp = player.parts[id], w = player.wounds[id];
  let lvl = 0;
  for (let i = 1; i < BLEED_LEVELS.length; i++) if (hp < BLEED_LEVELS[i].below) lvl = i;
  if (w && w.bandaged) return 0;
  if (lvl === 1 && w && w.clotted) return 0;
  return lvl;
}
function updateBleeding(dt) {
  if (player.god) return;
  let total = 0;
  for (const b of BODY_PARTS) {
    const lvl = bleedLevel(b.id); if (!lvl) continue;
    const L = BLEED_LEVELS[lvl];
    const w = player.wounds[b.id] || (player.wounds[b.id] = { t: 0, clotted: false });
    w.t += dt;
    if (L.clotsAfter && w.t >= L.clotsAfter) { w.clotted = true; continue; }
    player.parts[b.id] = Math.max(0, player.parts[b.id] - L.rate * (w.slowed ? 0.4 : 1) * dt);
    total += lvl;
    if (player.parts[b.id] <= 0) { startDying(BLED_OUT[b.id]); return; }
  }
  // Blood drips on the ground, faster the more you're bleeding.
  if (total > 0) {
    bloodT -= dt * total;
    if (bloodT <= 0) {
      bloodT = 0.9 + Math.random() * 0.6;
      blood.push({ x: player.x + (Math.random() * 10 - 5), y: player.y - 1 - Math.random() * 3, t: performance.now(), s: Math.random() < 0.35 ? 3 : 2 });
      if (blood.length > 500) blood.shift();
    }
  }
}
const BLED_OUT = {
  head: 'You bled out from a head wound.', torso: 'You bled out from wounds to your torso.',
  rArm: 'You bled out from your right arm.', lArm: 'You bled out from your left arm.',
  rHand: 'You bled out from your right hand.', lHand: 'You bled out from your left hand.',
  rLeg: 'You bled out from your right leg.', lLeg: 'You bled out from your left leg.',
  rFoot: 'You bled out from your right foot.', lFoot: 'You bled out from your left foot.',
};
let blood = [], bloodT = 0;
const BLOOD_LIFE = 60000;
function renderBlood(camX, camY, now) {
  for (const b of blood) {
    const age = (now - b.t) / BLOOD_LIFE; if (age > 1) continue;
    if (b.x < camX - 4 || b.x > camX + BW + 4 || b.y < camY - 4 || b.y > camY + BH + 4) continue;
    bctx.globalAlpha = 0.85 * (1 - age * age);
    bctx.fillStyle = age < 0.05 ? '#9c1b14' : '#6e120e';
    const bx = Math.round(b.x), by = Math.round(b.y);
    bctx.fillRect(bx, by, b.s, b.s - 1); bctx.fillRect(bx + 1, by - 1, b.s - 2 || 1, b.s + 1);
    if (b.s === 3) { bctx.fillRect(bx + 4, by + 1, 1, 1); bctx.fillRect(bx - 2, by, 1, 1); }
  }
  bctx.globalAlpha = 1;
  blood = blood.filter(b => now - b.t < BLOOD_LIFE);
}
function worstBleed() { let m = 0; for (const b of BODY_PARTS) m = Math.max(m, bleedLevel(b.id)); return m; }
const DROP = ['..#..', '.###.', '#####', '#####', '.###.'];

// ---- Dying ---------------------------------------------------------------------------------------
let deathCause = '';
function startDying(cause) {
  deathCause = cause || '';
  state = 'dying'; hurtFx.deathT = 0;
  player.moving = false;
  store.del(slotKey(slot)); // permadeath: the save is gone as soon as you die
  ui.hint.classList.add('hidden');
}

// ---- Combat -----------------------------------------------------------------------------------
// Click to attack toward the mouse. Each weapon sets how far it reaches, how wide its swing is,
// damage, speed, and how hard it knocks zombies back. Only fists exist so far; an equipped
// weapon's stats (item.weapon) will be used once weapons are added.
const WEAPONS = {
  fist: { name: 'Fists', reach: 30, arc: 55, damage: [9, 14], cooldown: 0.42, duration: 0.36, hitAt: 0.18,
          knockback: 7, stun: 0.35 },
};
const PUNCH_ROW = { S: 8, E: 9, N: 10, W: 11 };
function currentWeapon() {
  const w = inv.equip.primary && inv.equip.primary.weapon;
  return (w && WEAPONS[w]) || WEAPONS.fist;
}
const mouse = { x: 0, y: 0, down: false };
let camWorldX = 0, camWorldY = 0;
function mouseWorld() { return [camWorldX + mouse.x / scale, camWorldY + mouse.y / scale]; }
function aimDir(dx, dy) { return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'); }
function startAttack() {
  const p = player;
  if (p.attack || p.attackCd > 0 || p.swimming || p.jump) return;
  if (p.crouch) p.crouch = false;   // swinging stands you up
  const [wx, wy] = mouseWorld();
  // Aim from the player's chest, not their feet.
  const ax = wx - p.x, ay = wy - (p.y - 22);
  p.attack = { t: 0, ang: Math.atan2(ay, ax), hit: false, w: currentWeapon() };
  p.dir = aimDir(ax, ay);
}
function updateAttack(dt) {
  const p = player;
  p.attackCd = Math.max(0, (p.attackCd || 0) - dt);
  if (!p.attack) { if (mouse.down && !invOpen) startAttack(); return; }
  const a = p.attack, W = a.w;
  a.t += dt;
  if (!a.hit && a.t >= W.hitAt) {
    a.hit = true;
    // Hit the closest zombie or animal inside the weapon's reach and swing arc.
    let best = null, bd = Infinity, isAnimal = false;
    const consider = (z, extra, an) => {
      if (z.dead) return;
      const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy);
      if (d > W.reach + 8 + extra) return;
      let da = Math.abs(Math.atan2(dy, dx) - a.ang); if (da > Math.PI) da = Math.PI * 2 - da;
      if (da > W.arc * Math.PI / 180 && d > 12) return;
      if (d - extra < bd) { bd = d - extra; best = z; isAnimal = an; }
    };
    for (const z of zombies) consider(z, 0, false);
    // Big animals are easier to reach (their bodies are long).
    for (const an of animals) consider(an, Math.max(0, ANIMAL_TYPES[an.sp].radius - 8), true);
    if (best) { if (isAnimal) hitAnimal(best, W, a.ang); else hitZombie(best, W, a.ang); makeNoise(p.x, p.y, W.noise || NOISE.punch, true); }
  }
  if (a.t >= W.duration) { p.attack = null; p.attackCd = W.cooldown - W.duration; }
}
// A faint streak shows a weapon's swing (fists just use the punch animation).
function renderSwing() {
  const a = player.attack; if (!a || a.w === WEAPONS.fist) return;
  const W = a.w, t = a.t / W.duration;
  if (t < 0.2 || t > 0.8) return;
  const p = (t - 0.2) / 0.6, arc = W.arc * Math.PI / 180;
  const a0 = a.ang - arc, a1 = a0 + arc * 2 * p;
  bctx.strokeStyle = `rgba(240,235,215,${0.35 * (1 - Math.abs(p - 0.5) * 1.4)})`; bctx.lineWidth = 2;
  bctx.beginPath(); bctx.ellipse(Math.round(player.x), Math.round(player.y - 22), W.reach * 0.8, W.reach * 0.6, 0, a0, a1); bctx.stroke();
  bctx.lineWidth = 1;
}
function hitZombie(z, W, ang) {
  const dmg = W.damage[0] + Math.random() * (W.damage[1] - W.damage[0]);
  z.hp -= dmg; z.flash = 0.12;
  // A hit staggers the zombie, interrupts its attack and knocks it back a little.
  const ZT = ZOMBIE_TYPES[z.type];
  z.stun = W.stun * ZT.stunMul;
  if (z.mode === 'attack' && Math.random() < ZT.interrupt) { z.mode = 'chase'; z.cd = Math.max(z.cd, 0.5); }
  const kx = Math.cos(ang) * W.knockback * ZT.knockMul, ky = Math.sin(ang) * W.knockback * ZT.knockMul;
  if (!feetBlocked(z.x + kx, z.y)) z.x += kx;
  if (!feetBlocked(z.x, z.y + ky)) z.y += ky;
  if (z.mode !== 'chase') { z.mode = 'chase'; z.gx = player.x; z.gy = player.y; z.lostT = 0; alertAround(z); }
  for (let i = 0; i < 3; i++) blood.push({ x: z.x + (Math.random() * 12 - 6), y: z.y - 1 - Math.random() * 5, t: performance.now(), s: Math.random() < 0.5 ? 3 : 2 });
  if (z.hp <= 0) {
    z.dead = true; z.deadT = 0; z.moving = false;
    addCorpse(z, ang);
    for (let i = 0; i < 9; i++) blood.push({ x: z.x + (Math.random() * 22 - 11), y: z.y - 2 + Math.random() * 6, t: performance.now(), s: 3 });
  }
}
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0 || state !== 'play' || invOpen) return;
  mouse.x = e.clientX; mouse.y = e.clientY;
  // Clicking something usable uses it; clicking anywhere else attacks.
  if (player && hoverIt) { useInteractable(hoverIt); return; }
  mouse.down = true; if (player) startAttack();
});
window.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });


// ---- Zombie deaths ----------------------------------------------------------------------------
// When a zombie dies it staggers back from the blow, then topples over sideways (falling away
// from the hit, accelerating like gravity), bounces slightly as it lands, and lies still while
// a pool of blood spreads under it. Bodies stay for a while, then fade away.
const CORPSE_LIFE = 90, CORPSE_FADE = 4, CORPSE_MAX = 40;
let corpses = [];
function addCorpse(z, ang) {
  const c = Math.cos(ang);
  const side = Math.abs(c) < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(c);
  corpses.push({ x: z.x, y: z.y, sheet: zombieSheet(z), fx: 0, fy: IDLE_ROW[z.dir], side,
    kx: Math.cos(ang) * 5, ky: Math.sin(ang) * 3, t: 0, pool: 7 + Math.random() * 5 });
  if (corpses.length > CORPSE_MAX) corpses.shift();
}
function updateCorpses(dt) {
  for (const c of corpses) c.t += dt;
  corpses = corpses.filter(c => c.t < CORPSE_LIFE + CORPSE_FADE && Math.hypot(c.x - player.x, c.y - player.y) < Z_DESPAWN + 10 * TILE);
}
function corpsePose(t, side) {
  // Returns [rotation in degrees, stagger 0..1].
  if (t < 0.14) return [side * 8 * (t / 0.14), t / 0.14];                       // stagger back
  if (t < 0.52) { const p = (t - 0.14) / 0.38; return [side * (8 + 82 * p * p), 1]; } // topple
  if (t < 0.66) { const p = (t - 0.52) / 0.14; return [side * (90 - 9 * Math.sin(Math.PI * p)), 1]; } // bounce
  return [side * 90, 1];
}
function renderCorpses(camX, camY) {
  for (const c of corpses) {
    if (c.x < camX - 70 || c.x > camX + BW + 70 || c.y < camY - 70 || c.y > camY + BH + 40) continue;
    const [deg, st] = corpsePose(c.t, c.side);
    const fade = c.t > CORPSE_LIFE ? 1 - (c.t - CORPSE_LIFE) / CORPSE_FADE : 1;
    const bx = c.x + c.kx * st, by = c.y + c.ky * st;
    // Blood pool under the torso, spreading after the body lands.
    if (c.t > 0.6) {
      const g = Math.min(1, (c.t - 0.6) / 3), r = c.pool * (0.3 + 0.7 * g);
      bctx.globalAlpha = 0.7 * fade; bctx.fillStyle = '#5a0d0a';
      bctx.beginPath(); bctx.ellipse(Math.round(bx + (c.animal ? 0 : c.side * 22)), Math.round(by), Math.round(r * 1.6), Math.round(r * 0.6), 0, 0, Math.PI * 2); bctx.fill();
    }
    // Shadow stretches out as the body goes down.
    const lie = c.animal ? 0 : Math.abs(deg) / 90;
    bctx.globalAlpha = 0.3 * fade; bctx.fillStyle = '#10140a';
    bctx.beginPath(); bctx.ellipse(Math.round(bx + c.side * 20 * lie), Math.round(by), Math.round(9 + 16 * lie), Math.round(3 + 2 * lie), 0, 0, Math.PI * 2); bctx.fill();
    bctx.globalAlpha = fade;
    if (c.animal) {
      // Animals play their own 4-frame collapse, then stay on the last frame.
      const f = Math.min(3, Math.floor(c.t / A_DEATH_TIME * 4));
      bctx.drawImage(c.sheet, f * PF, c.fy * PF, PF, PF, Math.round(bx - 32), Math.round(by - A_ANCHOR), PF, PF);
      bctx.globalAlpha = 1;
      continue;
    }
    // The body pivots on its feet.
    bctx.save();
    bctx.translate(Math.round(bx), Math.round(by - 2 * (1 - lie)));
    bctx.rotate(deg * Math.PI / 180);
    bctx.drawImage(c.sheet, c.fx * PF, c.fy * PF, PF, PF, -P_AX, -P_AY, PF, PF);
    bctx.restore();
    bctx.globalAlpha = 1;
  }
}

// ---- Buildings: state, collisions, drawing, doors, zombies, searching ------------------------
// Placement and floor plans live in buildings_world.js; this part makes them playable.
const WALL_H = 48, WALL_CUT = 14, ROOF_OH = 6;
const EXT_SHEETS = ['cabLogs', 'cabRed', 'cabDark'];
const OPEN_HP = { door: 100, window: 60, boarded: 140 };
const BANG_RATE = 4;            // damage per second per zombie, only when 3+ are hitting the same door/window
const BANG_MIN = 3;
const bstate = new Map();       // building id -> { o: {i: {st, hp}}, c: {i: [items]}, z: 0 }
function bState(b) { let s = bstate.get(b.id); if (!s) { s = { o: {}, c: {}, z: 0 }; bstate.set(b.id, s); } return s; }

function buildingsIn(x0, y0, x1, y1) {   // pixel rect
  if (!world) return [];
  return plansInRect(world, Math.floor(x0 / TILE), Math.floor(y0 / TILE), Math.floor(x1 / TILE), Math.floor(y1 / TILE)).buildings;
}
// Wall centre lines of a building, in pixels.
function bLines(b) { return { L: b.x * TILE + 16, T: b.y * TILE + 16, R: (b.x + b.w - 1) * TILE + 16, B: (b.y + b.h - 1) * TILE + 16 }; }
function buildingAt(x, y) {
  for (const b of buildingsIn(x, y, x, y)) { const l = bLines(b); if (x > l.L && x < l.R && y > l.T && y < l.B) return b; }
  return null;
}
function openingState(b, i) {
  const s = bstate.get(b.id);
  if (s && s.o[i]) return s.o[i].st;
  const o = layoutBuilding(b).openings[i];
  const r = hash01(b.seed, i, 0x55);
  if (o.kind === 'door') {
    if (!o.outer) return r < (b.cond === 'locked' ? 0.3 : 0.6) ? 'open' : 'closed';
    if (b.cond === 'looted') return r < 0.5 ? 'open' : r < 0.68 ? 'broken' : 'closed';
    if (b.cond === 'abandoned') return r < 0.45 ? 'open' : 'closed';
    return 'closed';
  }
  if (b.cond === 'looted') return r < 0.35 ? 'broken' : 'intact';
  if (b.cond === 'abandoned') return r < 0.1 ? 'broken' : 'intact';
  return r < 0.18 && o.outer ? 'boarded' : 'intact';
}
function setOpening(b, i, st) {
  const s = bState(b); s.o[i] = { st, hp: s.o[i] ? s.o[i].hp : undefined };
  b._col = null; b._gfx = null;
}
function passable(b, i) {
  const o = layoutBuilding(b).openings[i], st = openingState(b, i);
  return o.kind === 'door' ? st !== 'closed' : st === 'broken';
}
function openingIndexAt(b, x, y) { return layoutBuilding(b).openings.findIndex(o => o.x === x && o.y === y); }
function openingCenter(b, o) { return [(b.x + o.x) * TILE + 16, (b.y + o.y) * TILE + 16]; }
function openingNormal(b, o) { const L = layoutBuilding(b); return o.y === L.H - 1 ? [0, 1] : o.y === 0 ? [0, -1] : o.x === 0 ? [-1, 0] : [1, 0]; }

// Collision rectangles: wall arms, closed doors, unbroken windows and furniture.
function buildingColliders(b) {
  if (b._col) return b._col;
  const L = layoutBuilding(b), rects = [], T = 5;
  const wallish = (x, y) => x >= 0 && y >= 0 && x < L.W && y < L.H && L.isWallish(L.cells[y][x]);
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
    if (!wallish(x, y)) continue;
    const oi = openingIndexAt(b, x, y);
    if (oi >= 0 && passable(b, oi)) continue;
    const cx = (b.x + x) * TILE + 16, cy = (b.y + y) * TILE + 16;
    rects.push([cx - T, cy - T, cx + T, cy + T]);
    if (wallish(x, y - 1)) rects.push([cx - T, cy - 16, cx + T, cy]);
    if (wallish(x, y + 1)) rects.push([cx - T, cy, cx + T, cy + 16]);
    if (wallish(x - 1, y)) rects.push([cx - 16, cy - T, cx, cy + T]);
    if (wallish(x + 1, y)) rects.push([cx, cy - T, cx + 16, cy + T]);
  }
  for (const f of L.furniture) {
    const F = FURN[f.name], [odx, ody] = furnOffset(b, f), x0 = (b.x + f.x) * TILE + odx, y0 = (b.y + f.y) * TILE + ody;
    const inset = f.name === 'chair' ? 8 : 3;
    rects.push([x0 + inset, y0 + (F.h > 1 ? 4 : 12), x0 + F.w * TILE - inset, y0 + F.h * TILE - 2]);
  }
  b._col = rects;
  return rects;
}
function buildingBlocked(x0, y0, x1, y1) {
  for (const b of buildingsIn(x0 - 32, y0 - 32, x1 + 32, y1 + 32))
    for (const r of buildingColliders(b)) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return true;
  return false;
}

// Tile-level path inside a building (for zombies finding their way between rooms).
function bPathNext(b, fromX, fromY, goalTx, goalTy) {
  const L = layoutBuilding(b);
  const sx = Math.floor(fromX / TILE) - b.x, sy = Math.floor(fromY / TILE) - b.y;
  if (sx === goalTx && sy === goalTy) return null;
  const blockedF = new Set();
  for (const f of L.furniture) { const F = FURN[f.name]; for (let y = f.y; y < f.y + F.h; y++) for (let x = f.x; x < f.x + F.w; x++) blockedF.add(x + ',' + y); }
  const ok = (x, y) => {
    if (x < 0 || y < 0 || x >= L.W || y >= L.H) return false;
    if (x === goalTx && y === goalTy) return true;
    const c = L.cells[y][x];
    if (c === '.') return !blockedF.has(x + ',' + y);
    const oi = openingIndexAt(b, x, y);
    return oi >= 0 && passable(b, oi);
  };
  const prev = new Map(), q = [[goalTx, goalTy]]; prev.set(goalTx + ',' + goalTy, null);
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (prev.has(k)) continue;
      if (nx === sx && ny === sy) { return [(b.x + x) * TILE + 16, (b.y + y) * TILE + 20]; }
      if (!ok(nx, ny)) continue;
      prev.set(k, 1); q.push([nx, ny]);
    }
  }
  return null;
}
// Where should a zombie walk to reach (tx,ty)? Handles going in and out of houses.
// Returns { x, y } to walk toward, or { bang: [building, openingIndex], x, y } to break through.
function navTarget(z, tx, ty) {
  const zb = buildingAt(z.x, z.y - 4), tb = buildingAt(tx, ty - 4);
  if (zb === tb) {
    if (!zb) return { x: tx, y: ty };
    const n = bPathNext(zb, z.x, z.y - 4, Math.floor(tx / TILE) - zb.x, Math.floor((ty - 4) / TILE) - zb.y);
    return n ? { x: n[0], y: n[1] } : { x: tx, y: ty };
  }
  const via = zb || tb, leaving = !!zb;
  const L = layoutBuilding(via);
  let best = -1, bd = Infinity, bestClosed = -1, bdc = Infinity;
  L.openings.forEach((o, i) => {
    if (!o.outer) return;
    const [cx, cy] = openingCenter(via, o);
    const d = Math.hypot(cx - z.x, cy - z.y) + (leaving ? 0 : Math.hypot(cx - tx, cy - ty) * 0.5);
    if (passable(via, i)) { if (d < bd) { bd = d; best = i; } }
    else if (d < bdc) { bdc = d; bestClosed = i; }
  });
  const pick = best >= 0 ? best : bestClosed;
  if (pick < 0) return { x: tx, y: ty };
  const o = L.openings[pick], [cx, cy] = openingCenter(via, o), [nx, ny] = openingNormal(via, o);
  const outX = cx + nx * 26, outY = cy + ny * 26 + 4, inX = cx - nx * 26, inY = cy - ny * 26 + 4;
  if (leaving) {
    const atOpening = Math.floor(z.x / TILE) === via.x + o.x && Math.floor((z.y - 4) / TILE) === via.y + o.y;
    if (best >= 0) {
      if (atOpening || Math.hypot(z.x - inX, z.y - inY) < 10) return { x: outX, y: outY };
      const n = bPathNext(via, z.x, z.y - 4, o.x, o.y);
      return n ? { x: n[0], y: n[1] } : { x: inX, y: inY };
    }
    if (Math.hypot(z.x - inX, z.y - inY) < 16) return { bang: [via, pick], x: cx, y: cy };
    const n = bPathNext(via, z.x, z.y - 4, o.x - nx, o.y - ny);
    return n ? { x: n[0], y: n[1] } : { x: inX, y: inY };
  }
  if (best >= 0) {
    if (Math.hypot(z.x - outX, z.y - outY) < 12 || Math.hypot(z.x - cx, z.y - cy - 4) < 20) return { x: inX, y: inY };
    return { x: outX, y: outY };
  }
  if (Math.hypot(z.x - outX, z.y - outY) < 16) return { bang: [via, pick], x: cx, y: cy };
  return { x: outX, y: outY };
}
function updateBanging(dt) {
  const counts = new Map();
  for (const z of zombies) if (!z.dead && z.mode === 'bang' && z.bang) {
    const k = z.bang[0].id + '|' + z.bang[1];
    const c = counts.get(k) || { b: z.bang[0], i: z.bang[1], n: 0 }; c.n++; counts.set(k, c);
  }
  for (const c of counts.values()) {
    if (c.n < BANG_MIN || passable(c.b, c.i)) continue;   // fewer than 3 zombies can't break through
    const s = bState(c.b), o = layoutBuilding(c.b).openings[c.i], st = openingState(c.b, c.i);
    const rec = s.o[c.i] || (s.o[c.i] = { st, hp: undefined });
    if (rec.hp == null) rec.hp = o.kind === 'door' ? OPEN_HP.door : st === 'boarded' ? OPEN_HP.boarded : OPEN_HP.window;
    c.b._bangNoise = (c.b._bangNoise || 0) - dt;
    if (c.b._bangNoise <= 0) { const [nx, ny] = openingCenter(c.b, o); makeNoise(nx, ny + 6, NOISE.bang); c.b._bangNoise = 1.5; }
    rec.hp -= dt * c.n * BANG_RATE;
    c.b._shake = 0.15;
    if (rec.hp <= 0) { setOpening(c.b, c.i, 'broken'); const [nx, ny] = openingCenter(c.b, o); makeNoise(nx, ny + 6, NOISE.break); }
  }
}

// ---- Resident zombies ----
function checkResidents() {
  for (const b of buildingsIn(player.x - 14 * TILE, player.y - 14 * TILE, player.x + 14 * TILE, player.y + 14 * TILE)) {
    const s = bState(b); if (s.z) continue;
    s.z = 1;
    const r = hash01(b.seed, 7, 0x2a), L = layoutBuilding(b);
    const n = b.cond === 'locked' ? (r < 0.4 ? 0 : r < 0.8 ? 1 : 2) : b.cond === 'abandoned' ? (r < 0.65 ? 0 : 1) : (r < 0.85 ? 0 : 1);
    for (let k = 0; k < n && k < L.zspots.length; k++) {
      const [zx, zy] = L.zspots[(k + Math.floor(r * 10)) % L.zspots.length];
      const z = makeZombie(Math.random() < 0.08 ? 'brute' : 'walker', (b.x + zx) * TILE + 16, (b.y + zy) * TILE + 22);
      z.home = b.id; z.t = 3 + Math.random() * 4;
      zombies.push(z);
    }
  }
}

// ---- Drawing --------------------------------------------------------------------------------
const bedColors = [[120, 40, 40], [52, 72, 110], [70, 90, 50], [140, 120, 70], [90, 60, 110], [60, 60, 60]];
const bedCache = {};
function bedSprite(ci) {
  if (bedCache[ci]) return bedCache[ci];
  const img = IMG.fBed, c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data, rgb = bedColors[ci];
  // The blanket: olive pixels below the pillow.
  const mask = [], hsl = (r, gg, bb) => { r /= 255; gg /= 255; bb /= 255; const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb), l = (mx + mn) / 2; let h = 0;
    if (mx !== mn) { const dd = mx - mn; h = mx === r ? ((gg - bb) / dd + (gg < bb ? 6 : 0)) : mx === gg ? (bb - r) / dd + 2 : (r - gg) / dd + 4; h *= 60; } return [h, l]; };
  let sum = 0;
  for (let y = 25; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const k = (y * c.width + x) * 4; if (!p[k + 3]) continue;
    const [h, l] = hsl(p[k], p[k + 1], p[k + 2]);
    if (h >= 48 && h <= 70 && l < 0.45) { mask.push(k); sum += (p[k] + p[k + 1] + p[k + 2]) / 3; }
  }
  const mean = sum / (mask.length || 1);
  for (const k of mask) { const lum = (p[k] + p[k + 1] + p[k + 2]) / 3; for (let j = 0; j < 3; j++) p[k + j] = Math.min(255, rgb[j] * (lum / mean) * 0.9 + p[k + j] * 0.1); }
  g.putImageData(d, 0, 0);
  return (bedCache[ci] = c);
}
function sliceRoof(sheet, w, h) {
  // Builds a roof of any pixel size from the 3x3 roof block (corners, edges, middle).
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  const src = (sx, sy) => [sx * 32, 96 + sy * 32];
  for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
    const sx = x === 0 ? 0 : (x + 32 >= w ? 2 : 1), sy = y === 0 ? 0 : (y + 32 >= h ? 2 : 1);
    const [ax, ay] = src(sx, sy);
    const dw = Math.min(32, w - x), dh = Math.min(32, h - y);
    // Right/bottom pieces are anchored to the far edge so the border lines up.
    const ox = sx === 2 ? w - 32 : x, oy = sy === 2 ? h - 32 : y;
    g.drawImage(sheet, ax, ay, 32, 32, ox, oy, 32, 32);
    if (sx !== 2 && sy !== 2 && dw < 32) { /* covered by edge pieces */ }
  }
  return c;
}
function gradient(g, x, y, w, h, a0, a1, color = '0,0,0') {
  for (let i = 0; i < h; i++) { const t = h > 1 ? i / (h - 1) : 0; g.fillStyle = `rgba(${color},${a0 + (a1 - a0) * t})`; g.fillRect(x, y + i, w, 1); }
}
// Exterior: ground shadow + front wall (with its doors and windows) + roof. Cached per house.
function buildExterior(b) {
  const L = layoutBuilding(b), l = bLines(b), sheet = IMG[EXT_SHEETS[b.mat]];
  const base = l.B + 4, faceL = l.L - 4, faceR = l.R + 4, faceW = faceR - faceL;
  const pad = 40, x0 = faceL - pad, y0 = l.T - 4 - WALL_H - ROOF_OH - pad;
  const c = document.createElement('canvas'); c.width = faceW + pad * 2 + 24; c.height = base - y0 + pad;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  const X = v => v - x0, Y = v => v - y0;
  // Shadow on the ground (light from the top-left).
  const roofTop = l.T - 4 - WALL_H - ROOF_OH;
  g.fillStyle = 'rgba(10,14,6,0.38)';
  g.beginPath();
  g.moveTo(X(faceR + ROOF_OH), Y(roofTop)); g.lineTo(X(faceR + ROOF_OH + 18), Y(roofTop + 14));
  g.lineTo(X(faceR + 18), Y(base + 8)); g.lineTo(X(faceL + 14), Y(base + 8)); g.lineTo(X(faceL), Y(base));
  g.lineTo(X(faceR), Y(base)); g.closePath(); g.fill();
  // Front wall.
  const south = new Map(); L.openings.forEach((o, i) => { if (o.south) south.set(o.x, i); });
  for (let tx = 0; tx < L.W; tx++) {
    const px = (b.x + tx) * TILE;
    let sx = 32 + (tx % 2) * 32, sy = 0;
    if (south.has(tx)) {
      const i = south.get(tx), o = L.openings[i], st = openingState(b, i);
      sy = 48;
      sx = o.kind === 'door' ? (st === 'closed' ? 0 : st === 'open' ? 32 : 64) : (st === 'intact' ? 96 : st === 'broken' ? 128 : 160);
    }
    const cl = Math.max(px, faceL), cr = Math.min(px + 32, faceR);
    if (cr <= cl) continue;
    g.drawImage(sheet, sx + (cl - px), sy, cr - cl, 48, X(cl), Y(base - 48), cr - cl, 48);
  }
  g.drawImage(sheet, 0, 0, 5, 48, X(faceL), Y(base - 48), 5, 48);
  g.drawImage(sheet, 123, 0, 5, 48, X(faceR - 5), Y(base - 48), 5, 48);
  gradient(g, X(faceL), Y(base - 48), faceW, 8, 0.55, 0);      // shade under the eaves
  gradient(g, X(faceL), Y(base - 3), faceW, 3, 0, 0.35);       // contact with the ground
  b._gfx = { ext: c, x0, y0, roof: buildRoof(b), base };
}
function buildRoof(b) {
  const l = bLines(b), sheet = IMG[EXT_SHEETS[b.mat]];
  const rx = l.L - 4 - ROOF_OH, ry = l.T - 4 - WALL_H - ROOF_OH;
  const rw = (l.R + 4 + ROOF_OH) - rx, rh = (l.B + 4 - WALL_H + 3) - ry;
  const c = sliceRoof(sheet, rw, rh), g = c.getContext('2d');
  // Two slopes: the back one is darker and shorter; the front one catches more light.
  const split = Math.round(rh * 0.4);
  g.fillStyle = 'rgba(0,0,0,0.24)'; g.fillRect(0, 0, rw, split);
  gradient(g, 0, 0, rw, split, 0.12, 0);
  g.fillStyle = 'rgba(255,240,210,0.05)'; g.fillRect(0, split, rw, rh - split);
  gradient(g, 0, split, rw, rh - split, 0, 0.24);
  for (let x = 0; x < rw; x += 32) g.drawImage(sheet, 96, 136, Math.min(32, rw - x), 16, x, split - 8, Math.min(32, rw - x), 16);
  // Roof edge thickness and right-hand edge.
  g.fillStyle = '#2e2016'; g.fillRect(0, rh - 4, rw, 3); g.fillStyle = '#120c08'; g.fillRect(0, rh - 1, rw, 1);
  g.fillRect(rw - 1, 0, 1, rh);
  // Chimney on some houses.
  if (b.seed % 3 !== 0) {
    const cx = Math.round(rw * (b.seed % 2 ? 0.72 : 0.26)), cy = split - 26;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.moveTo(cx + 14, cy + 4); g.lineTo(cx + 24, cy + 12); g.lineTo(cx + 24, cy + 28); g.lineTo(cx + 14, cy + 24); g.fill();
    g.fillStyle = '#6e5446'; g.fillRect(cx, cy, 14, 24); g.fillStyle = '#4e3b31'; g.fillRect(cx + 9, cy, 5, 24);
    g.fillStyle = '#3e342e'; g.fillRect(cx - 1, cy - 3, 16, 3);
  }
  return { c, x: rx, y: ry };
}
// Interior floor with wall contact shadows and window light. Cached per house.
function buildFloor(b) {
  const L = layoutBuilding(b), l = bLines(b);
  const c = document.createElement('canvas'); c.width = l.R - l.L; c.height = l.B - l.T;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  for (let ty = 0; ty < L.H; ty++) for (let tx = 0; tx < L.W; tx++) {
    const k = hashInt(b.x + tx, b.y + ty, 0x71) % 3;
    g.drawImage(IMG.floorWood, k * 32, 0, 32, 32, (b.x + tx) * TILE - l.L, (b.y + ty) * TILE - l.T, 32, 32);
  }
  // Room edges a little darker.
  for (let i = 0; i < 16; i++) { g.strokeStyle = `rgba(8,8,8,${0.28 * (1 - i / 16)})`; g.strokeRect(i + 0.5, i + 0.5, c.width - 2 * i - 1, c.height - 2 * i - 1); }
  const wallish = (x, y) => x >= 0 && y >= 0 && x < L.W && y < L.H && L.isWallish(L.cells[y][x]);
  for (let ty = 0; ty < L.H; ty++) for (let tx = 0; tx < L.W; tx++) {
    if (!wallish(tx, ty)) continue;
    const cx = (b.x + tx) * TILE + 16 - l.L, cy = (b.y + ty) * TILE + 16 - l.T;
    g.fillStyle = 'rgba(0,0,0,0.2)';
    if (wallish(tx, ty - 1) || wallish(tx, ty + 1)) g.fillRect(cx + 4, cy - 16, 10, 32);   // vertical walls: shadow to the east
    if (wallish(tx - 1, ty) || wallish(tx + 1, ty)) g.fillRect(cx - 16, cy + 4, 32, 7);    // horizontal: shadow below
  }
  // Daylight through windows.
  L.openings.forEach((o, i) => {
    if (o.kind !== 'window' || openingState(b, i) === 'boarded') return;
    const [cx, cy] = openingCenter(b, o), x = cx - l.L, y = cy - l.T;
    g.fillStyle = 'rgba(255,236,190,0.13)';
    g.beginPath();
    if (o.y === 0) { g.moveTo(x - 9, y + 6); g.lineTo(x + 9, y + 6); g.lineTo(x + 24, y + 60); g.lineTo(x - 2, y + 60); }
    else if (o.y === L.H - 1) { g.moveTo(x - 9, y - 4); g.lineTo(x + 9, y - 4); g.lineTo(x + 2, y - 30); g.lineTo(x - 14, y - 30); }
    else if (o.x === 0) { g.moveTo(x + 6, y - 10); g.lineTo(x + 6, y + 10); g.lineTo(x + 50, y + 22); g.lineTo(x + 50, y + 2); }
    else { g.moveTo(x - 6, y - 10); g.lineTo(x - 6, y + 10); g.lineTo(x - 40, y + 22); g.lineTo(x - 40, y + 2); }
    g.fill();
  });
  return c;
}
// One wall tile, raised to wall height (the south wall is cut down when you're inside).
function drawWallTile(b, tx, ty, cut) {
  const L = layoutBuilding(b);
  const wallish = (x, y) => x >= 0 && y >= 0 && x < L.W && y < L.H && L.isWallish(L.cells[y][x]);
  const n = wallish(tx, ty - 1), e = wallish(tx + 1, ty), s = wallish(tx, ty + 1), w = wallish(tx - 1, ty);
  const front = ty === L.H - 1, h = front && cut ? WALL_CUT : WALL_H;
  const px = (b.x + tx) * TILE, cx = px + 16, base = (b.y + ty) * TILE + 20;
  const oi = openingIndexAt(b, tx, ty), o = oi >= 0 ? L.openings[oi] : null, st = o ? openingState(b, oi) : null;
  const shake = b._shake > 0 && o ? Math.round(Math.random() * 2 - 1) : 0;
  if (e || w) {
    let sx = 32 + ((tx + ty) % 2) * 32, sy = 0;
    if (o) { sy = 48; sx = o.kind === 'door' ? (st === 'closed' ? 0 : st === 'open' ? 32 : 64) : (st === 'intact' ? 96 : st === 'broken' ? 128 : 160); }
    const xa = w ? px : cx - 4, xb = e ? px + 32 : cx + 4;
    bctx.drawImage(IMG.intWall, sx + (xa - px), sy + 48 - h, xb - xa, h, xa + shake, base - h, xb - xa, h);
    if (ty !== 0) { bctx.fillStyle = 'rgba(0,0,0,0.1)'; bctx.fillRect(xa, base - h, xb - xa, h); }
    for (let i = 0; i < Math.min(h, 24); i++) { bctx.fillStyle = `rgba(0,0,0,${0.3 * (i / 24) ** 2})`; bctx.fillRect(xa, base - Math.min(h, 24) + i, xb - xa, 1); }
    if (!w) bctx.drawImage(IMG.intWall, 0, 48 - h, 5, h, cx - 4, base - h, 5, h);
    if (!e) bctx.drawImage(IMG.intWall, 123, 48 - h, 5, h, cx - 1, base - h, 5, h);
  } else if (!s) {
    bctx.drawImage(IMG.intWall, 42, 48 - h, 8, h, cx - 4, base - h, 8, h);
    bctx.fillStyle = 'rgba(0,0,0,0.25)'; bctx.fillRect(cx - 4, base - h, 8, h);
  }
  // Top of the wall.
  let tsx, tsy;
  if (o) {
    const vert = !(e || w);
    tsy = vert ? 32 : 0;
    tsx = o.kind === 'door' ? (st === 'closed' ? 0 : 32) : (st === 'broken' ? 96 : 64);
  } else {
    const key = (n ? 'N' : '') + (e ? 'E' : '') + (s ? 'S' : '') + (w ? 'W' : '');
    [tsx, tsy] = WALLTOP[key] || WALLTOP.NESW;
  }
  bctx.drawImage(o ? IMG.wallOpen : IMG.wallTop, tsx, tsy, 32, 32, px + shake, (b.y + ty) * TILE - h, 32, 32);
}
const WALLTOP = { EW: [0, 0], E: [0, 96], W: [64, 96], NS: [32, 0], N: [96, 64], S: [32, 96], NE: [64, 0], ES: [96, 0], SW: [0, 32], NW: [32, 32],
  NES: [64, 32], ESW: [96, 32], NSW: [0, 64], NEW: [32, 64], NESW: [64, 64] };
// Furniture next to a wall is pushed up against it (walls are thin and sit in the middle of their tile).
function furnOffset(b, f) {
  if (f._off) return f._off;
  const L = layoutBuilding(b), F = FURN[f.name];
  const wall = (x, y) => x >= 0 && y >= 0 && x < L.W && y < L.H && L.isWallish(L.cells[y][x]);
  let dx = 0, dy = 0, n = true, w = true, e = true;
  for (let x = f.x; x < f.x + F.w; x++) if (!wall(x, f.y - 1)) n = false;
  for (let y = f.y; y < f.y + F.h; y++) { if (!wall(f.x - 1, y)) w = false; if (!wall(f.x + F.w, y)) e = false; }
  if (n) dy = -12;
  if (w && !e) dx = -10; else if (e && !w) dx = 10;
  return (f._off = [dx, dy]);
}
function drawFurniture(b, f, searched) {
  const F = FURN[f.name], img = f.name === 'bed' ? bedSprite(hashInt(b.seed, f.i, 3) % bedColors.length) : IMG[F.img];
  const [odx, ody] = furnOffset(b, f);
  const x = (b.x + f.x) * TILE + Math.round((F.w * TILE - img.width) / 2) + odx, bottom = (b.y + f.y + F.h) * TILE + ody;
  bctx.fillStyle = 'rgba(0,0,0,0.25)'; bctx.fillRect(x + 4, bottom - 6, img.width - 1, 6);
  if (searched) bctx.filter = 'brightness(0.8)';
  bctx.drawImage(img, x, bottom - img.height);
  if (searched) bctx.filter = 'none';
}
// Adds a building's drawables to the depth-sorted list for this frame.
let insideB = null;
function collectBuildings(camX, camY, items) {
  const bs = buildingsIn(camX - 64, camY - 64, camX + BW + 64, camY + BH + 120);
  const now = frameTime;
  for (const b of bs) {
    if (!b._gfx) buildExterior(b);
    const target = b === insideB ? 0 : 1;
    b.roofA = b.roofA == null ? target : b.roofA + Math.sign(target - b.roofA) * Math.min(Math.abs(target - b.roofA), 0.08);
    if (b._shake > 0) b._shake -= 1 / 60;
    if (b.roofA < 1) {
      // Interior visible: floor goes down now, walls and furniture are sorted with everything else.
      if (!b._floor) b._floor = buildFloor(b);
      const l = bLines(b);
      bctx.drawImage(b._floor, l.L, l.T);
      const L = layoutBuilding(b), s = bstate.get(b.id);
      for (let ty = 0; ty < L.H; ty++) for (let tx = 0; tx < L.W; tx++)
        if (L.isWallish(L.cells[ty][tx])) items.push({ k: -3, x: 0, y: (b.y + ty) * TILE + 20, b, tx, ty });
      for (const f of L.furniture) items.push({ k: -4, x: 0, y: (b.y + f.y + FURN[f.name].h) * TILE - 2 + furnOffset(b, f)[1], b, f, searched: !!(s && s.c[f.i]) });
    }
    items.push({ k: -5, x: 0, y: b._gfx.base, b });
  }
  return bs;
}
function drawBuildingItem(o) {
  const b = o.b;
  if (o.k === -3) { drawWallTile(b, o.tx, o.ty, b === insideB); return; }
  if (o.k === -4) { drawFurniture(b, o.f, o.searched); return; }
  // Exterior and roof.
  const G = b._gfx;
  if (b.roofA >= 0.999) bctx.drawImage(G.ext, G.x0, G.y0);
  if (b.roofA > 0.001) {
    bctx.globalAlpha = b.roofA;
    bctx.drawImage(G.roof.c, G.roof.x, G.roof.y);
    bctx.globalAlpha = 1;
  }
}
// Outside goes dark while you're in a house; windows let a little light (and sight) through.
const darkC = document.createElement('canvas'), darkG = darkC.getContext('2d');
function renderInsideDarkness(camX, camY) {
  if (!insideB) return;
  if (darkC.width !== BW || darkC.height !== BH) { darkC.width = BW; darkC.height = BH; }
  const g = darkG, l = bLines(insideB);
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, BW, BH);
  g.fillStyle = 'rgba(3,5,3,0.9)'; g.fillRect(0, 0, BW, BH);
  g.globalCompositeOperation = 'destination-out';
  g.filter = 'blur(3px)';
  g.fillStyle = '#000'; g.fillRect(l.L - 6 - camX, l.T - 6 - WALL_H - camY, l.R - l.L + 12, l.B - l.T + WALL_H + 16);
  g.filter = 'none';
  const L = layoutBuilding(insideB);
  L.openings.forEach((o, i) => {
    if (!o.outer) return;
    const st = openingState(insideB, i);
    if (o.kind === 'window' && st === 'boarded') return;
    if (o.kind === 'door' && st === 'closed') return;
    const [cx, cy] = openingCenter(insideB, o), [nx, ny] = openingNormal(insideB, o);
    const gx = cx + nx * 50 - camX, gy = cy + ny * 50 - camY - (ny ? 10 : 0);
    const gr = g.createRadialGradient(gx, gy, 4, gx, gy, 78);
    gr.addColorStop(0, 'rgba(0,0,0,0.62)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(gx - 80, gy - 80, 160, 160);
  });
  g.globalCompositeOperation = 'source-over';
  bctx.drawImage(darkC, 0, 0);
}

// ---- Interacting: click doors and furniture ----
// Things you can use within reach get a small white dot; hovering one shows the hand cursor,
// clicking it opens/closes a door or searches furniture (searching takes a moment).
const REACH = 44, SEARCH_TIME = 0.9;
let nearby = [], hoverIt = null, searching = null;
function furnRect(b, f) {
  const F = FURN[f.name], img = f.name === 'bed' ? IMG.fBed : IMG[F.img], [odx, ody] = furnOffset(b, f);
  const x = (b.x + f.x) * TILE + Math.round((F.w * TILE - img.width) / 2) + odx, bottom = (b.y + f.y + F.h) * TILE + ody;
  return [x, bottom - img.height, x + img.width, bottom];
}
// World objects (trees, rocks, camp pieces...) whose base is inside a pixel rect.
function objectsIn(x0, y0, x1, y1) {
  const out = [];
  for (let cy = Math.floor(y0 / CPX); cy <= Math.floor(y1 / CPX); cy++)
    for (let cx = Math.floor(x0 / CPX); cx <= Math.floor(x1 / CPX); cx++)
      for (const o of getData(cx, cy).objects) if (o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1) out.push(o);
  return out;
}
function findNearby() {
  const out = [], px = player.x, py = player.y - 10;
  if (player.swimming || player.jump) return out;
  const pb = insideB;
  for (const b of buildingsIn(px - 96, py - 96, px + 96, py + 96)) {
    const L = layoutBuilding(b), inside = b === pb;
    L.openings.forEach((o, i) => {
      if (o.kind !== 'door' || openingState(b, i) === 'broken') return;
      // From outside you can only reach the front doors you can see; inside, any door.
      if (!inside && !(o.outer && o.south)) return;
      const tx = (b.x + o.x) * TILE, ty = (b.y + o.y) * TILE;
      const vert = !o.horiz, h = o.south && inside ? WALL_CUT : WALL_H;
      const rect = vert ? [tx + 8, ty - h, tx + 24, ty + 32] : [tx + 4, ty + 20 - h, tx + 28, ty + 28];
      const dot = vert ? [tx + 16, ty - h + 16] : [tx + 16, ty + 20 - Math.round(h / 2)];
      out.push({ type: 'door', b, i, rect, dot });
    });
    if (!inside) continue;
    for (const f of L.furniture) {
      if (!FURN[f.name].container) continue;
      const rect = furnRect(b, f);
      out.push({ type: 'search', b, f, rect, dot: [Math.round((rect[0] + rect[2]) / 2), Math.round((rect[1] + rect[3]) / 2)] });
    }
  }
  // Crates at camps (only from outside).
  if (!pb) for (const o of objectsIn(px - 96, py - 96, px + 96, py + 96)) {
    const k = KINDS[o.k]; if (!k.crate || !o.camp) continue;
    const rect = [o.x - k.ax, o.y - k.ay, o.x - k.ax + k.sw, o.y - k.ay + k.sh];
    out.push({ type: 'search', b: o.camp, f: { i: o.ci, name: k.crate, crate: true }, rect, dot: [Math.round(o.x), Math.round(o.y - k.ay + k.sh / 2)] });
  }
  return out.filter(it => {
    const [x0, y0, x1, y1] = it.rect, f = it.type === 'door' ? 0 : 0;
    const fx = it.type === 'search' ? Math.max(x0 - px, 0, px - x1) : Math.max(x0 - px, 0, px - x1);
    const fy = it.type === 'door' ? Math.max(y1 - 30 - py, 0, py - y1 - 4) : Math.max(y0 - py, 0, py - y1);
    return Math.hypot(fx, fy) < REACH + f;
  });
}
function updateInteract(dt) {
  nearby = findNearby();
  if (state === 'play' && !invOpen) {
    const [mx, my] = mouseWorld();
    hoverIt = nearby.find(it => mx >= it.rect[0] - 3 && mx <= it.rect[2] + 3 && my >= it.rect[1] - 3 && my <= it.rect[3] + 3) || null;
  } else hoverIt = null;
  canvas.style.cursor = hoverIt ? HAND_CURSOR : 'crosshair';
  if (searching) {
    // Keep searching while you stay close; walking off cancels it.
    if (!nearby.some(it => it.type === 'search' && it.b.id === searching.it.b.id && it.f.i === searching.it.f.i)) { searching = null; return; }
    searching.t += dt;
    if (searching.t >= SEARCH_TIME) {
      const it = searching.it, s = bState(it.b);
      s.c[it.f.i] = rollLoot(it.b, it.f); searching = null;
      openContainer(it);
    }
  }
}
function useInteractable(it) {
  if (it.type === 'door') {
    const st = openingState(it.b, it.i);
    const [cx, cy] = openingCenter(it.b, layoutBuilding(it.b).openings[it.i]);
    if (st === 'open') {
      // Can't shut a door on someone standing in it.
      const inWay = [player, ...zombies.filter(z => !z.dead)].some(a => Math.abs(a.x - cx) < 18 && Math.abs(a.y - 4 - cy) < 18);
      if (inWay) { toast('Something is in the way'); return; }
    }
    makeNoise(cx, cy + 4, NOISE.door, true);
    setOpening(it.b, it.i, st === 'closed' ? 'open' : 'closed');
    return;
  }
  const s = bState(it.b), [x0, y0, x1, y1] = it.rect, cx = (x0 + x1) / 2, cy = y1;
  if (s.c[it.f.i]) { openContainer(it); makeNoise(cx, cy, NOISE.search * 0.6, true); return; }
  if (searching) return;
  searching = { it, t: 0 };
  makeNoise(cx, cy, NOISE.search, true);
}
function renderInteractDots() {
  if (invOpen) return;
  for (const it of nearby) {
    const [x, y] = it.dot, big = it === hoverIt;
    const r = big ? 2 : 1;
    bctx.fillStyle = 'rgba(0,0,0,0.75)'; bctx.fillRect(x - r - 1, y - r - 1, r * 2 + 3, r * 2 + 3);
    bctx.fillStyle = '#ffffff'; bctx.fillRect(x - r, y - r, r * 2 + 1, r * 2 + 1);
  }
  if (searching) {
    const [x0, y0, x1] = searching.it.rect, w = 22, x = Math.round((x0 + x1) / 2 - w / 2), y = Math.round(y0 - 7);
    bctx.fillStyle = '#000'; bctx.fillRect(x - 1, y - 1, w + 2, 5);
    bctx.fillStyle = '#c8b46a'; bctx.fillRect(x, y, Math.round(w * Math.min(1, searching.t / SEARCH_TIME)), 3);
  }
}
let HAND_CURSOR = 'pointer';
function prepareCursor() {
  const img = IMG.cursorHand; if (!img) return;
  // Native size (17x25), about the same as a normal system cursor; hotspot at the fingertip.
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  HAND_CURSOR = `url(${c.toDataURL()}) 7 0, pointer`;
}

// ---- Noise ------------------------------------------------------------------------------------
// Zombies hunt by sight and by sound. Every noise has a radius (in tiles); zombies inside it that
// aren't already chasing you walk over to investigate where it came from (roughly — the further
// away they heard it, the vaguer their idea of where). Walls muffle sound going in or out.
const NOISE = {
  walk: 2.5,      // footsteps: quiet
  crouch: 0.8,    // sneaking: almost silent
  swim: 4,        // splashing
  land: 3.5,      // landing from a jump
  run: 7,         // running: carries a fair way
  punch: 4,       // a fight
  door: 8,        // opening or closing a door
  search: 6,      // rummaging through drawers and cupboards
  bang: 10,       // zombies hammering on a door or window
  break: 13,      // a door or window giving way
};
const MUFFLE = 0.55;          // walls cut sound to about half
function makeNoise(x, y, tiles, fromPlayer) {
  const src = buildingAt(x, y - 4);
  if (!src) scareAnimals(x, y, tiles);
  for (const z of zombies) {
    if (z.dead || z.mode === 'chase' || z.mode === 'attack' || z.mode === 'bang') continue;
    const zb = buildingAt(z.x, z.y - 4);
    const r = tiles * TILE * (zb === src ? 1 : MUFFLE);
    const d = Math.hypot(z.x - x, z.y - y);
    if (d > r) continue;
    const err = d * 0.18;
    z.mode = 'investigate'; z.lostT = 0; z.t = 0;
    z.gx = x + (Math.random() * 2 - 1) * err; z.gy = y + (Math.random() * 2 - 1) * err;
  }
}
let stepNoiseT = 0;
function updatePlayerNoise(dt) {
  stepNoiseT -= dt;
  if (!player.moving || stepNoiseT > 0) return;
  if (player.swimming) { makeNoise(player.x, player.y, NOISE.swim, true); stepNoiseT = 0.8; }
  else if (player.crouch) { makeNoise(player.x, player.y, NOISE.crouch, true); stepNoiseT = 0.9; }
  else if (player.running) { makeNoise(player.x, player.y, NOISE.run, true); stepNoiseT = 0.45; }
  else { makeNoise(player.x, player.y, NOISE.walk, true); stepNoiseT = 0.7; }
}
// Can a zombie outside see into the player's house? Only through a window or an open doorway
// close to the player, and only from the outside of that opening.
function seesThroughOpening(z, pb) {
  const L = layoutBuilding(pb);
  for (let i = 0; i < L.openings.length; i++) {
    const o = L.openings[i]; if (!o.outer) continue;
    const st = openingState(pb, i);
    if (o.kind === 'door' ? st === 'closed' : st === 'boarded') continue;
    const [cx, cy] = openingCenter(pb, o), [nx, ny] = openingNormal(pb, o);
    if (Math.hypot(player.x - cx, player.y - 8 - cy) > 3 * TILE) continue;
    const dz = Math.hypot(z.x - cx, z.y - 8 - cy);
    if (dz > 6 * TILE) continue;
    if ((z.x - cx) * nx + (z.y - 8 - cy) * ny > 4) return true;
  }
  return false;
}
// Zombies notice what's in front of them; up close they notice you from any direction.
function inView(z, dx, dy, d, T) {
  // A crouching player is only spotted from about 60% as far, and has to be closer to be noticed from behind.
  const sight = T.sight * (player.crouch ? 0.6 : 1), near = (player.crouch ? 2 : 3) * TILE;
  if (d < near || z.mode === 'chase' || z.mode === 'bang' || z.mode === 'attack') return d < sight;
  const f = DIR_VEC[z.dir];
  return d < sight && (dx * f[0] + dy * f[1]) / d > 0.35;   // roughly a 140° cone
}

// ---- World rendering ---------------------------------------------------------------------------
let frameTime = 0;
function drawShadow(x, y, rx, ry) {
  if (!rx) return;
  bctx.beginPath();
  bctx.ellipse(Math.round(x + rx * 0.25), Math.round(y - 1), rx, ry, 0, 0, Math.PI * 2);
  bctx.fill();
}
function drawRipple(x, y, r) {
  const w = r + Math.sin(frameTime / 260) * 1.5;
  bctx.strokeStyle = 'rgba(205,230,235,0.45)'; bctx.lineWidth = 1;
  bctx.beginPath(); bctx.ellipse(Math.round(x), Math.round(y), w, w * 0.32, 0, 0.05 * Math.PI, 0.95 * Math.PI); bctx.stroke();
  bctx.strokeStyle = 'rgba(205,230,235,0.2)';
  bctx.beginPath(); bctx.ellipse(Math.round(x), Math.round(y), w + 4, (w + 4) * 0.32, 0, 0.1 * Math.PI, 0.9 * Math.PI); bctx.stroke();
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
  insideB = withPlayer ? buildingAt(player.x, player.y - 4) : null;
  collectBuildings(camX, camY, items);
  if (withPlayer) { renderBlood(camX, camY, frameTime); renderCorpses(camX, camY); }
  if (withPlayer) {
    // Mid-jump the player is drawn in front of whatever they're jumping over.
    items.push({ k: -1, x: player.x, y: player.y + (jumpHeight(player) > 2 ? 30 : 0) });
    for (const z of zombies) {
      if (z.x < camX - 40 || z.x > camX + BW + 40 || z.y < camY - 8 || z.y > camY + BH + 64) continue;
      items.push({ k: -2, x: z.x, y: z.y, z });
    }
    for (const a of animals) {
      if (a.x < camX - 40 || a.x > camX + BW + 40 || a.y < camY - 8 || a.y > camY + BH + 64) continue;
      items.push({ k: -9, x: a.x, y: a.y, a });
    }
  }
  items.sort((a, b) => a.y - b.y);

  bctx.fillStyle = 'rgba(16, 20, 8, 0.32)';
  for (const o of items) {
    if (o.k === -9) { drawShadow(o.x, o.y, ...ANIMAL_TYPES[o.a.sp].shadow); continue; }
    if (o.k <= -3) continue;
    if (o.k === -2 && ZOMBIE_TYPES[o.z.type].shadow) drawShadow(o.x, o.y, ...ZOMBIE_TYPES[o.z.type].shadow);
    else if (o.k === -1) { if (!player.swimming) { const h = jumpHeight(player); drawShadow(player.x, player.y, 9 - h * 0.25, 3 - h * 0.08); } }
    else if (o.k === -2) { if (!inWater(o.x, o.y)) drawShadow(o.x, o.y, 9, 3); }
    else if (o.k < 0) drawShadow(o.x, o.y, 9, 3);
    else { const k = KINDS[o.k]; drawShadow(o.x, o.y, k.rx, k.ry); }
  }

  const pbx0 = withPlayer ? player.x - 11 : 0, pby0 = withPlayer ? player.y - 46 : 0;
  for (const o of items) {
    if (o.k === -9) { drawAnimal(o.a); continue; }
    if (o.k <= -3) { drawBuildingItem(o); continue; }
    if (o.k === -1) {
      const [fx, fy, sheet] = playerFrame(player);
      const moves = sheet === 'moves', lift = jumpHeight(player);
      const dx = Math.round(player.x - P_AX), dy = Math.round(player.y - P_AY) - lift;
      bctx.drawImage(moves ? IMG.playerMoves : IMG.player, fx * PF, fy * PF, PF, PF, dx, dy, PF, PF);
      // Worn gear is drawn on top, frame for frame (the jump/swim/crouch frames are generated).
      for (const slot of ['clothes', 'backpack', 'helmet']) {
        const it = inv.equip[slot], def = it && (ITEMS[it.key] || it);
        const img = def && def.wear && IMG[def.wear + (moves ? 'Moves' : '')];
        if (img) bctx.drawImage(img, fx * PF, fy * PF, PF, PF, dx, dy, PF, PF);
      }
      if (player.swimming) drawRipple(player.x, player.y - 7, 13);
      continue;
    }
    if (o.k === -2) {
      const [fx, fy] = zombieFrame(o.z);
      // Lunge forward slightly at the end of an attack.
      let lx = 0, ly = 0;
      if (o.z.mode === 'attack' && o.z.atk < 0.15) { const v = { N: [0, -3], S: [0, 3], E: [3, 0], W: [-3, 0] }[o.z.dir]; lx = v[0]; ly = v[1]; }
      const z = o.z;
      if (z.stun > 0) { const v = { N: [0, 2], S: [0, -2], E: [-2, 0], W: [2, 0] }[z.dir]; lx += v[0]; ly += v[1]; }
      if (z.flash > 0) bctx.filter = 'brightness(2.4) saturate(0.3)';
      if (inWater(z.x, z.y)) {
        // Wading/swimming: the zombie sits lower and everything below the waterline is hidden.
        // Drawn at full size, just lower, and cut off at the waterline (no squashing).
        const sink = 14, waterline = 7, visH = P_AY - waterline - sink;
        bctx.drawImage(zombieSheet(z), fx * PF, fy * PF, PF, visH, Math.round(o.x - P_AX + lx), Math.round(o.y - P_AY + ly) + sink, PF, visH);
      } else bctx.drawImage(zombieSheet(z), fx * PF, fy * PF, PF, PF, Math.round(o.x - P_AX + lx), Math.round(o.y - P_AY + ly), PF, PF);
      if (z.flash > 0) bctx.filter = 'none';
      if (inWater(z.x, z.y)) drawRipple(o.x, o.y - 7, 14);
      continue;
    }
    const k = KINDS[o.k], sx = o.x - k.ax, sy = o.y - k.ay;
    let fade = false;
    if (withPlayer && k.tall && player.y < o.y &&
        rectsHit(pbx0, pby0, pbx0 + 22, player.y, sx + 4, sy, sx + k.sw - 4, o.y - k.ch)) fade = true;
    if (fade) bctx.globalAlpha = 0.45;
    bctx.drawImage(k.img ? IMG[k.img] : IMG.objects, k.sx, k.sy, k.sw, k.sh, sx, sy, k.sw, k.sh);
    if (k.fire && o.lit) {
      // Smoke then flame, at the same origin as the fire ring. They loop on their own clocks:
      // the flame flickers quickly while the smoke drifts slowly.
      const smoke = (Math.floor(frameTime / 260) + o.ph) % 4, flame = (Math.floor(frameTime / 110) + o.ph) % 4;
      bctx.drawImage(IMG.camp, smoke * 64, 192, 64, 64, sx, sy, 64, 64);
      bctx.drawImage(IMG.camp, flame * 64, 128, 64, 64, sx, sy, 64, 64);
    }
    if (fade) bctx.globalAlpha = 1;
  }
  if (withPlayer) { renderSwing(); renderInteractDots(); }
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  if (withPlayer) renderInsideDarkness(camX, camY);
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
  // Blood drops: one per bleeding body part (up to 3), pulsing faster when it's worse.
  const bleeding = BODY_PARTS.map(b => bleedLevel(b.id)).filter(Boolean).sort((a, b) => b - a);
  bleeding.slice(0, 3).forEach((lvl, i) => {
    const dx = bx + w + 5 + i * 8, period = [0, 900, 550, 300][lvl];
    const on = Math.floor(frameTime / period) % 2 === 0;
    const col = lvl === 3 ? (on ? '#ff3b2b' : '#a3150e') : lvl === 2 ? (on ? '#e0392c' : '#8e1a13') : '#b8352a';
    DROP.forEach((row, r) => { for (let c = 0; c < 5; c++) if (row[c] === '#') {
      bctx.fillStyle = '#000'; bctx.fillRect(dx + c, by + r + 1, 1, 1);
    } });
    DROP.forEach((row, r) => { for (let c = 0; c < 5; c++) if (row[c] === '#') {
      bctx.fillStyle = (r === 2 && c === 1) ? '#ffb3a6' : col; bctx.fillRect(dx + c, by + r, 1, 1);
    } });
  });
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


// ---- Hunger and thirst ---------------------------------------------------------------------------
// Both drain over time (faster while running). Full to empty takes about 50 minutes for hunger
// and 30 for thirst. Once either is empty you start losing health and will die without food/water.
const HUNGER_TIME = 50 * 60, THIRST_TIME = 30 * 60;
function updateNeeds(dt) {
  if (player.god) return;
  const effort = player.swimming ? 1.8 : player.running ? 1.8 : player.moving ? 1.15 : 1;
  player.hunger = Math.max(0, player.hunger - dt * 100 / HUNGER_TIME * effort);
  player.thirst = Math.max(0, player.thirst - dt * 100 / THIRST_TIME * effort);
  // Starving / dehydrating wears the body down (the torso takes it).
  let drain = 0;
  if (player.hunger <= 0) drain += 0.25;
  if (player.thirst <= 0) drain += 0.45;
  if (drain) {
    player.parts.torso = Math.max(0, player.parts.torso - drain * dt);
    if (player.parts.torso <= 0) startDying(player.thirst <= 0 ? 'You died of thirst.' : 'You starved to death.');
  }
}
const DRUMSTICK = ['....##', '...###', '..####', '.####.', '##.#..', '#.....'];
const WATERDROP = ['..#..', '..#..', '.###.', '#####', '#####', '.###.'];
function renderNeedBar(y, value, icon, fill, hi, lo, iconCol) {
  const x = 6, bx = x + 11, w = 64, h = 6;
  const low = value < 20, blink = low && Math.floor(frameTime / 350) % 2 === 0;
  bctx.fillStyle = '#000';
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]])
    icon.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '#') bctx.fillRect(x + c + ox + 1, y + r + oy, 1, 1); });
  icon.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '#') { bctx.fillStyle = blink ? lo : iconCol; bctx.fillRect(x + c + 1, y + r, 1, 1); } });
  bctx.fillStyle = '#000'; bctx.fillRect(bx - 1, y - 1, w + 2, h + 2);
  bctx.fillStyle = '#171a14'; bctx.fillRect(bx, y, w, h);
  const fw = Math.round(w * value / 100);
  if (fw > 0) {
    bctx.fillStyle = blink ? lo : fill; bctx.fillRect(bx, y, fw, h);
    bctx.fillStyle = hi; bctx.fillRect(bx, y + 1, fw, 1);
    bctx.fillStyle = lo; bctx.fillRect(bx, y + h - 1, fw, 1);
  }
  bctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let i = 1; i < 10; i++) bctx.fillRect(bx + Math.round(w * i / 10), y, 1, h);
}
function renderNeeds() {
  renderNeedBar(20, player.hunger, DRUMSTICK, '#c9873a', '#e8ad5e', '#7e4f1c', '#d99a52');
  renderNeedBar(31, player.thirst, WATERDROP, '#3d86c6', '#6db3ea', '#1f4e7c', '#5aa6e6');
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

// ---- Pixel font (3x5) for small UI text -------------------------------------------------------
const FONT = (() => {
  const g = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
    '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111',
    '9': '111101111001110', '%': '101001010100101', '/': '001001010100100', '.': '000000000000010', '-': '000000111000000',
    ' ': '000000000000000', '!': '010010010000010', ':': '000010000010000', "'": '010010000000000', '+': '000010111010000',
  };
  return g;
})();
function pixelText(g, text, x, y, color, s = 1) {
  g.fillStyle = color;
  let cx = x;
  for (const ch of String(text).toUpperCase()) {
    const glyph = FONT[ch] || FONT[' '];
    for (let i = 0; i < 15; i++) if (glyph[i] === '1') g.fillRect(cx + (i % 3) * s, y + Math.floor(i / 3) * s, s, s);
    cx += 4 * s;
  }
}
const textWidth = (t, s = 1) => String(t).length * 4 * s - s;

// ---- Inventory --------------------------------------------------------------------------------
// The panel art is the mockup itself; the storage row is repeated for each extra row of slots
// a backpack adds. Slot rectangles below are in the mockup's pixel coordinates.
const INV_W = 320, INV_BASE_H = 320, INV_ROW_H = 36, INV_ROW_SRC = 270, INV_SPLIT = 306;
const INV_COLS = 6, INV_BASE_SLOTS = 6;
const STORAGE_X = [16, 65, 114, 163, 212, 261], STORAGE_Y = 274, SLOT_W = 43, SLOT_H = 32;
const EQUIP_SLOTS = {
  helmet:    { x: 151, y: 70,  w: 153, h: 25, accepts: 'helmet' },
  clothes:   { x: 151, y: 100, w: 153, h: 25, accepts: 'clothes' },
  pants:     { x: 151, y: 130, w: 153, h: 25, accepts: 'pants' },
  shoes:     { x: 151, y: 160, w: 153, h: 25, accepts: 'shoes' },
  primary:   { x: 16,  y: 211, w: 94,  h: 42, accepts: 'weapon', inner: [17, 230, 92, 22] },
  secondary: { x: 113, y: 211, w: 94,  h: 42, accepts: 'weapon', inner: [114, 230, 92, 22] },
  backpack:  { x: 210, y: 211, w: 94,  h: 42, accepts: 'backpack', inner: [211, 230, 92, 22] },
};
const BODY_BOX = { x: 20, y: 68, w: 117, h: 117 };
const UI_BG = '#151d1e', UI_DARK = '#10181a', UI_TEXT = '#dde4d5', UI_DIM = '#82918a', UI_ACCENT = '#a8bf96', UI_GOLD = '#baab83';

// Backpack sizes: storage slots each one adds when equipped.
const BACKPACKS = {
  small:  { name: 'Small backpack',  slots: 3 },
  medium: { name: 'Medium backpack', slots: 6 },
  large:  { name: 'Large backpack',  slots: 12 },
};
function makeBackpack(size) { const b = BACKPACKS[size]; return { name: b.name, cat: 'backpack', size, slots: b.slots }; }
function newInventory() {
  return { equip: { helmet: null, clothes: null, pants: null, shoes: null, primary: null, secondary: null, backpack: null },
           storage: new Array(INV_BASE_SLOTS).fill(null) };
}
let inv = newInventory();
let invOpen = false;
const invCanvas = document.getElementById('inventory');
const ictx = invCanvas.getContext('2d');
let invScale = 2, invHover = null, invDrag = null, invMsg = null;

function extraSlots(equip) {
  const pk = equip.clothes && (ITEMS[equip.clothes.key] || equip.clothes).pockets || 0;
  return (equip.backpack ? (equip.backpack.slots || 0) : 0) + pk;
}
function storageSize() { return INV_BASE_SLOTS + extraSlots(inv.equip); }
function invRows() { return Math.ceil(storageSize() / INV_COLS); }
function invHeight() { return INV_BASE_H + (invRows() - 1) * INV_ROW_H; }
function fitStorage() {
  const n = storageSize();
  while (inv.storage.length < n) inv.storage.push(null);
}
function slotRect(ref) {
  if (ref.kind === 'equip') return EQUIP_SLOTS[ref.id];
  const r = Math.floor(ref.i / INV_COLS), c = ref.i % INV_COLS;
  return { x: STORAGE_X[c], y: STORAGE_Y + r * INV_ROW_H, w: SLOT_W, h: SLOT_H };
}
function getItem(ref) { return ref.kind === 'equip' ? inv.equip[ref.id] : ref.kind === 'cont' ? (container ? container.items[ref.i] : null) : inv.storage[ref.i]; }
function setItem(ref, item) { if (ref.kind === 'equip') inv.equip[ref.id] = item; else if (ref.kind === 'cont') { if (container) container.items[ref.i] = item; } else inv.storage[ref.i] = item; }
function accepts(ref, item) {
  if (!item) return true;
  if (ref.kind === 'cont') return !!container && ref.i < container.items.length && item.cat !== undefined;
  if (ref.kind === 'storage') {
    if (ref.i >= storageSize()) return false;
    return true;
  }
  return EQUIP_SLOTS[ref.id].accepts === item.cat;
}
function slotAt(px, py) {
  for (const id in EQUIP_SLOTS) { const r = EQUIP_SLOTS[id]; if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return { kind: 'equip', id }; }
  for (let i = 0; i < storageSize(); i++) { const r = slotRect({ kind: 'storage', i }); if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return { kind: 'storage', i }; }
  return null;
}
function bodyPartAt(px, py) {
  if (!IMG.bodyLabels || px < 0 || py < 0 || px >= INV_W || py >= INV_BASE_H) return null;
  const id = bodyLabelData[py * INV_W + px];
  return id ? BODY_PARTS[id - 1] : null;
}
// Moving an item: swap with whatever is in the target, if both fit.
function moveItem(from, to) {
  if (from.kind === to.kind && from.id === to.id && from.i === to.i) return;
  const a = getItem(from), b = getItem(to);
  if (!accepts(to, a) || !accepts(from, b)) { flashMsg("That doesn't go there"); return; }
  // Backpacks and pocketed clothes can only come off when the slots they add are empty.
  if (from.kind === 'equip' || to.kind === 'equip') {
    const after = { ...inv.equip };
    if (from.kind === 'equip') after[from.id] = b;
    if (to.kind === 'equip') after[to.id] = a;
    const curN = storageSize(), nextN = INV_BASE_SLOTS + extraSlots(after);
    const target = to.kind === 'storage' ? to.i : from.kind === 'storage' ? from.i : -1;
    if (target >= nextN) { flashMsg('Empty those slots first'); return; }
    for (let i = nextN; i < curN; i++) if (inv.storage[i] && i !== target) { flashMsg('Empty those slots first'); return; }
  }
  setItem(from, b); setItem(to, a);
  fitStorage();
}
function flashMsg(t) { invMsg = { t, until: performance.now() + 1600 }; }
// Adds an item to the first free storage slot. Returns false if full.
function giveItem(item) {
  fitStorage();
  for (let i = 0; i < storageSize(); i++) if (!inv.storage[i]) { inv.storage[i] = item; return true; }
  return false;
}

let bodyLabelData = null, bodyBase = null;
function prepareInventoryArt() {
  const c = document.createElement('canvas'); c.width = INV_W; c.height = INV_BASE_H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(IMG.bodyLabels, 0, 0);
  const d = g.getImageData(0, 0, INV_W, INV_BASE_H).data;
  bodyLabelData = new Uint8Array(INV_W * INV_BASE_H);
  for (let i = 0; i < bodyLabelData.length; i++) bodyLabelData[i] = d[i * 4 + 3] ? d[i * 4] : 0;
  g.clearRect(0, 0, INV_W, INV_BASE_H); g.drawImage(IMG.invPanel, 0, 0);
  bodyBase = g.getImageData(BODY_BOX.x, BODY_BOX.y, BODY_BOX.w, BODY_BOX.h);
}
// Colours each body part from its normal green toward red as it gets hurt.
function drawBody(g, now) {
  const im = new ImageData(new Uint8ClampedArray(bodyBase.data), BODY_BOX.w, BODY_BOX.h);
  const d = im.data;
  const blink = player.lastHit && now - player.lastHitT < 700 && Math.floor((now - player.lastHitT) / 100) % 2 === 0;
  for (let y = 0; y < BODY_BOX.h; y++) for (let x = 0; x < BODY_BOX.w; x++) {
    const id = bodyLabelData[(y + BODY_BOX.y) * INV_W + x + BODY_BOX.x]; if (!id) continue;
    const part = BODY_PARTS[id - 1], t = 1 - player.parts[part.id] / 100;
    const k = (y * BODY_BOX.w + x) * 4;
    const isLine = d[k + 1] > 150;
    let tr, tg, tb;
    if (isLine) { tr = 236; tg = 98; tb = 78; } else if (d[k] > 40) { tr = 158; tg = 36; tb = 30; } else { tr = 118; tg = 24; tb = 22; }
    d[k] = d[k] + (tr - d[k]) * t; d[k + 1] = d[k + 1] + (tg - d[k + 1]) * t; d[k + 2] = d[k + 2] + (tb - d[k + 2]) * t;
    const hover = invHover && invHover.part === part;
    const bl = bleedLevel(part.id);
    if (bl && isLine && Math.floor(now / [0, 900, 550, 300][bl]) % 2 === 0) { d[k] = 255; d[k + 1] = 60; d[k + 2] = 45; }
    if ((blink && part.id === player.lastHit) || hover) {
      if (isLine) { d[k] = 255; d[k + 1] = 255; d[k + 2] = 230; }
      else { d[k] = Math.min(255, d[k] + 30); d[k + 1] = Math.min(255, d[k + 1] + 30); d[k + 2] = Math.min(255, d[k + 2] + 30); }
    }
  }
  // putImageData ignores transforms, so go through a small canvas.
  if (!drawBody.c) { drawBody.c = document.createElement('canvas'); drawBody.c.width = BODY_BOX.w; drawBody.c.height = BODY_BOX.h; }
  drawBody.c.getContext('2d').putImageData(im, 0, 0);
  g.drawImage(drawBody.c, BODY_BOX.x, BODY_BOX.y);
}
const CAT_ABBR = { helmet: 'HLM', clothes: 'TOP', pants: 'PNT', shoes: 'SHO', weapon: 'WPN', backpack: 'BAG', misc: 'ITM' };
function drawItemIcon(g, item, cx, cy, maxW, maxH) {
  const img = iconFor(item.key) || (item.icon && IMG[item.icon]);
  if (img) {
    // Icons keep their pixel size; only something too big for the slot is shrunk to fit.
    const s = Math.min(1, maxW / img.width, maxH / img.height);
    const w = Math.round(img.width * s), h = Math.round(img.height * s);
    g.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
  } else {
    // Placeholder until the item has art.
    g.fillStyle = '#2c3a37'; g.fillRect(cx - 13, cy - 8, 26, 16);
    g.fillStyle = UI_ACCENT; g.fillRect(cx - 13, cy - 8, 26, 1); g.fillRect(cx - 13, cy + 7, 26, 1);
    const ab = item.abbr || CAT_ABBR[item.cat] || 'ITM';
    pixelText(g, ab, cx - Math.floor(textWidth(ab) / 2), cy - 2, UI_TEXT);
  }
}
function drawSlotItem(g, ref, item) {
  const r = slotRect(ref);
  if (ref.kind === 'equip' && EQUIP_SLOTS[ref.id].inner) {
    const [x, y, w, h] = EQUIP_SLOTS[ref.id].inner;
    g.fillStyle = UI_DARK; g.fillRect(x, y, w, h);
    drawItemIcon(g, item, x + w / 2, y + h / 2, w - 4, h - 4);
  } else if (ref.kind === 'equip') {
    // Clothing row: icon box on the left, item name in place of the slot label.
    g.fillStyle = '#202b2a'; g.fillRect(r.x + 1, r.y + 1, 34, r.h - 2);
    drawItemIcon(g, item, r.x + 18, r.y + r.h / 2, 32, r.h - 4);
    g.fillStyle = UI_DARK; g.fillRect(r.x + 37, r.y + 1, r.w - 39, r.h - 2);
    pixelText(g, item.name.slice(0, 22), r.x + 43, r.y + 10, UI_TEXT);
    g.fillStyle = UI_ACCENT; g.fillRect(r.x + r.w - 11, r.y + 11, 3, 3);
  } else {
    g.fillStyle = UI_DARK; g.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    drawItemIcon(g, item, r.x + r.w / 2, r.y + r.h / 2, r.w - 6, r.h - 6);
  }
}
// A searched container opens as a panel to the left of the inventory.
const CPW = 118;
function invOX() { return container ? CPW : 0; }
function contSlotRect(i) { return { x: 14 + (i % 2) * 47, y: 34 + Math.floor(i / 2) * 36, w: SLOT_W, h: SLOT_H }; }
function contSlotAt(x, y) {
  if (!container || x >= CPW) return null;
  for (let i = 0; i < container.items.length; i++) { const r = contSlotRect(i); if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return { kind: 'cont', i }; }
  return null;
}
function renderContainerPanel(g, H) {
  const w = CPW - 6;
  g.fillStyle = '#000'; g.fillRect(0, 0, w, H);
  g.fillStyle = '#536058'; g.fillRect(2, 2, w - 4, H - 4);
  g.fillStyle = '#35423d'; g.fillRect(3, 3, w - 6, H - 6);
  g.fillStyle = UI_BG; g.fillRect(5, 5, w - 10, H - 10);
  g.fillStyle = '#1a2323'; g.fillRect(5, 5, w - 10, 20);
  g.fillStyle = UI_ACCENT; g.fillRect(9, 11, 2, 9);
  pixelText(g, container.name, 14, 13, UI_TEXT);
  container.items.forEach((it, i) => {
    const r = contSlotRect(i);
    g.drawImage(IMG.invPanel, 16, 274, SLOT_W, SLOT_H, r.x, r.y, SLOT_W, SLOT_H);
    if (it && !(invDrag && invDrag.from.kind === 'cont' && invDrag.from.i === i)) {
      g.fillStyle = UI_DARK; g.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      drawItemIcon(g, it, r.x + r.w / 2, r.y + r.h / 2, r.w - 6, r.h - 6);
    }
  });
  if (container.items.every(x => !x)) pixelText(g, 'EMPTY', Math.round(w / 2 - textWidth('EMPTY') / 2), 34 + Math.ceil(container.items.length / 2) * 36 + 4, UI_DIM);
  pixelText(g, 'RIGHT-CLICK: USE', 9, H - 14, UI_DIM);
}
function itemLabel(it) {
  const def = ITEMS[it.key] || it;
  if (def.protect) {
    const pr = def.protect, parts = [];
    if (pr.head) parts.push(`head +${Math.round(pr.head * 100)}%`);
    if (pr.rArm) parts.push(`arms +${Math.round(pr.rArm * 100)}%`);
    if (pr.torso) parts.push(`torso +${Math.round(pr.torso * 100)}%`);
    return `${def.name} - ${parts.join(' ')}`;
  }
  if (def.cat === 'backpack') return `${def.name} - +${def.slots} slots`;
  if (def.weapon && WEAPONS[def.weapon]) return def.name;
  return def.name;
}
function renderInventory(now) {
  const H = invHeight(), rows = invRows(), OX = invOX();
  if (invCanvas.width !== INV_W + OX || invCanvas.height !== H) { invCanvas.width = INV_W + OX; invCanvas.height = H; layoutInventory(); }
  const g = ictx; g.imageSmoothingEnabled = false;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, invCanvas.width, H);
  if (container) renderContainerPanel(g, H);
  g.setTransform(1, 0, 0, 1, OX, 0);
  g.drawImage(IMG.invPanel, 0, 0, INV_W, INV_SPLIT, 0, 0, INV_W, INV_SPLIT);
  for (let r = 1; r < rows; r++) g.drawImage(IMG.invPanel, 0, INV_ROW_SRC, INV_W, INV_ROW_H, 0, INV_SPLIT + (r - 1) * INV_ROW_H, INV_W, INV_ROW_H);
  g.drawImage(IMG.invPanel, 0, INV_SPLIT, INV_W, INV_BASE_H - INV_SPLIT, 0, INV_SPLIT + (rows - 1) * INV_ROW_H, INV_W, INV_BASE_H - INV_SPLIT);
  // Slots past the storage size in the last row are hidden.
  for (let i = storageSize(); i < rows * INV_COLS; i++) { const r = slotRect({ kind: 'storage', i }); g.fillStyle = UI_BG; g.fillRect(r.x, r.y, r.w, r.h); }

  drawBody(g, now);

  // Storage counter (replaces the "0 / 6" in the art).
  const used = inv.storage.slice(0, storageSize()).filter(Boolean).length;
  g.fillStyle = UI_BG; g.fillRect(266, 260, 40, 9);
  const ct = `${used} / ${storageSize()}`;
  pixelText(g, ct, 304 - textWidth(ct), 262, '#82918a');

  for (const id in EQUIP_SLOTS) { const it = inv.equip[id]; if (it && !(invDrag && invDrag.from.kind === 'equip' && invDrag.from.id === id)) drawSlotItem(g, { kind: 'equip', id }, it); }
  for (let i = 0; i < storageSize(); i++) { const it = inv.storage[i]; if (it && !(invDrag && invDrag.from.kind === 'storage' && invDrag.from.i === i)) drawSlotItem(g, { kind: 'storage', i }, it); }

  // Hover highlight for slots (green if the dragged item fits, red if not).
  if (invHover && invHover.slot) {
    const r = invHover.slot.kind === 'cont' ? (c => ({ ...c, x: c.x - OX }))(contSlotRect(invHover.slot.i)) : slotRect(invHover.slot);
    const ok = !invDrag || (accepts(invHover.slot, invDrag.item) && accepts(invDrag.from, getItem(invHover.slot)));
    g.strokeStyle = invDrag ? (ok ? '#a8d68f' : '#d0574a') : '#6f8378'; g.lineWidth = 1;
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }
  // Body part readout at the bottom of the body panel.
  const part = invHover && invHover.part;
  const show = part || (player.lastHit && now - player.lastHitT < 2500 ? BODY_PARTS.find(b => b.id === player.lastHit) : null);
  g.fillStyle = UI_DARK; g.fillRect(BODY_BOX.x + 10, 177, 97, 7);
  if (show) {
    const v = Math.ceil(player.parts[show.id]), bl = bleedLevel(show.id);
    const alt = bl && Math.floor(now / 1100) % 2 === 1;
    const t = alt ? BLEED_LEVELS[bl].name : `${show.name} ${v}%`;
    pixelText(g, t, BODY_BOX.x + 58 - Math.floor(textWidth(t) / 2), 178, alt ? '#ff5a45' : v > 60 ? UI_ACCENT : v > 30 ? '#e0b45a' : '#e8644f');
  }
  // Hovered item name, or a message.
  let tip = invMsg && now < invMsg.until ? invMsg.t : invDrag && invDrag.item.use === 'medical' ? 'Drop on a body part to treat it'
    : (invHover && invHover.slot && !invDrag && getItem(invHover.slot) ? itemLabel(getItem(invHover.slot)) : null);
  if (tip) {
    const w = textWidth(tip) + 8;
    g.fillStyle = '#0c1213'; g.fillRect(Math.round(INV_W / 2 - w / 2), H - 12, w, 9);
    pixelText(g, tip, Math.round(INV_W / 2 - w / 2) + 4, H - 10, invMsg && now < invMsg.until ? '#e0b45a' : UI_TEXT);
  }
  // The item being dragged follows the cursor.
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (invDrag && invDrag.px != null) drawItemIcon(g, invDrag.item, invDrag.px, invDrag.py, 40, 28);
}
function layoutInventory() {
  const H = invHeight(), Wt = INV_W + invOX();
  // Whole-number scaling keeps pixels crisp; below 2x allow quarter steps so it never gets tiny.
  const fit = Math.min(window.innerWidth * 0.94 / Wt, window.innerHeight * 0.94 / H);
  invScale = fit >= 2 ? Math.floor(fit) : Math.max(1, Math.floor(fit * 4) / 4);
  invCanvas.style.width = Wt * invScale + 'px';
  invCanvas.style.height = H * invScale + 'px';
}
window.addEventListener('resize', layoutInventory);
function invPoint(e) {
  const r = invCanvas.getBoundingClientRect();
  return [Math.floor((e.clientX - r.left) / invScale), Math.floor((e.clientY - r.top) / invScale)];
}
function anySlotAt(x, y) { return contSlotAt(x, y) || slotAt(x - invOX(), y); }
invCanvas.addEventListener('mousemove', e => {
  const [x, y] = invPoint(e);
  invHover = { slot: anySlotAt(x, y), part: bodyPartAt(x - invOX(), y) };
  if (invDrag) { invDrag.px = x; invDrag.py = y; }
});
invCanvas.addEventListener('mouseleave', () => { invHover = null; });
invCanvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const [x, y] = invPoint(e), ref = anySlotAt(x, y);
  if (ref && getItem(ref)) invDrag = { from: ref, item: getItem(ref), px: x, py: y };
});
window.addEventListener('mouseup', e => {
  if (!invDrag) return;
  const [x, y] = invPoint(e), to = anySlotAt(x, y);
  const part = bodyPartAt(x - invOX(), y);
  if (part && invDrag.item.use === 'medical') { useItem(invDrag.from, part); }   // drop a medical item on a body part to treat it
  else if (to) moveItem(invDrag.from, to);
  invDrag = null;
});
invCanvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const [x, y] = invPoint(e), ref = anySlotAt(x, y);
  if (ref) useItem(ref);
});
function openInventory() {
  invOpen = true; invHover = null; invDrag = null;
  fitStorage(); layoutInventory();
  invCanvas.classList.remove('hidden'); canvas.classList.add('blurred');
}
function closeInventory() {
  invOpen = false; invDrag = null; container = null;
  invCanvas.classList.add('hidden'); canvas.classList.remove('blurred');
}

// ---- Items and loot ----------------------------------------------------------------------------
// abbr is shown on the placeholder icon until the item has art.
const ITEMS = {
  // Medical, weakest to strongest. heal = health % restored to the treated part.
  rag:        { name: 'Cloth rag', cat: 'misc', abbr: 'RAG', use: 'medical', heal: 8, bleed: 'slow' },
  bandage:    { name: 'Bandage', cat: 'misc', abbr: 'BND', use: 'medical', heal: 20, bleed: 'stop' },
  firstaid:   { name: 'First aid kit', cat: 'misc', abbr: 'AID', use: 'medical', heal: 100, bleed: 'stop' },
  antiseptic: { name: 'Antiseptic', cat: 'misc', abbr: 'ANT', use: 'antiseptic' },
  // Food and drink: how much hunger / thirst each restores (negative = makes it worse).
  beans:    { name: 'Canned beans', cat: 'misc', abbr: 'CAN', use: 'eat', food: 32, drink: 2 },
  soup:     { name: 'Canned soup', cat: 'misc', abbr: 'SUP', use: 'eat', food: 24, drink: 10 },
  bread:    { name: 'Bread', cat: 'misc', abbr: 'BRD', use: 'eat', food: 22, drink: -2 },
  chips:    { name: 'Chips', cat: 'misc', abbr: 'CHP', use: 'eat', food: 12, drink: -4 },
  water:    { name: 'Water bottle', cat: 'misc', abbr: 'H2O', use: 'eat', food: 0, drink: 38 },
  soda:     { name: 'Soda', cat: 'misc', abbr: 'POP', use: 'eat', food: 4, drink: 20 },
  juice:    { name: 'Juice carton', cat: 'misc', abbr: 'JUC', use: 'eat', food: 6, drink: 26 },
  knife:    { name: 'Kitchen knife', cat: 'weapon', abbr: 'KNF', weapon: 'knife' },
  hatchet:  { name: 'Hatchet', cat: 'weapon', abbr: 'HAT', weapon: 'hatchet' },
  axe:      { name: 'Axe', cat: 'weapon', abbr: 'AXE', weapon: 'axe' },
  pipe:     { name: 'Lead pipe', cat: 'weapon', abbr: 'PIP', weapon: 'pipe' },
  bat:      { name: 'Baseball bat', cat: 'weapon', abbr: 'BAT', weapon: 'bat' },
  crowbar:  { name: 'Crowbar', cat: 'weapon', abbr: 'CRW', weapon: 'crowbar' },
  pan:      { name: 'Frying pan', cat: 'weapon', abbr: 'PAN', weapon: 'pan' },
  rollingpin: { name: 'Rolling pin', cat: 'weapon', abbr: 'PIN', weapon: 'rollingpin' },
  // Headwear. wear = sprite drawn over the player; protect = share of damage to that body part stopped.
  beanie:         { name: 'Wool beanie', cat: 'helmet', abbr: 'HAT', wear: 'wearBeanie', protect: { head: 0.05 } },
  bikehelmet:     { name: 'Bike helmet', cat: 'helmet', abbr: 'BIK', wear: 'wearBike', protect: { head: 0.25 } },
  hardhat:        { name: 'Hard hat', cat: 'helmet', abbr: 'HRD', wear: 'wearHardhat', protect: { head: 0.35 } },
  militaryhelmet: { name: 'Military helmet', cat: 'helmet', abbr: 'MIL', wear: 'wearMilitary', protect: { head: 0.5 } },
  motohelmet:     { name: 'Motorcycle helmet', cat: 'helmet', abbr: 'MOT', wear: 'wearMoto', protect: { head: 0.6 } },
  // Tops. protect covers the torso and both arms; pockets add storage slots while worn.
  hoodie:        { name: 'Hoodie', cat: 'clothes', abbr: 'HOD', wear: 'wearHoodie', protect: { torso: 0.1, rArm: 0.1, lArm: 0.1 } },
  leatherjacket: { name: 'Leather jacket', cat: 'clothes', abbr: 'LTH', wear: 'wearLeather', protect: { torso: 0.3, rArm: 0.35, lArm: 0.35 } },
  wintercoat:    { name: 'Winter coat', cat: 'clothes', abbr: 'CT', wear: 'wearCoat', protect: { torso: 0.2, rArm: 0.2, lArm: 0.2 } },
  utilityvest:   { name: 'Utility vest', cat: 'clothes', abbr: 'VST', wear: 'wearVest', protect: { torso: 0.2 } },
  bagS:     { name: 'Small backpack', cat: 'backpack', abbr: 'BG3', slots: 3, wear: 'wearBagS' },
  bagM:     { name: 'Medium backpack', cat: 'backpack', abbr: 'BG6', slots: 6, wear: 'wearBagM' },
  bagL:     { name: 'Large backpack', cat: 'backpack', abbr: 'B12', slots: 12, wear: 'wearBagL' },
};
function makeItem(key) { return { key, ...ITEMS[key] }; }
// Each container rolls every line once: [item, chance]. Most finds are small.
const CONTAINERS = {
  fridge:  { name: 'Fridge', slots: 4, loot: [['water', 0.3], ['soda', 0.3], ['juice', 0.2], ['bread', 0.15]] },
  counter: { name: 'Kitchen counter', slots: 6, loot: [['beans', 0.35], ['soup', 0.25], ['chips', 0.2], ['bread', 0.12], ['knife', 0.18], ['pan', 0.1], ['rollingpin', 0.08], ['rag', 0.1], ['bandage', 0.08], ['antiseptic', 0.05], ['water', 0.15]] },
  dresser: { name: 'Dresser', slots: 6, loot: [['bat', 0.05], ['hoodie', 0.15], ['wintercoat', 0.07], ['leatherjacket', 0.035], ['utilityvest', 0.04], ['beanie', 0.12], ['bikehelmet', 0.04], ['motohelmet', 0.012], ['bagS', 0.07], ['rag', 0.25], ['bandage', 0.08]] },
  // Camp crates: canned food, water and camping gear. Bigger crates hold more and better.
  crateS:  { name: 'Small crate', slots: 2, loot: [['beans', 0.35], ['water', 0.3], ['chips', 0.2], ['rag', 0.25], ['bandage', 0.1], ['knife', 0.08]] },
  crateM:  { name: 'Crate', slots: 4, loot: [['beans', 0.4], ['soup', 0.3], ['water', 0.4], ['rag', 0.25], ['bandage', 0.15], ['antiseptic', 0.06], ['knife', 0.1], ['hatchet', 0.1], ['beanie', 0.1], ['hoodie', 0.06], ['bagS', 0.05]] },
  crateL:  { name: 'Large crate', slots: 6, loot: [['beans', 0.45], ['soup', 0.35], ['water', 0.5], ['water', 0.25], ['bandage', 0.2], ['firstaid', 0.06], ['antiseptic', 0.08], ['hatchet', 0.14], ['axe', 0.06], ['wintercoat', 0.08], ['beanie', 0.1], ['utilityvest', 0.05], ['bagM', 0.06], ['bagL', 0.02]] },
  shelf:   { name: 'Shelves', slots: 4, loot: [['rag', 0.15], ['bandage', 0.18], ['firstaid', 0.04], ['antiseptic', 0.08], ['beans', 0.2], ['soup', 0.12], ['chips', 0.12], ['hatchet', 0.06], ['crowbar', 0.05], ['pipe', 0.05], ['axe', 0.025], ['utilityvest', 0.04], ['hardhat', 0.04], ['militaryhelmet', 0.008], ['bagM', 0.04], ['bagL', 0.015]] },
};
// Melee weapons. reach in px (fists are 30), arc = half-width of the swing in degrees,
// cooldown = seconds between swings, noise in tiles.
Object.assign(WEAPONS, {
  knife:      { name: 'Kitchen knife', reach: 32, arc: 40, damage: [18, 26], cooldown: 0.45, duration: 0.3,  hitAt: 0.15, knockback: 4,  stun: 0.25, noise: 3 },
  rollingpin: { name: 'Rolling pin',   reach: 33, arc: 55, damage: [12, 18], cooldown: 0.5,  duration: 0.34, hitAt: 0.17, knockback: 9,  stun: 0.45, noise: 4 },
  pan:        { name: 'Frying pan',    reach: 33, arc: 60, damage: [16, 22], cooldown: 0.6,  duration: 0.38, hitAt: 0.19, knockback: 11, stun: 0.55, noise: 6 },
  pipe:       { name: 'Lead pipe',     reach: 37, arc: 55, damage: [22, 30], cooldown: 0.65, duration: 0.4,  hitAt: 0.2,  knockback: 9,  stun: 0.45, noise: 5 },
  crowbar:    { name: 'Crowbar',       reach: 37, arc: 55, damage: [25, 33], cooldown: 0.65, duration: 0.4,  hitAt: 0.2,  knockback: 8,  stun: 0.4,  noise: 5 },
  bat:        { name: 'Baseball bat',  reach: 41, arc: 75, damage: [22, 30], cooldown: 0.7,  duration: 0.42, hitAt: 0.21, knockback: 15, stun: 0.55, noise: 5 },
  hatchet:    { name: 'Hatchet',       reach: 34, arc: 55, damage: [30, 42], cooldown: 0.75, duration: 0.42, hitAt: 0.22, knockback: 9,  stun: 0.45, noise: 4 },
  axe:        { name: 'Axe',           reach: 43, arc: 70, damage: [48, 62], cooldown: 1.1,  duration: 0.55, hitAt: 0.3,  knockback: 13, stun: 0.6,  noise: 6, heavy: true },
});
function containerType(f) { return f.crate ? f.name : FURN[f.name].container; }
function rollLoot(b, f) {
  const C = CONTAINERS[containerType(f)], items = new Array(C.slots).fill(null);
  const mult = b.cond === 'looted' ? 0.25 : b.cond === 'locked' ? 1.3 : 1;
  let n = 0;
  C.loot.forEach(([key, chance], k) => { if (n < C.slots && hash01(b.seed, f.i * 31 + k, 0x10a7) < chance * mult) items[n++] = makeItem(key); });
  return items;
}
let container = null;   // { b, f, name, items }
function openContainer(it) {
  const s = bState(it.b);
  container = { b: it.b, f: it.f, name: CONTAINERS[containerType(it.f)].name, items: s.c[it.f.i],
    px: (it.rect[0] + it.rect[2]) / 2, py: it.rect[3] };
  if (!invOpen) openInventory(); else layoutInventory();
}
function closeContainer() { container = null; if (invOpen) layoutInventory(); }
// Treats one body part. With no part given: the worst bleeding one, else the most hurt.
function treat(item, part) {
  const def = ITEMS[item.key] || item;
  if (!part) {
    let wl = 0;
    for (const p of BODY_PARTS) { const l = bleedLevel(p.id); if (l > wl) { wl = l; part = p; } }
    if (!part) part = BODY_PARTS.reduce((a, p) => player.parts[p.id] < player.parts[a.id] ? p : a, BODY_PARTS[0]);
  }
  if (player.parts[part.id] >= 100 && !bleedLevel(part.id)) { flashMsg(part.name + ' is fine'); return false; }
  const w = player.wounds[part.id] || (player.wounds[part.id] = { t: 0, clotted: false });
  if (def.bleed === 'stop') w.bandaged = true;
  else if (def.bleed === 'slow') w.slowed = true;
  player.parts[part.id] = Math.min(100, player.parts[part.id] + def.heal);
  flashMsg((item.key === 'firstaid' ? 'Treated ' : item.key === 'rag' ? 'Wrapped ' : 'Bandaged ') + part.name.toLowerCase());
  return true;
}
// Clothes can be torn into rags.
const TEARABLE = { hoodie: 2, beanie: 1, wintercoat: 3 };
function useItem(ref, part) {
  const item = getItem(ref); if (!item) return;
  if (item.use === 'medical') {
    if (treat(item, part)) setItem(ref, null);
  } else if (item.use === 'antiseptic') {
    flashMsg('Nothing to disinfect yet');
  } else if (TEARABLE[item.key] && ref.kind !== 'equip') {
    setItem(ref, makeItem('rag'));
    for (let i = 1; i < TEARABLE[item.key]; i++) if (!giveItem(makeItem('rag'))) break;
    flashMsg('Tore ' + item.name.toLowerCase() + ' into rags');
  } else if (item.use === 'eat') {
    const def = ITEMS[item.key] || item;
    player.hunger = Math.max(0, Math.min(100, player.hunger + (def.food || 0)));
    player.thirst = Math.max(0, Math.min(100, player.thirst + (def.drink || 0)));
    setItem(ref, null);
    flashMsg((def.food >= def.drink ? 'Ate ' : 'Drank ') + def.name.toLowerCase());
  } else flashMsg("Can't use that");
}

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
  player = null; zombies = []; hordes = new Map();
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

function e_pressedRecently() { return false; }
function resume() { state = 'play'; ui.pause.classList.add('hidden'); }
function onKeyPress(k) {
  if (state === 'play' && k === 'c') toggleCrouch();
  if (state === 'play' && k === ' ' && !invOpen) startJump();
  if (state === 'play' && invOpen) {
    if (k === 'i' || k === 'escape' || k === 'tab') closeInventory();
    else if (k === 'm') { closeInventory(); openMap(); }
  } else if (state === 'play') {
    if (k === 'escape') { state = 'pause'; ui.pause.classList.remove('hidden'); keys.clear(); }
    else if (k === 'i' || k === 'tab') openInventory();
    else if (k === 'x') { const e = inv.equip; [e.primary, e.secondary] = [e.secondary, e.primary]; toast(e.primary ? e.primary.name : 'Fists'); }
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
  blood = []; bloodT = 0; corpses = [];
  revealAround(player.x, player.y);
}
function newGame(n) {
  slot = n;
  const seed = (Math.random() * 2 ** 32) >>> 0;
  world = new WorldGen(seed); resetCaches();
  explored = new Map(); markers = []; playTime = 0; created = Date.now();
  const sp = findSpawn(Math.random);
  player = newPlayer(sp.x, sp.y);
  zombies = []; hordes = new Map(); zSpawnT = 8; inv = newInventory(); bstate.clear(); container = null; searching = null;
  animals = []; aSpawnT = 4;
  startPlaying();
  saveGame();
}
// Items that were taken out of the game vanish from old saves (inventory and searched containers).
function dropRemovedItems() {
  const ok = it => it && (!it.key || ITEMS[it.key]) ? it : null;
  for (const k in inv.equip) inv.equip[k] = ok(inv.equip[k]);
  inv.storage = inv.storage.map(ok);
  for (const s of bstate.values()) for (const i in s.c) s.c[i] = s.c[i].map(ok);
}
function loadGame(n) {
  const s = readSlot(n); if (!s) { renderSlots(); return; }
  slot = n;
  world = new WorldGen(s.seed); resetCaches();
  player = newPlayer(s.player.x, s.player.y); player.dir = s.player.dir || 'S';
  explored = new Map(Object.entries(s.explored || {}).map(([k, v]) => [k, unpackBits(v)]));
  markers = s.markers || []; playTime = s.playTime || 0; created = s.created || Date.now();
  if (s.player.parts) for (const b of BODY_PARTS) player.parts[b.id] = s.player.parts[b.id] ?? 100;
  else player.hp = s.player.hp ?? MAX_HP;
  player.wounds = s.player.wounds || {};
  player.hunger = s.player.hunger ?? 80; player.thirst = s.player.thirst ?? 75;
  zombies = (s.zombies || []).filter(z => ZOMBIE_TYPES[z.t]).map(z => { const o = makeZombie(z.t, z.x, z.y); o.hp = z.hp; o.dir = z.dir || 'S';
    for (const k of ['look', 'top', 'bottom', 'horde', 'ox', 'oy', 'speedMul', 'home']) if (z[k] != null) o[k] = z[k];
    return o; });
  hordes = new Map(); nextHordeId = 1;
  for (const z of zombies) if (z.horde) {
    if (!hordes.has(z.horde)) hordes.set(z.horde, { id: z.horde, gx: z.x - z.ox, gy: z.y - z.oy, t: 4 });
    nextHordeId = Math.max(nextHordeId, z.horde + 1);
  }
  zSpawnT = 8;
  inv = newInventory();
  bstate.clear(); for (const [k, v] of Object.entries(s.bstate || {})) bstate.set(k, v);
  if (s.inv) { Object.assign(inv.equip, s.inv.equip || {}); inv.storage = s.inv.storage || inv.storage; fitStorage(); }
  dropRemovedItems();
  loadAnimals(s.animals);
  startPlaying();
}
function saveGame() {
  if (!player || !slot) return;
  const ex = {};
  for (const [k, v] of explored) ex[k] = packBits(v);
  store.set(slotKey(slot), JSON.stringify({
    v: 1, seed: world.seed, created, updated: Date.now(), playTime: Math.floor(playTime),
    player: { x: Math.round(player.x), y: Math.round(player.y), dir: player.dir, parts: player.parts, wounds: player.wounds, hunger: Math.round(player.hunger * 10) / 10, thirst: Math.round(player.thirst * 10) / 10 },
    zombies: zombies.filter(z => !z.dead).map(z => ({ t: z.type, look: z.look, top: z.top, bottom: z.bottom, horde: z.horde, home: z.home, speedMul: Math.round(z.speedMul * 100) / 100, ox: Math.round(z.ox), oy: Math.round(z.oy), x: Math.round(z.x), y: Math.round(z.y), hp: z.hp, dir: z.dir })),
    animals: saveAnimals(),
    inv, explored: ex, markers, bstate: Object.fromEntries(bstate),
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
      if (state === 'play') { updatePlayer(dt); updateAttack(dt); updateInteract(dt); updatePlayerNoise(dt); }
      updateCorpses(dt);
      checkResidents();
      updateBanging(dt);
      if (container && Math.hypot(player.x - container.px, player.y - container.py) > 72) closeContainer();
      playTime += dt;
      updateZombies(dt);
      updateAnimals(dt);
      if (state === 'play' || state === 'map') { updateBleeding(dt); updateNeeds(dt); }
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
      camWorldX = camX; camWorldY = camY;
      renderWorld(camX, camY, true);
      unloadFarChunks(camX, camY);
    }
  }

  ctx.drawImage(buf, 0, 0, BW * scale, BH * scale);
  if (state !== 'menu' && state !== 'map') renderHurtOverlay();
  // HUD goes on top of the red overlay so it stays readable.
  if (player && (state === 'play' || state === 'pause')) {
    bctx.clearRect(0, 0, BW, BH);
    renderMinimap(); renderHealthBar(); renderNeeds();
    ctx.drawImage(buf, 0, 0, BW * scale, BH * scale);
  }

  if (invOpen) {
    if (state === 'play') renderInventory(now); else closeInventory();
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
  prepareInventoryArt();
  prepareZombieMasks();
  prepareCursor();
  ui.loading.classList.add('hidden');
  showMenu();
  requestAnimationFrame(loop);
}).catch(err => { ui.loading.textContent = 'Could not load game art: ' + err; });

// Hooks for automated testing.
window.__SH = { get state() { return state; }, get player() { return player; }, get world() { return world; }, tileAt, newGame, saveGame, loadGame, killPlayer: c => startDying(c), hurtPlayer, zombies: () => zombies,
  giveItem, makeBackpack, makeItem: k => makeItem(k), useItem, updateNeeds, bleedLevel, get blood() { return blood; }, get inv() { return inv; }, openInventory, closeInventory, get invOpen() { return invOpen; },
  startAttack, mouse, makeNoise, NOISE, get nearby() { return nearby; }, get hoverIt() { return hoverIt; }, useInteractable, get searching() { return searching; }, get corpses() { return corpses; }, animals: () => animals, makeAnimal, spawnAnimals, killAnimal, spawnGroup, get hordes() { return hordes; }, setOpening, openingState, buildingAt,
  spawnZombie(dx, dy, type) { const z = makeZombie(type || 'walker', player.x + dx, player.y + dy); zombies.push(z); return z; }, openMap, closeMap, markers: () => markers, explored: () => explored, canvasCache, dataCache };
})();
