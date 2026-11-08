// ============================================================================
// Still Human — world generation
// Pure logic (no canvas), so it can be tested outside the browser.
// The world is infinite and split into chunks of CHUNK x CHUNK tiles.
// Every chunk is generated from the world's hidden seed, so a chunk that is
// unloaded and generated again comes out exactly the same.
// ============================================================================

const TILE = 32;            // pixels per tile
const CHUNK = 16;           // tiles per chunk side
const CPX = TILE * CHUNK;   // pixels per chunk side

const T_GRASS = 0, T_DRY = 1, T_DIRT = 2, T_WATER = 3;

// Edge index for autotiled water / dirt:
//   0..8  = 3x3 block (row*3 + col), 4 = open center
//   9..12 = inside corners (land at NW, NE, SW, SE)
const EDGE_NONE = 255, EDGE_CENTER = 4;

// ---- Tuning ---------------------------------------------------------------
const GEN = {
  lakeScale: 85, lakeThreshold: 0.31,
  riverScale: 320, riverWidth: 0.011, riverWarp: 45,
  fordScale: 24, fordThreshold: 0.34,      // natural land crossings in rivers
  dirtScale: 22, dirtThreshold: 0.33,
  dryScale: 55, dryThreshold: 0.2,
  denseScale: 9, denseThreshold: 0.12,
  forestScale: 65,
};

// ---- Object kinds -----------------------------------------------------------
// sx,sy,sw,sh: source rect in objects sheet. ax,ay: base point inside sprite.
// cw,ch: collider size (centered on base, extending up). 0 = walk through.
// rx,ry: shadow ellipse radii.  tall: fades when the player walks behind.
const KINDS = [
  { name: 'oak',     sx: 0,   sy: 0,   sw: 64, sh: 96, ax: 32, ay: 95, cw: 12, ch: 7,  rx: 20, ry: 6, tall: true, tree: true },
  { name: 'pine',    sx: 64,  sy: 0,   sw: 64, sh: 96, ax: 31, ay: 95, cw: 10, ch: 7,  rx: 17, ry: 5, tall: true, tree: true },
  { name: 'dead',    sx: 128, sy: 0,   sw: 64, sh: 96, ax: 33, ay: 95, cw: 12, ch: 7,  rx: 15, ry: 5, tall: true, tree: true },
  { name: 'bush1',   sx: 0,   sy: 96,  sw: 32, sh: 32, ax: 16, ay: 28, cw: 0,  ch: 0,  rx: 13, ry: 4 },
  { name: 'bush2',   sx: 32,  sy: 96,  sw: 32, sh: 32, ax: 16, ay: 28, cw: 0,  ch: 0,  rx: 13, ry: 4 },
  { name: 'bush3',   sx: 64,  sy: 96,  sw: 32, sh: 32, ax: 16, ay: 28, cw: 0,  ch: 0,  rx: 12, ry: 3 },
  { name: 'rock',    sx: 96,  sy: 96,  sw: 32, sh: 32, ax: 16, ay: 28, cw: 22, ch: 9,  rx: 12, ry: 4, low: true },
  { name: 'stump',   sx: 128, sy: 96,  sw: 32, sh: 32, ax: 16, ay: 28, cw: 18, ch: 9,  rx: 13, ry: 4, low: true },
  { name: 'tall',    sx: 160, sy: 96,  sw: 32, sh: 32, ax: 16, ay: 28, cw: 0,  ch: 0,  rx: 0,  ry: 0 },
  { name: 'log',     sx: 64,  sy: 128, sw: 64, sh: 32, ax: 32, ay: 28, cw: 56, ch: 11, rx: 28, ry: 4, low: true },
  { name: 'boulder', sx: 0,   sy: 128, sw: 64, sh: 64, ax: 32, ay: 60, cw: 54, ch: 20, rx: 29, ry: 7, tall: true },
  // Camp pieces (camp sheet). Crates are containers; the campfire animates its flame and smoke.
  { name: 'tent',     img: 'campTent', sx: 0, sy: 0, sw: 60, sh: 45, ax: 30, ay: 42, cw: 52, ch: 17, rx: 29, ry: 6, tall: true },
  { name: 'crateS',   img: 'camp', sx: 88, sy: 44, sw: 16, sh: 14, ax: 8,  ay: 12, cw: 12, ch: 6,  rx: 7,  ry: 2, low: true, crate: 'crateS' },
  { name: 'crateM',   img: 'camp', sx: 148, sy: 38, sw: 24, sh: 20, ax: 12, ay: 18, cw: 18, ch: 7, rx: 10, ry: 3, low: true, crate: 'crateM' },
  { name: 'crateL',   img: 'camp', sx: 208, sy: 32, sw: 32, sh: 26, ax: 16, ay: 24, cw: 28, ch: 9, rx: 15, ry: 3, crate: 'crateL' },
  { name: 'campfire', img: 'camp', sx: 0,  sy: 64, sw: 64, sh: 64, ax: 32, ay: 56, cw: 20, ch: 7,  rx: 0,  ry: 0, fire: true },
];
const K = Object.fromEntries(KINDS.map((k, i) => [k.name, i]));

// ---- Hashing & noise ----------------------------------------------------------
function hashInt(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
function hash01(x, y, s) { return hashInt(x, y, s) / 4294967296; }

const GRAD_X = [1, -1, 1, -1, 1.4142, -1.4142, 0, 0];
const GRAD_Y = [1, 1, -1, -1, 0, 0, 1.4142, -1.4142];
// Gradient noise that never repeats (gradients come from a hash, not a table).
function makeNoise(seed) {
  return function (x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const g = (ix, iy, dx, dy) => { const h = hashInt(ix, iy, seed) & 7; return GRAD_X[h] * dx + GRAD_Y[h] * dy; };
    const a = g(X, Y, xf, yf), b = g(X + 1, Y, xf - 1, yf);
    const c = g(X, Y + 1, xf, yf - 1), d = g(X + 1, Y + 1, xf - 1, yf - 1);
    const x1 = a + (b - a) * u, x2 = c + (d - c) * u;
    return x1 + (x2 - x1) * v; // roughly -1..1
  };
}
const makeNoiseField = makeNoise;   // alias: game.js has its own makeNoise (for sounds)
function fbm(n, x, y, oct) {
  let amp = 1, f = 1, sum = 0, tot = 0;
  for (let i = 0; i < oct; i++) { sum += amp * n(x * f, y * f); tot += amp; amp *= 0.5; f *= 2; }
  return sum / tot;
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ---- World generator -------------------------------------------------------------
class WorldGen {
  constructor(seed) {
    this.seed = seed >>> 0;
    const s = this.seed;
    this.nLake = makeNoise(s ^ 0x1111);
    this.nRiver = makeNoise(s ^ 0x2222);
    this.nWarpX = makeNoise(s ^ 0x3333);
    this.nWarpY = makeNoise(s ^ 0x4444);
    this.nFord = makeNoise(s ^ 0x5555);
    this.nDirt = makeNoise(s ^ 0x6666);
    this.nDry = makeNoise(s ^ 0x7777);
    this.nDense = makeNoise(s ^ 0x8888);
    this.nForest = makeNoise(s ^ 0x9999);
    this.nTreeType = makeNoise(s ^ 0xaaaa);
  }

  // Continuous fields for one tile.
  field(tx, ty) {
    const lake = fbm(this.nLake, tx / GEN.lakeScale, ty / GEN.lakeScale, 3);
    const wx = tx + GEN.riverWarp * this.nWarpX(tx / 110, ty / 110);
    const wy = ty + GEN.riverWarp * this.nWarpY(tx / 110, ty / 110);
    const river = Math.abs(fbm(this.nRiver, wx / GEN.riverScale, wy / GEN.riverScale, 2));
    const ford = this.nFord(tx / GEN.fordScale, ty / GEN.fordScale);
    const isWater = lake > GEN.lakeThreshold || (river < GEN.riverWidth && ford < GEN.fordThreshold);
    // How far (in field units) we are from any water — used to keep dirt and
    // dry ground away from shores, where the edge tiles have green grass.
    const nearWater = lake > GEN.lakeThreshold - 0.1 || river < GEN.riverWidth * 2.6;
    const dry = fbm(this.nDry, tx / GEN.dryScale, ty / GEN.dryScale, 2) + (hash01(tx, ty, this.seed ^ 0x51) - 0.5) * 0.1;
    const isDry = !nearWater && dry > GEN.dryThreshold;
    const dirt = fbm(this.nDirt, tx / GEN.dirtScale, ty / GEN.dirtScale, 2);
    const isDirt = !nearWater && dry < GEN.dryThreshold - 0.08 && dirt > GEN.dirtThreshold;
    return { isWater, isDry, isDirt };
  }

  forest(tx, ty) {
    const f = fbm(this.nForest, tx / GEN.forestScale, ty / GEN.forestScale, 2);
    return clamp01((f - 0.02) * 3.2);
  }

  // Generate one chunk's data. Cheap (no drawing): safe to call for the map.
  genChunk(cx, cy) {
    const P = 2, S = CHUNK + P * 2;
    const ox = cx * CHUNK - P, oy = cy * CHUNK - P;
    const rawW = new Uint8Array(S * S), rawD = new Uint8Array(S * S), dry = new Uint8Array(S * S);
    // Houses and roads near this chunk (see buildings_world.js).
    const plans = typeof plansInRect === 'function'
      ? plansInRect(this, ox - LOT_MARGIN - 4, oy - LOT_MARGIN - 4, ox + S + LOT_MARGIN + 4, oy + S + LOT_MARGIN + 4) : { buildings: [], roads: [], camps: [] };
    const inRoad = (x, y) => plans.roads.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const f = this.field(ox + i, oy + j);
      const k = j * S + i;
      const road = plans.roads.length && inRoad(ox + i, oy + j);
      rawW[k] = f.isWater && !road ? 1 : 0;
      rawD[k] = f.isDirt || road ? 1 : 0;
      dry[k] = f.isDry && !road ? 1 : 0;
    }
    // "Opening": keep only cells that are part of a full 2x2 block. This
    // removes 1-tile-wide strips, which the 13-piece edge sets can't draw.
    const open = (raw) => {
      const out = new Uint8Array(S * S);
      const r = (i, j) => raw[j * S + i];
      for (let j = 1; j < S - 1; j++) for (let i = 1; i < S - 1; i++) {
        if (!r(i, j)) continue;
        if ((r(i - 1, j) && r(i, j - 1) && r(i - 1, j - 1)) ||
            (r(i + 1, j) && r(i, j - 1) && r(i + 1, j - 1)) ||
            (r(i - 1, j) && r(i, j + 1) && r(i - 1, j + 1)) ||
            (r(i + 1, j) && r(i, j + 1) && r(i + 1, j + 1))) out[j * S + i] = 1;
      }
      return out;
    };
    const W = open(rawW), D = open(rawD);
    const edgeOf = (M, i, j) => {
      const m = (a, b) => M[b * S + a];
      const n = m(i, j - 1), s = m(i, j + 1), w = m(i - 1, j), e = m(i + 1, j);
      const col = !w ? 0 : !e ? 2 : 1;
      const row = !n ? 0 : !s ? 2 : 1;
      if (col === 1 && row === 1) {
        if (!m(i - 1, j - 1)) return 9;
        if (!m(i + 1, j - 1)) return 10;
        if (!m(i - 1, j + 1)) return 11;
        if (!m(i + 1, j + 1)) return 12;
        return EDGE_CENTER;
      }
      return row * 3 + col;
    };

    // Tiles covered by a house (bld) or its cleared yard (lot): nothing grows there.
    const bld = new Uint8Array(CHUNK * CHUNK), lot = new Uint8Array(CHUNK * CHUNK);
    for (const b of plans.buildings) {
      for (let y = b.y - LOT_MARGIN; y < b.y + b.h + LOT_MARGIN; y++) for (let x = b.x - LOT_MARGIN; x < b.x + b.w + LOT_MARGIN; x++) {
        const tx = x - cx * CHUNK, ty = y - cy * CHUNK;
        if (tx < 0 || ty < 0 || tx >= CHUNK || ty >= CHUNK) continue;
        lot[ty * CHUNK + tx] = 1;
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) bld[ty * CHUNK + tx] = 1;
      }
    }
    // Camps clear a small round patch of forest around their fire.
    for (const c of plans.camps || []) {
      for (let y = c.ty - CAMP_CLEAR; y <= c.ty + CAMP_CLEAR; y++) for (let x = c.tx - CAMP_CLEAR; x <= c.tx + CAMP_CLEAR; x++) {
        const tx = x - cx * CHUNK, ty = y - cy * CHUNK;
        if (tx < 0 || ty < 0 || tx >= CHUNK || ty >= CHUNK) continue;
        if ((x - c.tx) ** 2 + (y - c.ty) ** 2 <= (CAMP_CLEAR + 0.5) ** 2) lot[ty * CHUNK + tx] = 1;
      }
    }
    const type = new Uint8Array(CHUNK * CHUNK);
    const edge = new Uint8Array(CHUNK * CHUNK).fill(EDGE_NONE);
    const vari = new Uint8Array(CHUNK * CHUNK);
    const bx = cx * CHUNK, by = cy * CHUNK;
    for (let ty = 0; ty < CHUNK; ty++) for (let tx = 0; tx < CHUNK; tx++) {
      const i = tx + P, j = ty + P, k = ty * CHUNK + tx, wx = bx + tx, wy = by + ty;
      const h = hashInt(wx, wy, this.seed ^ 0x77);
      if (W[j * S + i]) { type[k] = T_WATER; edge[k] = edgeOf(W, i, j); }
      else if (D[j * S + i]) { type[k] = T_DIRT; edge[k] = edgeOf(D, i, j); vari[k] = h & 7; }
      else if (dry[j * S + i]) { type[k] = T_DRY; vari[k] = h & 3; }
      else {
        type[k] = T_GRASS;
        const dense = fbm(this.nDense, wx / GEN.denseScale, wy / GEN.denseScale, 2) > GEN.denseThreshold;
        vari[k] = (dense ? 2 : 0) + ((h >>> 3) & 1);
      }
    }

    // Is this tile land with no water in its 8 neighbours?
    const clearLand = (tx, ty) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (W[(ty + P + dy) * S + tx + P + dx]) return false;
      }
      return true;
    };
    const plantable = (tx, ty) => {
      if (lot[ty * CHUNK + tx]) return false;
      const t = type[ty * CHUNK + tx];
      return (t === T_GRASS || t === T_DRY) && clearLand(tx, ty);
    };

    const objects = [];
    const used = new Uint8Array(CHUNK * CHUNK);
    const s = this.seed;
    // Camp pieces whose base falls inside this chunk.
    for (const c of plans.camps || []) for (const o of c.objects) {
      if (Math.floor(o.x / CPX) === cx && Math.floor(o.y / CPX) === cy) objects.push(o);
    }

    // Trees: at most one per 2x2 block.
    for (let qy = 0; qy < CHUNK; qy += 2) for (let qx = 0; qx < CHUNK; qx += 2) {
      const wx = bx + qx, wy = by + qy;
      const f = this.forest(wx, wy);
      const prob = 0.015 + 0.85 * f * f;
      if (hash01(wx, wy, s ^ 0x101) >= prob) continue;
      const h = hashInt(wx, wy, s ^ 0x102);
      const tx = qx + (h & 1), ty = qy + ((h >>> 1) & 1);
      if (!plantable(tx, ty)) continue;
      const t = type[ty * CHUNK + tx];
      const r = hash01(wx, wy, s ^ 0x103);
      let kind;
      if (r < (t === T_DRY ? 0.22 : 0.04)) kind = K.dead;
      else kind = this.nTreeType((bx + tx) / 30, (by + ty) / 30) + (r - 0.5) * 0.5 > 0 ? K.pine : K.oak;
      const jx = ((h >>> 4) & 15) - 7, jy = ((h >>> 8) & 7) - 3;
      objects.push({ k: kind, x: (bx + tx) * TILE + 16 + jx, y: (by + ty) * TILE + 26 + jy });
      used[ty * CHUNK + tx] = 1;
    }

    // Smaller objects, one roll per tile.
    for (let ty = 0; ty < CHUNK; ty++) for (let tx = 0; tx < CHUNK; tx++) {
      const k = ty * CHUNK + tx;
      if (used[k] || !plantable(tx, ty)) continue;
      const wx = bx + tx, wy = by + ty;
      const f = this.forest(wx, wy);
      let r = hash01(wx, wy, s ^ 0x201);
      const h = hashInt(wx, wy, s ^ 0x202);
      const px = wx * TILE + 16 + ((h & 7) - 3), py = wy * TILE + 26 + (((h >>> 3) & 3) - 1);
      const wideOk = tx + 1 < CHUNK && !used[k + 1] && plantable(tx + 1, ty);
      let kind = -1;
      const pick = (p, kk) => { if (kind < 0) { if (r < p) kind = kk; else r -= p; } };
      if (wideOk) pick(0.0025, K.boulder);
      if (wideOk && f > 0.35) pick(0.006, K.log);
      pick(0.006, K.rock);
      if (f > 0.25) pick(0.008, K.stump);
      pick(0.012 + 0.05 * f, [K.bush1, K.bush2, K.bush3][(h >>> 6) % 3]);
      pick(0.03, K.tall);
      if (kind < 0) continue;
      const wide = kind === K.boulder || kind === K.log;
      objects.push({ k: kind, x: wide ? px + 16 : px, y: py });
      used[k] = 1;
      if (wide) used[k + 1] = 1;
    }

    // Flat ground details (flowers, pebbles, clover...) drawn into the ground.
    const details = [];
    for (let ty = 0; ty < CHUNK; ty++) for (let tx = 0; tx < CHUNK; tx++) {
      const k = ty * CHUNK + tx;
      if ((type[k] !== T_GRASS && type[k] !== T_DRY) || bld[k]) continue;
      const wx = bx + tx, wy = by + ty;
      if (hash01(wx, wy, s ^ 0x301) > 0.07) continue;
      const h = hashInt(wx, wy, s ^ 0x302);
      details.push({ d: h % 6, x: tx * TILE + ((h >>> 4) & 7) - 4, y: ty * TILE + ((h >>> 8) & 7) - 4 });
    }

    // Objects sorted by depth once, so drawing only needs a merge.
    objects.sort((a, b) => a.y - b.y);
    return { cx, cy, type, edge, vari, objects, details, bld, buildings: plans.buildings.filter(b => b.x < bx + CHUNK && b.x + b.w > bx && b.y < by + CHUNK && b.y + b.h > by) };
  }
}

if (typeof module !== 'undefined') {
  module.exports = { TILE, CHUNK, CPX, T_GRASS, T_DRY, T_DIRT, T_WATER, EDGE_NONE, EDGE_CENTER, KINDS, K, GEN, WorldGen, hash01, hashInt };
}
