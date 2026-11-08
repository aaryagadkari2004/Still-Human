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
};

// Floor plans. # wall, . floor, D outside door, d inside door, W window.
// Front doors are on the south (bottom) wall so they can be seen from outside.
// f: furniture [name, x, y] (top-left of its footprint). z: spots a resident zombie may stand.
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
  const isWallish = c => c === '#' || c === 'D' || c === 'd' || c === 'W';
  const openings = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = cells[y][x];
    if (c !== 'D' && c !== 'd' && c !== 'W') continue;
    const horiz = (x > 0 && isWallish(cells[y][x - 1])) || (x < W - 1 && isWallish(cells[y][x + 1]));
    openings.push({ x, y, kind: c === 'W' ? 'window' : 'door', outer: c !== 'd', horiz, south: y === H - 1, north: y === 0 });
  }
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
  plan = { buildings: [], roads: [] };
  const s = gen.seed ^ 0xb0b0;
  const r = hash01(rx, ry, s);
  const ox = rx * REGION, oy = ry * REGION;
  const rnd = (() => { let i = 0; return () => hash01(rx * 31 + (i++), ry * 17, s ^ 0x77); })();
  const waterFree = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (gen.field(x, y).isWater) return false;
    return true;
  };
  const tryPlace = (tpl, x, y) => {
    const t = TEMPLATES[tpl];
    if (!waterFree(x - LOT_MARGIN, y - LOT_MARGIN, t.w + LOT_MARGIN * 2, t.h + LOT_MARGIN * 2)) return false;
    const b = { id: `${rx},${ry},${plan.buildings.length}`, x, y, w: t.w, h: t.h, tpl,
      mirror: rnd() < 0.5, mat: Math.floor(rnd() * 3), roofVar: Math.floor(rnd() * 3),
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
      let cx = ox + 3;
      while (true) {
        const tpl = Math.floor(rnd() * TEMPLATES.length), t = TEMPLATES[tpl];
        if (cx + t.w > ox + REGION - 3) break;
        const setback = 1 + Math.floor(rnd() * 3);
        tryPlace(tpl, cx, roadY - setback - t.h);
        cx += t.w + 3 + Math.floor(rnd() * 4);
      }
    }
  } else if (r < 0.27) {
    // A lone cabin somewhere in the region.
    const tpl = rnd() < 0.6 ? Math.floor(rnd() * 2) : Math.floor(rnd() * TEMPLATES.length), t = TEMPLATES[tpl];
    const x = ox + 4 + Math.floor(rnd() * (REGION - 8 - t.w)), y = oy + 4 + Math.floor(rnd() * (REGION - 8 - t.h));
    tryPlace(tpl, x, y);
  }
  regionCache.set(key, plan);
  if (regionCache.size > 150) regionCache.delete(regionCache.keys().next().value);
  return plan;
}
// Buildings and roads overlapping a tile rectangle.
function plansInRect(gen, x0, y0, x1, y1) {
  const out = { buildings: [], roads: [] };
  for (let ry = Math.floor(y0 / REGION); ry <= Math.floor(y1 / REGION); ry++)
    for (let rx = Math.floor(x0 / REGION); rx <= Math.floor(x1 / REGION); rx++) {
      const p = regionPlan(gen, rx, ry);
      for (const b of p.buildings) if (b.x <= x1 && b.x + b.w > x0 && b.y <= y1 && b.y + b.h > y0) out.buildings.push(b);
      for (const rd of p.roads) if (rd.x <= x1 && rd.x + rd.w > x0 && rd.y <= y1 && rd.y + rd.h > y0) out.roads.push(rd);
    }
  return out;
}

if (typeof module !== 'undefined') module.exports = { REGION, FURN, TEMPLATES, layoutBuilding, regionPlan, plansInRect, LOT_MARGIN };
