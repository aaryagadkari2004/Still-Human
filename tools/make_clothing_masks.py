#!/usr/bin/env python3
"""Builds a clothing mask for each zombie sprite sheet so the game can recolour
just the clothes. Writes assets/<sheet>_mask.png (red channel: 1 = top garment,
2 = bottom garment, 0 = leave alone).

How it decides, per frame:
  * skin (pale/greenish), eyes and teeth (very bright), outline (very dark) and
    blood (small amounts of saturated red) are never clothing;
  * hair: the colours found on the crown of the head (top of the front-facing
    frames) form the hair palette, and hair is every pixel of those colours that
    connects back to the top of the head, so long hair down the back is kept too;
  * everything else is clothing, split into top/bottom by height on the body.
Check the result with --preview (writes /tmp/mask_preview_<sheet>.png).

Usage: python3 tools/make_clothing_masks.py zombie_walker_v1.png [...] [--preview] [--hooded]
--hooded: the head is covered by clothing (a hood), so the head is recoloured too
and there's no hair to protect."""
import sys, colorsys, pathlib
from collections import Counter, deque
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
FRONT_ROWS = (0, 1)   # idle south, walk south
WAIST = 0.6           # fraction of body height where tops end and bottoms begin
HEAD = 0.19           # above this is the head: never clothing
FEET = 0.92           # below this are the shoes: left as drawn

def hls(col):
    h, l, s = colorsys.rgb_to_hls(*[v / 255 for v in col]); return h * 360, l, s

def is_fixed(col, n_px, total):
    hue, l, s = hls(col)
    if l < 0.07: return True                                   # outline
    if l > 0.80 and s < 0.5: return True                       # eyes / teeth
    if 50 <= hue <= 140 and s > 0.06 and l > 0.22: return True  # zombie skin
    if 45 <= hue <= 125 and s > 0.1 and l > 0.12: return True   # zombie skin in shadow
    if 20 <= hue < 50 and s < 0.25 and l > 0.55: return True   # pale skin highlights
    if (hue < 12 or hue > 345) and s > 0.35 and n_px < total * 0.02: return True  # blood
    return False

def frames(a):
    H, W = a.shape[:2]
    for r in range(H // 64):
        for c in range(W // 64):
            yield r, c, a[r*64:(r+1)*64, c*64:(c+1)*64]

def build(path, hooded=False):
    a = np.array(Image.open(path).convert('RGBA'))
    px = a[a[..., 3] > 0][:, :3]
    counts = Counter(map(tuple, px.tolist())); total = len(px)
    fixed = {col for col, n in counts.items() if is_fixed(col, n, total)}
    # Hair palette from the crown of front-facing frames.
    crown = Counter()
    for r, c, f in frames(a):
        if r not in FRONT_ROWS: continue
        ys, xs = np.where(f[..., 3] > 0); y0, y1 = ys.min(), ys.max()
        for y, x in zip(ys, xs):
            if y - y0 < (y1 - y0) * 0.09:
                col = tuple(int(v) for v in f[y, x, :3])
                if col not in fixed: crown[col] += 1
    hair_pal = set() if hooded else {col for col, n in crown.items() if n >= 3}
    mask = np.zeros(a.shape[:2], np.uint8)
    for r, c, f in frames(a):
        vis = f[..., 3] > 0
        if not vis.any(): continue
        ys, xs = np.where(vis); y0, y1 = ys.min(), ys.max(); hgt = max(1, y1 - y0)
        col = lambda y, x: tuple(int(v) for v in f[y, x, :3])
        # Hair: flood from the top rows through hair-palette pixels (and outline between them).
        hair = np.zeros((64, 64), bool); q = deque()
        for y in range(y0, y0 + max(3, int(hgt * 0.1))):
            for x in range(64):
                if vis[y, x] and col(y, x) in hair_pal: hair[y, x] = True; q.append((y, x))
        while q:
            y, x = q.popleft()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < 64 and 0 <= nx < 64 and not hair[ny, nx] and vis[ny, nx] and col(ny, nx) in hair_pal:
                    hair[ny, nx] = True; q.append((ny, nx))
        for y, x in zip(ys, xs):
            cc = col(y, x)
            if cc in fixed or hair[y, x]: continue
            ry = (y - y0) / hgt
            if (ry < HEAD and not hooded) or ry > FEET: continue   # head and shoes keep their colours
            mask[r*64 + y, c*64 + x] = 2 if ry > WAIST else 1
    return a, mask

def main():
    for name in [x for x in sys.argv[1:] if not x.startswith('--')]:
        p = ROOT / 'assets' / name
        a, mask = build(p, '--hooded' in sys.argv)
        out = np.zeros(a.shape, np.uint8); out[..., 0] = mask; out[..., 3] = (mask > 0) * 255
        Image.fromarray(out).save(p.with_name(p.stem + '_mask.png'))
        if '--preview' in sys.argv:
            prev = a.copy(); prev[mask == 1] = [255, 0, 255, 255]; prev[mask == 2] = [0, 230, 255, 255]
            img = Image.fromarray(np.concatenate([a, prev], 1)); bg = Image.new('RGBA', img.size, (40, 40, 40, 255)); bg.alpha_composite(img)
            bg.convert('RGB').save(f'/tmp/mask_preview_{p.stem}.png')
        print(name, 'top', int((mask == 1).sum()), 'bottom', int((mask == 2).sum()))

if __name__ == '__main__':
    main()
