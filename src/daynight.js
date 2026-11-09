// ---- Day and night -----------------------------------------------------------------------------------
// One full cycle: dawn (90 s) -> day (10 min) -> dusk (90 s) -> night (9 min), in real time while playing.
// At night everything far away fades into the dark; what's close to you stays fairly visible.
// Every night is a little different: some are pitch black, others have more moonlight.
// Fires, tents and houses give off light (houses through their windows and open doors).
const DAWN = 90, DAY = 600, DUSK = 90, NIGHT = 540;
const CYCLE = DAWN + DAY + DUSK + NIGHT;
const START_CLOCK = 30;          // a new game starts early in the morning, just after first light
let clock = START_CLOCK;         // seconds since the world began (saved)

function smooth(p) { p = Math.max(0, Math.min(1, p)); return p * p * (3 - 2 * p); }
function cycleTime() { return ((clock % CYCLE) + CYCLE) % CYCLE; }
function dayNumber() { return Math.floor(clock / CYCLE) + 1; }
// 0 in full daylight, 1 at night; ramps during dawn and dusk.
function nightness() {
  const t = cycleTime();
  if (t < DAWN) return 1 - smooth(t / DAWN);
  if (t < DAWN + DAY) return 0;
  if (t < DAWN + DAY + DUSK) return smooth((t - DAWN - DAY) / DUSK);
  return 1;
}
// Warm sunrise / sunset colour, strongest in the middle of dawn and dusk.
function dawnDuskGlow() {
  const t = cycleTime();
  if (t < DAWN) return Math.sin(Math.PI * t / DAWN);
  const d = t - DAWN - DAY;
  if (d >= 0 && d < DUSK) return Math.sin(Math.PI * d / DUSK);
  return 0;
}
function phaseName() {
  const t = cycleTime();
  return t < DAWN ? 'Dawn' : t < DAWN + DAY ? 'Day' : t < DAWN + DAY + DUSK ? 'Dusk' : 'Night';
}
// How dark tonight is (the night that's coming or in progress), from the world seed, so a reload
// gives the same night. dark: how black the far distance gets; see: how far you can make things out.
function tonight() {
  const t = cycleTime(), n = Math.floor(clock / CYCLE) + (t < DAWN ? -1 : 0);
  const r = hash01(n, 0x7a1, world ? world.seed : 0);
  return { dark: 0.8 + 0.17 * r, see: (10.5 - 5.5 * r) * TILE };
}

// ---- Light sources in view ----
// { x, y, r: radius px, i: strength 0-1, warm: tint strength }
function lightsInView(camX, camY) {
  const out = [], m = 6 * TILE, x0 = camX - m, y0 = camY - m, x1 = camX + BW + m, y1 = camY + BH + m;
  for (const o of objectsIn(x0, y0, x1, y1 + 2 * TILE)) {
    const k = KINDS[o.k];
    if (k.fire && fireLit(o)) {
      // Fires flicker: the radius wobbles a little, irregularly.
      const f = Math.sin(frameTime / 90 + o.ph) * 0.5 + Math.sin(frameTime / 37 + o.ph * 3) * 0.3;
      out.push({ x: o.x, y: o.y - 8, r: 5.2 * TILE + f * 6, i: 0.97, warm: 1 });
    } else if (k.name === 'tent') out.push({ x: o.x, y: o.y - 12, r: 2.4 * TILE, i: 0.6, warm: 0.6 });
  }
  for (const b of buildingsIn(x0, y0, x1, y1)) {
    const L = layoutBuilding(b);
    L.openings.forEach((o, i) => {
      if (!o.outer) return;
      const st = openingState(b, i);
      if (o.kind === 'window' && st === 'boarded') return;
      if (o.kind === 'door' && st === 'closed') return;
      const [cx, cy] = openingCenter(b, o), [nx, ny] = openingNormal(b, o);
      out.push({ x: cx + nx * 18, y: cy + ny * 18 + 6, r: (o.kind === 'door' ? 3 : 2.6) * TILE, i: 0.75, warm: 0.8 });
    });
    // A faint glow around the whole house.
    out.push({ x: (b.x + b.w / 2) * TILE, y: (b.y + b.h / 2) * TILE + 8, r: (Math.max(b.w, b.h) * 0.5 + 2) * TILE, i: 0.35, warm: 0.3 });
  }
  return out;
}

const nightC = document.createElement('canvas'), nightG = nightC.getContext('2d');
function renderNight(camX, camY) {
  const n = nightness(), glow = dawnDuskGlow();
  if (glow > 0.01) {
    // Sunrise / sunset: everything takes on a warm orange cast.
    bctx.globalCompositeOperation = 'multiply';
    bctx.fillStyle = `rgba(255,170,120,${0.45 * glow})`; bctx.fillRect(0, 0, BW, BH);
    bctx.globalCompositeOperation = 'source-over';
  }
  if (n < 0.01) return;
  const T = tonight(), dark = T.dark * n * (1 - 0.75 * flash);   // lightning lights up the night
  if (nightC.width !== BW || nightC.height !== BH) { nightC.width = BW; nightC.height = BH; }
  const g = nightG;
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, BW, BH);
  g.fillStyle = `rgba(5,8,22,${dark})`; g.fillRect(0, 0, BW, BH);
  g.globalCompositeOperation = 'destination-out';
  const hole = (x, y, r, i, mid) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(0,0,0,${i})`);
    if (mid) gr.addColorStop(mid[0], `rgba(0,0,0,${mid[1]})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  // What you can see around yourself: clear up close, fading out to tonight's distance.
  const px = player.x - camX, py = player.y - 18 - camY, near = 2.5 * TILE;
  hole(px, py, T.see, 0.85, [near / T.see, 0.72]);
  // Flashlight: a cone of light toward the mouse, plus a little spill around you.
  const fl = activeFlashlight();
  if (fl) {
    const reach = 8 * TILE * (fl.charge < 15 ? 0.4 + fl.charge / 25 : 1);   // dims as the batteries die
    const [mx, my] = mouseWorld(), ang = Math.atan2(my - (player.y - 18), mx - player.x), half = 0.42;
    const gr = g.createRadialGradient(px, py, 0, px, py, reach);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.8)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(px, py); g.arc(px, py, reach, ang - half, ang + half); g.closePath(); g.fill();
    hole(px, py, 1.6 * TILE, 0.5);
  }
  const lights = lightsInView(camX, camY);
  for (const L of lights) hole(L.x - camX, L.y - camY, L.r, L.i, [0.4, L.i * 0.75]);
  // Inside a house the lights are on.
  if (insideB) {
    const l = bLines(insideB);
    g.filter = 'blur(3px)'; g.fillStyle = 'rgba(0,0,0,0.85)';
    g.fillRect(l.L - 6 - camX, l.T - 6 - WALL_H - camY, l.R - l.L + 12, l.B - l.T + WALL_H + 16);
    g.filter = 'none';
  }
  g.globalCompositeOperation = 'source-over';
  bctx.drawImage(nightC, 0, 0);
  // Warm glow on top, so firelight and windows look orange rather than just "less dark".
  bctx.globalCompositeOperation = 'lighter';
  for (const L of lights) {
    const x = L.x - camX, y = L.y - camY, r = L.r * 0.85, a = 0.16 * L.warm * n;
    const gr = bctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,140,50,${a})`); gr.addColorStop(1, 'rgba(255,140,50,0)');
    bctx.fillStyle = gr; bctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  bctx.globalCompositeOperation = 'source-over';
}
