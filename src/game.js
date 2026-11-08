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

// Player sheet: 64x64 frames, 4 per row. Rows: idle S, walk S, walk E, walk N, walk W.
const PF = 64, P_AX = 32, P_AY = 58;
const DIR_ROW = { S: 1, E: 2, N: 3, W: 4 };

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
function newPlayer(x, y) { return { x, y, dir: 'S', moving: false, running: false, anim: 0 }; }
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
  if (p.moving) return [f, DIR_ROW[p.dir]];
  if (p.dir === 'S') return [f, 0];
  return [0, DIR_ROW[p.dir]];
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
  let pl = null;
  if (withPlayer) { pl = { k: -1, x: player.x, y: player.y }; items.push(pl); }
  items.sort((a, b) => a.y - b.y);

  bctx.fillStyle = 'rgba(16, 20, 8, 0.32)';
  for (const o of items) {
    if (o.k < 0) drawShadow(o.x, o.y, 9, 3);
    else { const k = KINDS[o.k]; drawShadow(o.x, o.y, k.rx, k.ry); }
  }

  const pbx0 = withPlayer ? player.x - 11 : 0, pby0 = withPlayer ? player.y - 46 : 0;
  for (const o of items) {
    if (o.k < 0) {
      const [fx, fy] = playerFrame(player);
      bctx.drawImage(IMG.player, fx * PF, fy * PF, PF, PF, Math.round(o.x - P_AX), Math.round(o.y - P_AY), PF, PF);
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
  player = null;
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
  revealAround(player.x, player.y);
}
function newGame(n) {
  slot = n;
  const seed = (Math.random() * 2 ** 32) >>> 0;
  world = new WorldGen(seed); resetCaches();
  explored = new Map(); markers = []; playTime = 0; created = Date.now();
  const sp = findSpawn(Math.random);
  player = newPlayer(sp.x, sp.y);
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
  startPlaying();
}
function saveGame() {
  if (!player || !slot) return;
  const ex = {};
  for (const [k, v] of explored) ex[k] = packBits(v);
  store.set(slotKey(slot), JSON.stringify({
    v: 1, seed: world.seed, created, updated: Date.now(), playTime: Math.floor(playTime),
    player: { x: Math.round(player.x), y: Math.round(player.y), dir: player.dir },
    explored: ex, markers,
  }));
  lastAutosave = performance.now();
}
// Permadeath: the save is deleted and the player goes back to the menu.
function killPlayer(cause) {
  store.del(slotKey(slot));
  slot = 0; state = 'dead';
  $('dead-cause').textContent = cause || '';
  $('dead-time').textContent = 'You survived ' + fmtTime(playTime) + '.';
  ui.dead.classList.remove('hidden'); ui.hint.classList.add('hidden');
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
  } else if (player && (state === 'play' || state === 'pause' || state === 'dead')) {
    if (state === 'play') {
      updatePlayer(dt);
      playTime += dt;
      revealT -= dt;
      if (revealT <= 0) { revealAround(player.x, player.y); revealT = 0.2; }
      if (now - lastAutosave > 120000) saveGame();
    }
    const camX = Math.round(player.x - BW / 2), camY = Math.round(player.y - 24 - BH / 2);
    renderWorld(camX, camY, true);
    unloadFarChunks(camX, camY);
    renderMinimap();
  } else if (state === 'map') {
    playTime += dt;
    renderFullMap();
  }

  ctx.drawImage(buf, 0, 0, BW * scale, BH * scale);

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
    if (!ui.debug.classList.contains('hidden') && player) {
      ui.debug.textContent = `${fps} fps · tile ${Math.floor(player.x / TILE)}, ${Math.floor(player.y / TILE)} · chunks ${canvasCache.size} drawn / ${dataCache.size} data / ${explored.size} explored`;
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
window.__SH = { get state() { return state; }, get player() { return player; }, get world() { return world; }, tileAt, newGame, saveGame, loadGame, killPlayer, openMap, closeMap, markers: () => markers, explored: () => explored, canvasCache, dataCache };
})();
