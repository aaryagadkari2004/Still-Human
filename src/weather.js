// ---- Weather ---------------------------------------------------------------------------------------
// The sky changes every few minutes: clear, overcast, rain, thunderstorms and fog. Changes blend
// in over about half a minute. Everything is drawn on the low-res game buffer so it stays pixel art.
//   overcast  the world goes a little grey and dim
//   rain      falling streaks with small splashes; the patter covers sound, so zombies hear less far
//   storm     heavy, wind-blown rain, darker, and lightning: the whole screen flashes white for a
//             moment (it lights up the night too). Lightning never strikes the ground.
//   fog       drifting banks of fog: clear right around you, thick further out; zombies see less far
const WEATHERS = {
  clear:    { weight: 42, len: [240, 480], dim: 0,    rain: 0,   fog: 0,    hear: 1,    sight: 1 },
  overcast: { weight: 20, len: [180, 360], dim: 0.14, rain: 0,   fog: 0,    hear: 1,    sight: 1 },
  rain:     { weight: 17, len: [150, 330], dim: 0.22, rain: 0.5, fog: 0.08, hear: 0.75, sight: 0.85 },
  storm:    { weight: 7,  len: [120, 240], dim: 0.34, rain: 1,   fog: 0.12, hear: 0.6,  sight: 0.75, lightning: true },
  fog:      { weight: 14, len: [150, 300], dim: 0.1,  rain: 0,   fog: 1,    hear: 1,    sight: 0.55 },
};
const W_BLEND = 30;    // seconds to change from one weather to the next
let weather = { type: 'clear', prev: 'clear', t: W_BLEND, left: 300, wind: 0.3 };
let flash = 0, flashQueue = [], nextBolt = 10;
let drops = [], splashes = [], lastCam = null;

function pickWeather(not) {
  const fogBoost = nightness() > 0.3 || dawnDuskGlow() > 0.2 ? 1.8 : 1;   // fog likes mornings and nights
  const w = Object.entries(WEATHERS).filter(([k]) => k !== not).map(([k, v]) => [k, v.weight * (k === 'fog' ? fogBoost : 1)]);
  let r = Math.random() * w.reduce((s, [, v]) => s + v, 0);
  for (const [k, v] of w) { r -= v; if (r <= 0) return k; }
  return 'clear';
}
function newWeather(type) {
  const W = WEATHERS[type];
  return { type, prev: type, t: W_BLEND, left: W.len[0] + Math.random() * (W.len[1] - W.len[0]), wind: (Math.random() * 2 - 1) * 0.6 };
}
function setWeather(type) {   // blends from the current weather into a new one
  const W = WEATHERS[type];
  weather = { type, prev: weather.type, t: 0, left: W.len[0] + Math.random() * (W.len[1] - W.len[0]),
    wind: type === 'storm' ? (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.4) : (Math.random() * 2 - 1) * 0.5 };
}
// A weather property, blended between the old and new weather.
function wx(key) {
  const a = WEATHERS[weather.prev][key], b = WEATHERS[weather.type][key];
  const p = Math.min(1, weather.t / W_BLEND);
  return a + (b - a) * p;
}
function weatherHearMul() { return wx('hear'); }
function weatherSightMul() { return wx('sight'); }

function updateWeather(dt) {
  weather.t += dt; weather.left -= dt;
  if (weather.left <= 0) setWeather(pickWeather(weather.type === 'clear' ? 'clear' : null));
  // Lightning during storms: one bright flash, sometimes a flicker or two right after it.
  flash = Math.max(0, flash - dt * 3.2);
  while (flashQueue.length && flashQueue[0] <= 0) { flashQueue.shift(); flash = 0.75 + Math.random() * 0.25; }
  flashQueue = flashQueue.map(t => t - dt);
  if (weather.type === 'storm' && weather.t > W_BLEND * 0.6) {
    nextBolt -= dt;
    if (nextBolt <= 0) {
      nextBolt = 7 + Math.random() * 20;
      flashQueue = [0, ...(Math.random() < 0.6 ? [0.12 + Math.random() * 0.1] : []), ...(Math.random() < 0.3 ? [0.4 + Math.random() * 0.2] : [])];
    }
  }
}

// ---- Drawing ----
// Fog texture: soft blobs of value noise, quantised into a few alpha steps so it reads as pixel art.
const FOG_S = 256;
let fogTex = null;
function makeFogTexture() {
  const S = FOG_S, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), im = g.createImageData(S, S);
  // Tileable value noise: random values on a lattice that wraps around, smoothly interpolated.
  const layer = (cells, seed) => {
    const v = (i, j) => hash01(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed);
    return (x, y) => {
      const fx = x / S * cells, fy = y / S * cells, i = Math.floor(fx), j = Math.floor(fy);
      const u = smooth(fx - i), w = smooth(fy - j);
      const a = v(i, j) + (v(i + 1, j) - v(i, j)) * u, b = v(i, j + 1) + (v(i + 1, j + 1) - v(i, j + 1)) * u;
      return a + (b - a) * w;
    };
  };
  const L = [[layer(4, 11), 0.55], [layer(8, 23), 0.3], [layer(16, 37), 0.15]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0; for (const [f, a] of L) v += f(x, y) * a;
    const lvl = Math.max(0, Math.min(4, Math.floor((v - 0.25) * 9)));
    const i = (y * S + x) * 4;
    im.data[i] = 196; im.data[i + 1] = 204; im.data[i + 2] = 210; im.data[i + 3] = [25, 70, 115, 155, 190][lvl];
  }
  g.putImageData(im, 0, 0);
  return c;
}
const fogC = document.createElement('canvas'), fogG = fogC.getContext('2d');
let fogPattern = null;
// Rain doesn't fall indoors: when the player is inside, the house interior is cut out.
function clipOutInterior(g, camX, camY) {
  if (!insideB) return;
  const l = bLines(insideB);
  g.beginPath(); g.rect(0, 0, BW, BH);
  g.rect(l.L - 16 - camX, l.T - 16 - WALL_H - camY, l.R - l.L + 32, l.B - l.T + WALL_H + 32);
  g.clip('evenodd');
}
let wLastT = 0;
function renderWeather(camX, camY) {
  const dt = wLastT ? Math.min(0.05, (frameTime - wLastT) / 1000) : 0; wLastT = frameTime;
  const dim = wx('dim'), rain = wx('rain'), fog = wx('fog');
  // Clouds: grey the world down.
  if (dim > 0.01) {
    bctx.globalCompositeOperation = 'multiply';
    bctx.fillStyle = `rgba(118,126,140,${dim})`; bctx.fillRect(0, 0, BW, BH);
    bctx.globalCompositeOperation = 'source-over';
  }
  bctx.save(); clipOutInterior(bctx, camX, camY);
  if (fog > 0.01) {
    if (!fogTex) { fogTex = makeFogTexture(); fogPattern = fogG.createPattern(fogTex, 'repeat'); }
    if (fogC.width !== BW || fogC.height !== BH) { fogC.width = BW; fogC.height = BH; fogPattern = fogG.createPattern(fogTex, 'repeat'); }
    const g = fogG;
    g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, BW, BH);
    // Two layers drifting at different speeds, anchored to the world (they don't follow the camera).
    const t = frameTime / 1000;
    for (const [sp, a, off] of [[3, 0.85, 0], [7, 0.55, 97]]) {
      const ox = Math.round(-camX - t * sp * (weather.wind >= 0 ? 1 : -1)) + off, oy = Math.round(-camY - t * sp * 0.3) + off * 2;
      g.save(); g.translate(((ox % FOG_S) + FOG_S) % FOG_S - FOG_S, ((oy % FOG_S) + FOG_S) % FOG_S - FOG_S);
      g.globalAlpha = a * fog; g.fillStyle = fogPattern; g.fillRect(0, 0, BW + FOG_S * 2, BH + FOG_S * 2);
      g.restore();
    }
    // A thin even haze over everything, thicker with distance.
    g.globalAlpha = 0.35 * fog; g.fillStyle = 'rgb(190,198,206)'; g.fillRect(0, 0, BW, BH); g.globalAlpha = 1;
    // Clear around the player.
    g.globalCompositeOperation = 'destination-out';
    const px = player.x - camX, py = player.y - 18 - camY, r = 7 * TILE;
    const gr = g.createRadialGradient(px, py, 0, px, py, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.92)'); gr.addColorStop(0.35, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
    g.globalCompositeOperation = 'source-over';
    bctx.drawImage(fogC, 0, 0);
  }
  // Rain: drops live in world space so they stay put when the camera moves.
  const want = Math.round(rain * 420 * (BW * BH) / (480 * 270));
  while (drops.length < want) drops.push(newDrop(camX, camY, true));
  if (drops.length > want) drops.length = want;
  if (drops.length) {
    const wind = weather.wind, heavy = rain > 0.7;
    bctx.fillStyle = heavy ? 'rgba(178,196,220,0.55)' : 'rgba(178,196,220,0.45)';
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      d.y += d.v * dt; d.x += d.v * wind * 0.35 * dt;
      const sx = d.x - camX, sy = d.y - camY;
      if (d.y >= d.gy) {   // hit the ground
        if (Math.random() < 0.5) splashes.push({ x: d.x, y: d.gy, t: 0 });
        drops[i] = newDrop(camX, camY, false); continue;
      }
      if (sx < -20 || sx > BW + 20 || sy > BH + 20) { drops[i] = newDrop(camX, camY, false); continue; }
      // A slanted 1px streak, drawn pixel by pixel.
      for (let k = 0; k < d.len; k++) bctx.fillRect(Math.round(sx - wind * 0.35 * k), Math.round(sy - k), 1, 1);
    }
    // Splashes: a two-frame pixel burst.
    bctx.fillStyle = 'rgba(200,214,232,0.6)';
    splashes = splashes.filter(s => (s.t += dt) < 0.16);
    for (const s of splashes) {
      const x = Math.round(s.x - camX), y = Math.round(s.y - camY);
      if (s.t < 0.08) bctx.fillRect(x, y - 1, 1, 1);
      else { bctx.fillRect(x - 2, y - 1, 1, 1); bctx.fillRect(x + 2, y - 1, 1, 1); bctx.fillRect(x, y - 2, 1, 1); }
    }
  } else splashes.length = 0;
  bctx.restore();
}
function newDrop(camX, camY, anywhere) {
  // gy: where on screen this drop lands (somewhere in view), y starts above it.
  const gy = camY + Math.random() * (BH + 40);
  const v = 300 + Math.random() * 120;
  const fall = anywhere ? Math.random() * 120 : 60 + Math.random() * 120;
  return { x: camX - 30 + Math.random() * (BW + 60) - weather.wind * 0.35 * fall, y: gy - fall, gy, v, len: 4 + Math.floor(Math.random() * 4) };
}
function renderLightning() {
  if (flash <= 0.01) return;
  bctx.fillStyle = `rgba(235,240,255,${0.38 * flash})`; bctx.fillRect(0, 0, BW, BH);
}
function saveWeather() { return { type: weather.type, left: Math.round(weather.left), wind: weather.wind }; }
function loadWeather(w) {
  weather = w && WEATHERS[w.type] ? { type: w.type, prev: w.type, t: W_BLEND, left: w.left || 120, wind: w.wind || 0 } : newWeather('clear');
  drops = []; splashes = []; flash = 0; flashQueue = [];
}
