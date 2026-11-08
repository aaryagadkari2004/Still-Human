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
  const p = { x, y, dir: 'S', moving: false, running: false, anim: 0, parts: {}, wounds: {}, lastHit: null, lastHitT: 0 };
  for (const b of BODY_PARTS) p.parts[b.id] = 100;
  Object.defineProperty(p, 'hp', {
    get() { let m = 100; for (const k in this.parts) m = Math.min(m, this.parts[k]); return m; },
    set(v) { for (const k in this.parts) this.parts[k] = Math.max(0, Math.min(100, v)); },
  });
  return p;
}
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
  const part = fromX != null ? pickHitPart(fromX, fromY) : BODY_PARTS[1];
  const dmg = amount * part.mult * (0.8 + Math.random() * 0.4);
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
    looks: [{ img: 'zWalker' }, { img: 'zWalker2' }, { img: 'zWalker3' }, { img: 'zWalker4', onePiece: true }],
    speed: 46, wanderSpeed: 18, hp: 100,
    damage: 12, reach: 27, windup: 0.45, cooldown: 1.4,
    sight: 8 * TILE, notice: 3 * TILE, forget: 5, animRate: 5,
  },
};
const Z_CAP = 36;             // most zombies around the player at once
const Z_DESPAWN = 46 * TILE;  // zombies further than this are removed

// Horde sizes: solo zombies are common, big hordes are rare.
const HORDES = [
  { weight: 55, min: 1,  max: 1 },   // lone zombie
  { weight: 28, min: 2,  max: 4 },   // small group
  { weight: 12, min: 5,  max: 8 },   // horde
  { weight: 5,  min: 10, max: 15 },  // large horde
];

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
    const g = c.getContext('2d');
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
    horde: 0, ox: 0, oy: 0 };
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
    for (const o of zombies) {
      if (o === z || Math.abs(nx - o.x) > 14 || Math.abs(ny - o.y) > 14) continue;
      if (Math.hypot(nx - o.x, ny - o.y) < 13 && Math.hypot(z.x - o.x, z.y - o.y) >= 13) return false;
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
    if (o === z || o.mode === 'chase' || o.mode === 'attack') continue;
    const sameHorde = z.horde && o.horde === z.horde;
    if (sameHorde || Math.hypot(o.x - z.x, o.y - z.y) < 5 * TILE) {
      o.mode = 'chase'; o.lostT = 0; o.gx = player.x; o.gy = player.y;
    }
  }
}
function updateZombie(z, dt) {
  const T = ZOMBIE_TYPES[z.type];
  const ddx = player.x - z.x, ddy = player.y - z.y, d = Math.hypot(ddx, ddy);
  const alive = player.hp > 0;
  const sees = alive && d < T.sight;
  z.cd = Math.max(0, z.cd - dt);

  if (z.mode === 'attack') {
    z.moving = false; faceToward(z, ddx, ddy);
    z.atk -= dt;
    if (z.atk <= 0) {
      if (alive && d <= T.reach + 8) hurtPlayer(T.damage, 'Killed by a zombie.', z.x, z.y);
      z.cd = T.cooldown; z.mode = 'chase';
    }
  } else if (sees) {
    if (z.mode !== 'chase') alertAround(z);
    z.mode = 'chase'; z.lostT = 0; z.gx = player.x; z.gy = player.y;
    if (d <= T.reach && z.cd <= 0) { z.mode = 'attack'; z.atk = T.windup; z.moving = false; }
    else if (d > T.reach - 4) moveZombie(z, ddx, ddy, T.speed, dt);
    else { z.moving = false; faceToward(z, ddx, ddy); }
  } else if (z.mode === 'chase') {
    // Lost sight (or was alerted): walk to where the player was last seen, then give up.
    z.lostT += dt;
    const gx = z.gx - z.x, gy = z.gy - z.y;
    if (Math.hypot(gx, gy) > 6 && z.lostT < T.forget + 4) moveZombie(z, gx, gy, T.speed, dt);
    else {
      z.mode = 'idle'; z.t = 2 + Math.random() * 3; z.moving = false;
      const h = hordes.get(z.horde); if (h) { h.gx = z.x; h.gy = z.y; } // the horde regroups here
    }
  } else if (z.horde && hordes.has(z.horde)) {
    // Horde members drift together toward the horde's goal, each keeping its own spot.
    const h = hordes.get(z.horde);
    const gx = h.gx + z.ox - z.x, gy = h.gy + z.oy - z.y, dist = Math.hypot(gx, gy);
    if (dist > 10) { moveZombie(z, gx, gy, T.wanderSpeed * (dist > 3 * TILE ? 1.6 : 1), dt); z.mode = 'wander'; }
    else { z.moving = false; z.mode = 'idle'; }
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
function canStand(x, y) {
  return tileAt(Math.floor(x / TILE), Math.floor(y / TILE)).t !== T_WATER && !feetBlocked(x, y) &&
    !zombies.some(o => Math.abs(o.x - x) < 14 && Math.abs(o.y - y) < 14);
}
function pickHordeSize() {
  let r = Math.random() * HORDES.reduce((a, h) => a + h.weight, 0);
  for (const h of HORDES) { r -= h.weight; if (r <= 0) return h.min + Math.floor(Math.random() * (h.max - h.min + 1)); }
  return 1;
}
// Spawns a lone zombie or a horde out of sight. Bigger hordes appear further away.
function spawnGroup(size) {
  const minR = size > 4 ? 22 : 16, maxR = size > 4 ? 32 : 28;
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, r = (minR + Math.random() * (maxR - minR)) * TILE;
    const cx = player.x + Math.cos(a) * r, cy = player.y + Math.sin(a) * r;
    if (Math.abs(cx - player.x) < BW / 2 + 64 && Math.abs(cy - player.y) < BH / 2 + 112) continue; // never pop in on screen
    if (!canStand(cx, cy)) continue;
    let hid = 0;
    if (size > 1) { hid = nextHordeId++; hordes.set(hid, { id: hid, gx: cx, gy: cy, t: 3 + Math.random() * 6 }); }
    const spread = 14 + Math.sqrt(size) * 14;
    let made = 0;
    for (let k = 0; k < size * 6 && made < size; k++) {
      const oa = Math.random() * Math.PI * 2, orr = made === 0 ? 0 : Math.sqrt(Math.random()) * spread;
      const x = cx + Math.cos(oa) * orr, y = cy + Math.sin(oa) * orr;
      if (!canStand(x, y)) continue;
      const z = makeZombie('walker', x, y);
      if (hid) { z.horde = hid; z.ox = x - cx; z.oy = y - cy; z.dir = 'NSEW'[(hid * 7) % 4]; }
      zombies.push(z); made++;
    }
    return made;
  }
  return 0;
}
function updateHordes(dt) {
  for (const h of hordes.values()) {
    h.t -= dt;
    if (h.t <= 0) {
      // Pick a new spot to shamble toward.
      const a = Math.random() * Math.PI * 2, r = (3 + Math.random() * 7) * TILE;
      h.gx += Math.cos(a) * r; h.gy += Math.sin(a) * r; h.t = 8 + Math.random() * 10;
    }
  }
}
function updateZombies(dt) {
  zombies = zombies.filter(z => Math.hypot(z.x - player.x, z.y - player.y) < Z_DESPAWN);
  const alive = new Set(zombies.map(z => z.horde));
  for (const id of hordes.keys()) if (!alive.has(id)) hordes.delete(id);
  zSpawnT -= dt;
  if (zSpawnT <= 0) {
    zSpawnT = 8 + Math.random() * 10;
    const size = pickHordeSize();
    if (zombies.length + size <= Z_CAP) spawnGroup(size);
  }
  updateHordes(dt);
  for (const z of zombies) updateZombie(z, dt);
}


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
    player.parts[b.id] = Math.max(0, player.parts[b.id] - L.rate * dt);
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
  if (withPlayer) renderBlood(camX, camY, frameTime);
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
      bctx.drawImage(zombieSheet(o.z), fx * PF, fy * PF, PF, PF, Math.round(o.x - P_AX + lx), Math.round(o.y - P_AY + ly), PF, PF);
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
    ' ': '000000000000000', '!': '010010010000010', "'": '010010000000000', '+': '000010111010000',
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

function storageSize() { return INV_BASE_SLOTS + (inv.equip.backpack ? (inv.equip.backpack.slots || 0) : 0); }
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
function getItem(ref) { return ref.kind === 'equip' ? inv.equip[ref.id] : inv.storage[ref.i]; }
function setItem(ref, item) { if (ref.kind === 'equip') inv.equip[ref.id] = item; else inv.storage[ref.i] = item; }
function accepts(ref, item) {
  if (!item) return true;
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
  // A backpack can only come off when the slots it adds are empty.
  for (const [ref, item] of [[from, b], [to, a]]) {
    if (ref.kind === 'equip' && ref.id === 'backpack') {
      const cur = inv.equip.backpack, next = item;
      const curN = INV_BASE_SLOTS + (cur ? cur.slots || 0 : 0), nextN = INV_BASE_SLOTS + (next ? next.slots || 0 : 0);
      const target = to.kind === 'storage' ? to.i : from.kind === 'storage' ? from.i : -1;
      for (let i = nextN; i < curN; i++) if (inv.storage[i] && i !== target) { flashMsg('Empty the backpack first'); return; }
      if (target >= nextN) { flashMsg('Empty the backpack first'); return; }
    }
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
  const g = c.getContext('2d'); g.drawImage(IMG.bodyLabels, 0, 0);
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
  g.putImageData(im, BODY_BOX.x, BODY_BOX.y);
}
const CAT_ABBR = { helmet: 'HLM', clothes: 'TOP', pants: 'PNT', shoes: 'SHO', weapon: 'WPN', backpack: 'BAG', misc: 'ITM' };
function drawItemIcon(g, item, cx, cy, maxW, maxH) {
  const img = item.icon && IMG[item.icon];
  if (img) {
    const s = Math.max(1, Math.floor(Math.min(maxW / img.width, maxH / img.height)));
    g.drawImage(img, Math.round(cx - img.width * s / 2), Math.round(cy - img.height * s / 2), img.width * s, img.height * s);
  } else {
    // Placeholder until the item has art.
    g.fillStyle = '#2c3a37'; g.fillRect(cx - 13, cy - 8, 26, 16);
    g.fillStyle = UI_ACCENT; g.fillRect(cx - 13, cy - 8, 26, 1); g.fillRect(cx - 13, cy + 7, 26, 1);
    const ab = CAT_ABBR[item.cat] || 'ITM';
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
function renderInventory(now) {
  const H = invHeight(), rows = invRows();
  if (invCanvas.width !== INV_W || invCanvas.height !== H) { invCanvas.width = INV_W; invCanvas.height = H; layoutInventory(); }
  const g = ictx; g.imageSmoothingEnabled = false;
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
    const r = slotRect(invHover.slot);
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
  let tip = invMsg && now < invMsg.until ? invMsg.t : (invHover && invHover.slot && !invDrag && getItem(invHover.slot) ? getItem(invHover.slot).name : null);
  if (tip) {
    const w = textWidth(tip) + 8;
    g.fillStyle = '#0c1213'; g.fillRect(Math.round(INV_W / 2 - w / 2), H - 12, w, 9);
    pixelText(g, tip, Math.round(INV_W / 2 - w / 2) + 4, H - 10, invMsg && now < invMsg.until ? '#e0b45a' : UI_TEXT);
  }
  // The item being dragged follows the cursor.
  if (invDrag && invDrag.px != null) drawItemIcon(g, invDrag.item, invDrag.px, invDrag.py, 40, 28);
}
function layoutInventory() {
  const H = invHeight();
  invScale = Math.max(1, Math.floor(Math.min(window.innerWidth * 0.94 / INV_W, window.innerHeight * 0.94 / H)));
  invCanvas.style.width = INV_W * invScale + 'px';
  invCanvas.style.height = H * invScale + 'px';
}
window.addEventListener('resize', layoutInventory);
function invPoint(e) {
  const r = invCanvas.getBoundingClientRect();
  return [Math.floor((e.clientX - r.left) / invScale), Math.floor((e.clientY - r.top) / invScale)];
}
invCanvas.addEventListener('mousemove', e => {
  const [x, y] = invPoint(e);
  invHover = { slot: slotAt(x, y), part: bodyPartAt(x, y) };
  if (invDrag) { invDrag.px = x; invDrag.py = y; }
});
invCanvas.addEventListener('mouseleave', () => { invHover = null; });
invCanvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const [x, y] = invPoint(e), ref = slotAt(x, y);
  if (ref && getItem(ref)) invDrag = { from: ref, item: getItem(ref), px: x, py: y };
});
window.addEventListener('mouseup', e => {
  if (!invDrag) return;
  const [x, y] = invPoint(e), to = slotAt(x, y);
  if (to) moveItem(invDrag.from, to);
  invDrag = null;
});
invCanvas.addEventListener('contextmenu', e => e.preventDefault());
function openInventory() {
  invOpen = true; invHover = null; invDrag = null;
  fitStorage(); layoutInventory();
  invCanvas.classList.remove('hidden'); canvas.classList.add('blurred');
}
function closeInventory() {
  invOpen = false; invDrag = null;
  invCanvas.classList.add('hidden'); canvas.classList.remove('blurred');
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

function resume() { state = 'play'; ui.pause.classList.add('hidden'); }
function onKeyPress(k) {
  if (state === 'play' && invOpen) {
    if (k === 'i' || k === 'escape' || k === 'tab') closeInventory();
    else if (k === 'm') { closeInventory(); openMap(); }
  } else if (state === 'play') {
    if (k === 'escape') { state = 'pause'; ui.pause.classList.remove('hidden'); keys.clear(); }
    else if (k === 'i' || k === 'tab') openInventory();
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
  blood = []; bloodT = 0;
  revealAround(player.x, player.y);
}
function newGame(n) {
  slot = n;
  const seed = (Math.random() * 2 ** 32) >>> 0;
  world = new WorldGen(seed); resetCaches();
  explored = new Map(); markers = []; playTime = 0; created = Date.now();
  const sp = findSpawn(Math.random);
  player = newPlayer(sp.x, sp.y);
  zombies = []; hordes = new Map(); zSpawnT = 12; inv = newInventory();
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
  if (s.player.parts) for (const b of BODY_PARTS) player.parts[b.id] = s.player.parts[b.id] ?? 100;
  else player.hp = s.player.hp ?? MAX_HP;
  player.wounds = s.player.wounds || {};
  zombies = (s.zombies || []).filter(z => ZOMBIE_TYPES[z.t]).map(z => { const o = makeZombie(z.t, z.x, z.y); o.hp = z.hp; o.dir = z.dir || 'S';
    for (const k of ['look', 'top', 'bottom', 'horde', 'ox', 'oy']) if (z[k] != null) o[k] = z[k];
    return o; });
  hordes = new Map(); nextHordeId = 1;
  for (const z of zombies) if (z.horde) {
    if (!hordes.has(z.horde)) hordes.set(z.horde, { id: z.horde, gx: z.x - z.ox, gy: z.y - z.oy, t: 4 });
    nextHordeId = Math.max(nextHordeId, z.horde + 1);
  }
  zSpawnT = 8;
  inv = newInventory();
  if (s.inv) { Object.assign(inv.equip, s.inv.equip || {}); inv.storage = s.inv.storage || inv.storage; fitStorage(); }
  startPlaying();
}
function saveGame() {
  if (!player || !slot) return;
  const ex = {};
  for (const [k, v] of explored) ex[k] = packBits(v);
  store.set(slotKey(slot), JSON.stringify({
    v: 1, seed: world.seed, created, updated: Date.now(), playTime: Math.floor(playTime),
    player: { x: Math.round(player.x), y: Math.round(player.y), dir: player.dir, parts: player.parts, wounds: player.wounds },
    zombies: zombies.map(z => ({ t: z.type, look: z.look, top: z.top, bottom: z.bottom, horde: z.horde, ox: Math.round(z.ox), oy: Math.round(z.oy), x: Math.round(z.x), y: Math.round(z.y), hp: z.hp, dir: z.dir })),
    inv, explored: ex, markers,
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
      if (state === 'play' || state === 'map') updateBleeding(dt);
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
  ui.loading.classList.add('hidden');
  showMenu();
  requestAnimationFrame(loop);
}).catch(err => { ui.loading.textContent = 'Could not load game art: ' + err; });

// Hooks for automated testing.
window.__SH = { get state() { return state; }, get player() { return player; }, get world() { return world; }, tileAt, newGame, saveGame, loadGame, killPlayer: c => startDying(c), hurtPlayer, zombies: () => zombies,
  giveItem, makeBackpack, bleedLevel, get blood() { return blood; }, get inv() { return inv; }, openInventory, closeInventory, get invOpen() { return invOpen; },
  spawnGroup, get hordes() { return hordes; },
  spawnZombie(dx, dy) { const z = makeZombie('walker', player.x + dx, player.y + dy); zombies.push(z); return z; }, openMap, closeMap, markers: () => markers, explored: () => explored, canvasCache, dataCache };
})();
