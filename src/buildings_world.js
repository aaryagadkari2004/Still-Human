// ============================================================================
// Still Human — buildings: templates and placement (pure logic, no drawing)
// The world is split into regions; each region may hold a hamlet (a dirt road
// with houses along it), a lone cabin, or nothing. Everything comes from the
// world seed, so a house is always in the same place.
// ============================================================================

const REGION = 40;            // tiles per region side
const LOT_MARGIN = 2;         // cleared yard around a house (no trees or rocks)

// Furniture: footprint in tiles (w,h), sprite key, whether it can be searched,
// and the loot table it uses. Sprites stand on the bottom of their footprint.
const FURN = {
  bed:     { img: 'fBed',     w: 1, h: 2, recolor: 'blanket' },
  dresser: { img: 'fDresser', w: 2, h: 1, container: 'dresser' },
  shelf:   { img: 'fShelf',   w: 1, h: 1, container: 'shelf' },
  fridge:  { img: 'fFridge',  w: 1, h: 1, container: 'fridge' },
  stove:   { img: 'fStove',   w: 1, h: 1 },
  counter: { img: 'fCounter', w: 2, h: 1, container: 'counter' },
  table:   { img: 'fTable',   w: 2, h: 1 },
  chair:   { img: 'fChair',   w: 1, h: 1 },
  // General store. Shelves show their empty sprite once you've cleared them out.
  rack:     { img: 'fStoreShelf', emptyImg: 'fStoreShelfEmpty', w: 2, h: 1, container: 'storeShelf' },
  cooler:   { img: 'fCooler',   w: 1, h: 1, container: 'cooler' },
  checkout: { img: 'fCheckout', w: 2, h: 1, container: 'checkout' },
  boxes:    { img: 'fPallet',   w: 1, h: 1, container: 'stockroom' },
  // Barn.
  workbench: { img: 'fWorkbench', w: 2, h: 1, container: 'workbench' },
  toolrack:  { img: 'fToolRack',  w: 1, h: 1, container: 'toolrack' },
  feedsacks: { img: 'fFeedSacks', w: 1, h: 1, container: 'feedsacks' },
  hay:       { img: 'fHay',       w: 1, h: 1 },
  tractor:   { img: 'fTractor',   w: 2, h: 2 },
};

// Floor plans. # wall, . floor, D outside door, d inside door, W window.
// Front doors are on the south (bottom) wall so they can be seen from outside.
// f: furniture [name, x, y] (top-left of its footprint). z: spots a resident zombie may stand.
// Grid legend: # wall, . floor, D outside door, d inside door, W window,
// S storefront window (pairs of S are drawn as one wide shop window; each tile works like a window),
// B big barn door (pairs of B are one double door: they open, close and break together).
const TEMPLATES = [
  { name: 'cabin', grid: [
      '##W##W##',
      '#......#',
      '#......W',
      'W......#',
      '#......#',
      '#......#',
      '###D####'],
    f: [['bed', 1, 1], ['dresser', 3, 1], ['shelf', 6, 1], ['table', 3, 4], ['chair', 2, 4], ['chair', 5, 4]],
    z: [[5, 2], [2, 4]] },
  { name: 'cabin2', grid: [
      '##W###W###',
      '#....#...#',
      '#....d...W',
      'W....#...#',
      '#....#...#',
      '#....#...#',
      '###D####W#'],
    f: [['fridge', 6, 1], ['stove', 7, 1], ['counter', 7, 3], ['table', 1, 4], ['chair', 3, 4], ['bed', 1, 1], ['shelf', 4, 1]],
    z: [[7, 4], [2, 3]] },
  { name: 'house', grid: [
      '##W#####W##',
      '#.....#...#',
      '#.....#...W',
      'W.....#...#',
      '#.....###d#',
      '#.....d...#',
      '#.....#...#',
      '####D####W#'],
    f: [['bed', 1, 1], ['dresser', 3, 1], ['shelf', 5, 1], ['fridge', 7, 1], ['counter', 8, 1], ['stove', 9, 2],
        ['table', 2, 4], ['chair', 1, 4], ['chair', 4, 4], ['shelf', 9, 6]],
    z: [[3, 3], [8, 2], [9, 6]] },
  { name: 'longhouse', grid: [
      '###W####W###',
      '#....#.....#',
      'W....#.....#',
      '#....d.....W',
      '#....#.....#',
      '#....#.....#',
      '##D#####D###'],
    f: [['bed', 1, 1], ['dresser', 2, 1], ['bed', 1, 4], ['fridge', 6, 1], ['stove', 7, 1], ['counter', 9, 1], ['shelf', 10, 3],
        ['table', 7, 4], ['chair', 6, 4], ['chair', 9, 4]],
    z: [[2, 4], [8, 3]] },
  // General store: sales floor with shelf aisles and drinks coolers, checkout by the door,
  // stockroom in the back corner. Only ever placed in hamlets (never picked as a house).
  { name: 'store', kind: 'store', grid: [
      '############',
      '#.......#..#',
      '#.......d..#',
      '#.......#..#',
      '#.......####',
      '#..........#',
      '#..........W',
      '#..........#',
      '#SS##D###SS#'],
    f: [['cooler', 1, 1], ['cooler', 2, 1], ['rack', 4, 1], ['rack', 6, 1],
        ['rack', 2, 3], ['rack', 4, 3],
        ['rack', 1, 5], ['checkout', 7, 6],
        ['boxes', 9, 1], ['boxes', 10, 1], ['boxes', 10, 3]],
    z: [[3, 6], [9, 5], [6, 2]] },
  // Barn: one big open room with a double door, a small side door and loft windows.
  { name: 'barn', kind: 'barn', grid: [
      '##########',
      '#........#',
      'W........W',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '###BB##D##'],
    f: [['workbench', 1, 1], ['toolrack', 4, 1], ['toolrack', 5, 1], ['feedsacks', 7, 1], ['feedsacks', 8, 1],
        ['hay', 8, 2], ['hay', 8, 3], ['hay', 1, 3], ['tractor', 5, 3], ['feedsacks', 8, 5], ['workbench', 1, 5]],
    z: [[3, 3], [7, 5]] },
];
for (const t of TEMPLATES) { t.h = t.grid.length; t.w = t.grid[0].length; }

// Lays a template out with optional left-right mirroring. Returns cells (char grid),
// openings (doors/windows with their side), and furniture.
function layoutBuilding(b) {
  if (b._layout) return b._layout;
  const t = TEMPLATES[b.tpl], W = t.w, H = t.h;
  const mx = x => b.mirror ? W - 1 - x : x;
  const cells = [];
  for (let y = 0; y < H; y++) { cells.push([]); for (let x = 0; x < W; x++) cells[y].push(t.grid[y][mx(x)]); }
  const isWallish = c => c === '#' || c === 'D' || c === 'd' || c === 'W' || c === 'S' || c === 'B';
  const openings = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = cells[y][x];
    if (c !== 'D' && c !== 'd' && c !== 'W' && c !== 'S' && c !== 'B') continue;
    const horiz = (x > 0 && isWallish(cells[y][x - 1])) || (x < W - 1 && isWallish(cells[y][x + 1]));
    const o = { x, y, kind: c === 'W' || c === 'S' ? 'window' : 'door', outer: c !== 'd', horiz, south: y === H - 1, north: y === 0 };
    if (c === 'S') o.shop = x < W - 1 && cells[y][x + 1] === 'S' ? 'L' : 'R';   // which half of the wide window
    if (c === 'B') o.wide = x < W - 1 && cells[y][x + 1] === 'B' ? 'L' : 'R';   // which half of the double door
    openings.push(o);
  }
  // Double doors: each half knows the other.
  openings.forEach((o, i) => { if (o.wide) o.pair = openings.findIndex(p => p.y === o.y && p.x === o.x + (o.wide === 'L' ? 1 : -1)); });
  const furniture = t.f.map(([name, fx, fy], i) => {
    const F = FURN[name];
    const x = b.mirror ? W - fx - F.w : fx;
    return { name, x, y: fy, i };
  });
  const zspots = t.z.map(([zx, zy]) => [mx(zx), zy]);
  b._layout = { cells, openings, furniture, zspots, W, H, isWallish };
  return b._layout;
}

const regionCache = new Map();
// Returns { buildings, roads } for a region. Roads are tile rectangles {x,y,w,h}.
function regionPlan(gen, rx, ry) {
  const key = gen.seed + ':' + rx + ',' + ry;
  let plan = regionCache.get(key);
  if (plan) return plan;
  plan = { buildings: [], roads: [], farms: [] };
  const s = gen.seed ^ 0xb0b0;
  const r = hash01(rx, ry, s);
  const ox = rx * REGION, oy = ry * REGION;
  const rnd = (() => { let i = 0; return () => hash01(rx * 31 + (i++), ry * 17, s ^ 0x77); })();
  const waterFree = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (gen.field(x, y).isWater) return false;
    return true;
  };
  const HOUSES = TEMPLATES.filter(t => !t.kind).length;   // templates that can be houses
  const tryPlace = (tpl, x, y) => {
    const t = TEMPLATES[tpl];
    if (!waterFree(x - LOT_MARGIN, y - LOT_MARGIN, t.w + LOT_MARGIN * 2, t.h + LOT_MARGIN * 2)) return false;
    const b = { id: `${rx},${ry},${plan.buildings.length}`, x, y, w: t.w, h: t.h, tpl,
      mirror: rnd() < 0.5, mat: Math.floor(rnd() * 3), roofVar: Math.floor(rnd() * 3), kind: t.kind || 'house',
      cond: (() => { const c = rnd(); return c < 0.45 ? 'abandoned' : c < 0.8 ? 'looted' : 'locked'; })(),
      seed: hashInt(x, y, s) };
    plan.buildings.push(b);
    return true;
  };
  if (r < 0.07) {
    // Hamlet: a dirt road across the region with houses along its north side.
    const roadY = oy + 20 + Math.floor(rnd() * 8) - 4;
    const road = { x: ox + 1, y: roadY, w: REGION - 2, h: 3 };
    if (waterFree(road.x, road.y, road.w, road.h)) {
      plan.roads.push(road);
      let cx = ox + 3, n = 0;
      // Every hamlet has one general store, in one of its first three lots.
      const storeAt = Math.floor(hash01(rx, ry, s ^ 0x5707) * 3), STORE = TEMPLATES.findIndex(t => t.kind === 'store');
      while (true) {
        let tpl = Math.floor(rnd() * HOUSES);
        if (n++ === storeAt) tpl = STORE;
        const t = TEMPLATES[tpl];
        if (cx + t.w > ox + REGION - 3) break;
        const setback = 1 + Math.floor(rnd() * 3);
        tryPlace(tpl, cx, roadY - setback - t.h);
        cx += t.w + 3 + Math.floor(rnd() * 4);
      }
    }
  } else if (r >= 0.27 && r < 0.33) {
    planFarm(gen, rx, ry, plan, rnd, tryPlace, waterFree);
  } else if (r < 0.27) {
    // A lone cabin somewhere in the region.
    const tpl = rnd() < 0.6 ? Math.floor(rnd() * 2) : Math.floor(rnd() * HOUSES), t = TEMPLATES[tpl];
    const x = ox + 4 + Math.floor(rnd() * (REGION - 8 - t.w)), y = oy + 4 + Math.floor(rnd() * (REGION - 8 - t.h));
    tryPlace(tpl, x, y);
  }
  plan.camps = [];
  planCamp(gen, rx, ry, plan, rnd);
  regionCache.set(key, plan);
  if (regionCache.size > 150) regionCache.delete(regionCache.keys().next().value);
  return plan;
}
// Buildings and roads overlapping a tile rectangle.
// ---- Farms ---------------------------------------------------------------------------------------
// Standalone farms on open grassland: a barn with a dirt yard and track, a fenced paddock beside it
// (with a gate) and a field of dead corn on the other side. The paddock is where farm animals live.
const FARM_FIELD = { w: 9, h: 7 }, FARM_PEN = { w: 10, h: 8 };
function planFarm(gen, rx, ry, plan, rnd, tryPlace, waterFree) {
  const ox = rx * REGION, oy = ry * REGION, BARN = TEMPLATES.findIndex(t => t.kind === 'barn'), bt = TEMPLATES[BARN];
  const W = FARM_FIELD.w + 2 + bt.w + 2 + FARM_PEN.w, H = bt.h + 6;
  const x0 = ox + 3 + Math.floor(rnd() * (REGION - 6 - W)), y0 = oy + 3 + Math.floor(rnd() * (REGION - 10 - H));
  // Open country only: no thick woods and no water anywhere on the farm.
  for (let y = y0; y < y0 + H; y += 3) for (let x = x0; x < x0 + W; x += 3) if (gen.forest(x, y) > 0.35) return;
  if (!waterFree(x0 - 2, y0 - 2, W + 4, H + 4)) return;
  const bx = x0 + FARM_FIELD.w + 2, by = y0;
  if (!tryPlace(BARN, bx, by)) return;
  const barn = plan.buildings[plan.buildings.length - 1];
  barn.mirror = false;   // keep the big doors where the yard and track are
  const farm = { id: `farm:${rx},${ry}`, cond: barn.cond, seed: barn.seed, lots: [], soil: [], objects: [], gates: [] };
  // Dirt yard in front of the barn and a track running off to the south.
  plan.roads.push({ x: bx + 1, y: by + bt.h, w: 6, h: 3 });
  plan.roads.push({ x: bx + 3, y: by + bt.h + 3, w: 2, h: Math.max(2, oy + REGION - 1 - (by + bt.h + 3)) });
  // Field.
  const fx = x0, fy = by + 1;
  farm.soil.push({ x: fx, y: fy, w: FARM_FIELD.w, h: FARM_FIELD.h });
  farm.lots.push({ x: fx - 1, y: fy - 1, w: FARM_FIELD.w + 2, h: FARM_FIELD.h + 2 });
  for (let y = fy; y < fy + FARM_FIELD.h; y++) for (let x = fx; x < fx + FARM_FIELD.w; x++) {
    if (rnd() > 0.7) continue;   // gaps where the corn has fallen over
    const v = 1 + Math.floor(rnd() * 3);
    farm.objects.push({ k: K['corn' + v], x: x * TILE + 16 + Math.floor(rnd() * 7) - 3, y: y * TILE + 28 + Math.floor(rnd() * 5) - 2, farm, corn: true });
  }
  // Paddock fence, with a gate in the middle of the side facing the track.
  const px = bx + bt.w + 2, py = by;
  farm.pen = { x: px, y: py, w: FARM_PEN.w, h: FARM_PEN.h };
  farm.lots.push({ x: px - 1, y: py - 1, w: FARM_PEN.w + 2, h: FARM_PEN.h + 2 });
  const gx = px + Math.floor(FARM_PEN.w / 2) - 1 + Math.floor(rnd() * 2);
  for (let y = py; y < py + FARM_PEN.h; y++) for (let x = px; x < px + FARM_PEN.w; x++) {
    const top = y === py, bot = y === py + FARM_PEN.h - 1, left = x === px, right = x === px + FARM_PEN.w - 1;
    if (!(top || bot || left || right)) continue;
    let piece;
    if (top && left) piece = 'fenceTL'; else if (top && right) piece = 'fenceTR';
    else if (bot && left) piece = 'fenceBL'; else if (bot && right) piece = 'fenceBR';
    else if (left || right) piece = 'fenceV';
    else if (bot && x === gx) piece = 'gate';
    else piece = rnd() < 0.06 ? 'fenceBroken' : 'fenceH';
    const o = { k: K[piece], x: x * TILE + 16, y: y * TILE + 31, farm };
    if (piece === 'gate') { o.gate = farm.gates.length; farm.gates.push(o); }
    farm.objects.push(o);
  }
  plan.farms.push(farm);
}

// ---- Camps ---------------------------------------------------------------------------------------
// Abandoned campsites, only deep in the woods: a tent, a campfire (often still burning) and
// anywhere from no crates to a few. Crates are containers with camping loot.
const CAMP_CLEAR = 4;           // tiles of cleared ground around the fire
const CAMP_CHANCE = 0.55;       // chance a region even tries for a camp (most fail: not enough forest)
function planCamp(gen, rx, ry, plan, rnd) {
  const s = gen.seed ^ 0xca39;
  if (hash01(rx, ry, s) >= CAMP_CHANCE) return;
  const ox = rx * REGION, oy = ry * REGION;
  for (let tries = 0; tries < 8; tries++) {
    const tx = ox + 6 + Math.floor(rnd() * (REGION - 12)), ty = oy + 6 + Math.floor(rnd() * (REGION - 12));
    // Deep woods: thick forest at the spot and all around it.
    let ok = gen.forest(tx, ty) > 0.8;
    for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6]]) if (ok && gen.forest(tx + dx, ty + dy) < 0.55) ok = false;
    for (let y = ty - CAMP_CLEAR - 1; ok && y <= ty + CAMP_CLEAR + 1; y++)
      for (let x = tx - CAMP_CLEAR - 1; ok && x <= tx + CAMP_CLEAR + 1; x++) { const f = gen.field(x, y); if (f.isWater || f.isDirt) ok = false; }
    if (ok && plan.buildings.some(b => tx > b.x - 8 && tx < b.x + b.w + 8 && ty > b.y - 8 && ty < b.y + b.h + 8)) ok = false;
    if (ok && plan.roads.some(r => tx > r.x - 6 && tx < r.x + r.w + 6 && ty > r.y - 6 && ty < r.y + r.h + 6)) ok = false;
    if (!ok) continue;
    const c = { id: `camp:${rx},${ry}`, camp: true, cond: 'abandoned', tx, ty, seed: hashInt(tx, ty, s), objects: [] };
    const fx = tx * TILE + 16, fy = ty * TILE + 20;
    c.objects.push({ k: K.campfire, x: fx, y: fy, camp: c, lit: rnd() < 0.65, ph: Math.floor(rnd() * 8) });
    // Spots around the fire, clockwise from north. The tent takes one; crates take others.
    const SPOTS = [[0, -50], [44, -34], [52, 6], [40, 40], [0, 50], [-40, 40], [-52, 6], [-44, -34]];
    const tentSpot = Math.floor(rnd() * 8);
    const [tdx, tdy] = SPOTS[tentSpot];
    const tentR = 1.4;  // the tent is wide: push it further out
    c.objects.push({ k: K.tent, x: Math.round(fx + tdx * tentR), y: Math.round(fy + tdy * tentR), camp: c });
    const r = rnd(), crates = r < 0.25 ? 0 : r < 0.65 ? 1 : r < 0.9 ? 2 : 3;
    const free = [2, 3, 4, 5, 6].map(d => (tentSpot + d) % 8);   // not right beside the tent
    for (let i = 0; i < crates; i++) {
      const j = Math.floor(rnd() * free.length), [dx, dy] = SPOTS[free.splice(j, 1)[0]];
      const sz = rnd(), k = sz < 0.45 ? K.crateS : sz < 0.8 ? K.crateM : K.crateL;
      c.objects.push({ k, x: fx + dx + Math.floor(rnd() * 7) - 3, y: fy + dy + Math.floor(rnd() * 5) - 2, camp: c, ci: i });
    }
    plan.camps.push(c);
    return;
  }
}

function plansInRect(gen, x0, y0, x1, y1) {
  const out = { buildings: [], roads: [], camps: [], farms: [] };
  for (let ry = Math.floor(y0 / REGION); ry <= Math.floor(y1 / REGION); ry++)
    for (let rx = Math.floor(x0 / REGION); rx <= Math.floor(x1 / REGION); rx++) {
      const p = regionPlan(gen, rx, ry);
      for (const b of p.buildings) if (b.x <= x1 && b.x + b.w > x0 && b.y <= y1 && b.y + b.h > y0) out.buildings.push(b);
      for (const rd of p.roads) if (rd.x <= x1 && rd.x + rd.w > x0 && rd.y <= y1 && rd.y + rd.h > y0) out.roads.push(rd);
      for (const f of p.farms) if (f.lots.some(r => r.x <= x1 && r.x + r.w > x0 && r.y <= y1 && r.y + r.h > y0)) out.farms.push(f);
      for (const c of p.camps) if (c.tx + 4 >= x0 && c.tx - 4 <= x1 && c.ty + 4 >= y0 && c.ty - 4 <= y1) out.camps.push(c);
    }
  return out;
}

if (typeof module !== 'undefined') module.exports = { REGION, FURN, TEMPLATES, layoutBuilding, regionPlan, plansInRect, LOT_MARGIN };
