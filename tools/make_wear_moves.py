#!/usr/bin/env python3
"""Generates worn-item frames for the jump / swim / crouch rows (player_moves sheet),
so clothing, headwear and backpacks don't need extra hand-drawn sheets.

  * Tops are made by recolouring the character's own T-shirt in each new frame with the
    top's colours (and, for long-sleeved tops, the upper arms too, leaving the hands).
  * Headwear and backpacks are rigid: the standing frame for the same direction is moved
    to follow the head (hats) or the torso (backpacks), and cut off at the swimmer's waterline.

Usage: python3 tools/make_wear_moves.py      (re-run whenever a worn item or the sheets change)
"""
import pathlib, colorsys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
A = ROOT / 'assets'
F = 64
BASE = np.array(Image.open(A / 'player_v4.png').convert('RGBA'))
MOVES = np.array(Image.open(A / 'player_moves_v1.png').convert('RGBA'))
IDLE_ROW = {'S': 0, 'E': 6, 'N': 5, 'W': 7}
DIRS = ['S', 'E', 'N', 'W']                          # row order inside each block of 4
SWIM_ROWS = range(4, 8)

# kind: top (long sleeves?), hat, bag
WEARS = {
    'wear_hoodie_v1.png': ('top', True), 'wear_leatherjacket_v1.png': ('top', True),
    'wear_wintercoat_v1.png': ('top', True), 'wear_utilityvest_v1.png': ('top', False),
    'wear_beanie_v1.png': ('hat', None), 'wear_bikehelmet_v1.png': ('hat', None),
    'wear_hardhat_v1.png': ('hat', None), 'wear_motohelmet_v1.png': ('hat', None),
    'wear_militaryhelmet_v1.png': ('hat', None),
    'wear_bag_small_v1.png': ('bag', None), 'wear_bag_medium_v1.png': ('bag', None), 'wear_bag_large_v1.png': ('bag', None),
}

def frame(sheet, r, c): return sheet[r * F:(r + 1) * F, c * F:(c + 1) * F]
def hls(px): return colorsys.rgb_to_hls(*(px[:3] / 255.0))
def _shirt_palette():
    # The T-shirt's colours: those that (almost) only appear where a hoodie covers the body.
    hood = np.array(Image.open(A / 'wear_hoodie_v1.png').convert('RGBA'))
    under, total = {}, {}
    for y in range(BASE.shape[0]):
        for x in range(BASE.shape[1]):
            if not BASE[y, x, 3]: continue
            col = tuple(int(v) for v in BASE[y, x, :3])
            total[col] = total.get(col, 0) + 1
            if hood[y, x, 3]: under[col] = under.get(col, 0) + 1
    pal = set()
    for col, n in total.items():
        h, l, s = colorsys.rgb_to_hls(*[v / 255 for v in col])
        skinish = 10 <= h * 360 <= 40 and s > 0.25 and l > 0.25
        if not skinish and l > 0.08 and under.get(col, 0) / n > 0.75 and n >= 4: pal.add(col)
    return pal
SHIRT = _shirt_palette()
def is_shirt(px): return px[3] > 0 and tuple(int(v) for v in px[:3]) in SHIRT
def is_skin(px):
    h, l, s = hls(px); return px[3] > 0 and 10 <= h * 360 <= 40 and s > 0.25 and l > 0.25

def masks(fr):
    shirt = np.zeros((F, F), bool); skin = np.zeros((F, F), bool)
    for y in range(F):
        for x in range(F):
            if fr[y, x, 3]:
                if is_shirt(fr[y, x]): shirt[y, x] = True
                elif is_skin(fr[y, x]): skin[y, x] = True
    return shirt, skin

def head_anchor(fr):
    ys, xs = np.where(fr[..., 3] > 0)
    top = ys.min(); band = xs[ys < top + 6]
    return np.array([band.mean(), top])

def torso_anchor(fr):
    shirt, _ = masks(fr)
    if shirt.sum() < 5: return head_anchor(fr) + [0, 14]
    ys, xs = np.where(shirt); return np.array([xs.mean(), ys.min()])

def ramp_from(wear_fr):
    """The top's colours, darkest to lightest, weighted by how much each is used."""
    px = wear_fr[wear_fr[..., 3] > 0][:, :3].astype(float)
    lum = px.mean(1); order = np.argsort(lum)
    return px[order]

def recolor_top(fr, wear_idle, long_sleeves):
    out = np.zeros_like(fr)
    shirt, skin = masks(fr)
    if not shirt.any(): return out
    target = shirt.copy()
    if long_sleeves:
        # Upper arms: skin close to the shirt, below the face. Hands (further out) stay bare.
        ys, _ = np.where(shirt); shirt_top = ys.min()
        dist = ndimage.distance_transform_edt(~shirt)
        target |= skin & (dist <= 5) & (np.arange(F)[:, None] > shirt_top + 1)
    ramp = ramp_from(wear_idle)
    ramp = ramp[int(len(ramp) * 0.04):max(int(len(ramp) * 0.85), 2)]   # skip outline-black and bright trim (fur, zips)
    lum = fr[..., :3].astype(float).mean(2)
    arms = target & ~shirt
    # Shirt and arms are normalised separately (skin is much lighter than the shirt).
    for region, lo_t, hi_t in ((shirt, 0.0, 1.0), (arms, 0.15, 0.7)):
        if not region.any(): continue
        vals = lum[region]; lo, hi = np.percentile(vals, 3), np.percentile(vals, 97)
        for y, x in zip(*np.where(region)):
            t = 0.5 if hi <= lo else min(1, max(0, (lum[y, x] - lo) / (hi - lo)))
            t = lo_t + t * (hi_t - lo_t)
            c = ramp[int(t * (len(ramp) - 1))]
            out[y, x, :3] = c.astype(np.uint8); out[y, x, 3] = 255
    return out

def shift_into(src, dx, dy, clip_bottom=None):
    out = np.zeros_like(src)
    dx, dy = int(round(dx)), int(round(dy))
    ys, xs = np.where(src[..., 3] > 0)
    for y, x in zip(ys, xs):
        ny, nx = y + dy, x + dx
        if 0 <= ny < F and 0 <= nx < F and (clip_bottom is None or ny <= clip_bottom):
            out[ny, nx] = src[y, x]
    return out

def main():
    for name, (kind, long_sleeves) in WEARS.items():
        wear = np.array(Image.open(A / name).convert('RGBA'))
        out = np.zeros_like(MOVES)
        for r in range(MOVES.shape[0] // F):
            d = DIRS[r % 4]
            ref_body = frame(BASE, IDLE_ROW[d], 0); ref_wear = frame(wear, IDLE_ROW[d], 0)
            for c in range(4):
                fr = frame(MOVES, r, c)
                if not fr[..., 3].any(): continue
                ys, _ = np.where(fr[..., 3] > 0); waterline = ys.max() if r in SWIM_ROWS else None
                if kind == 'top':
                    o = recolor_top(fr, frame(wear, 0, 0), long_sleeves)
                elif kind == 'hat':
                    dxy = head_anchor(fr) - head_anchor(ref_body)
                    o = shift_into(ref_wear, dxy[0], dxy[1])
                else:
                    dxy = torso_anchor(fr) - torso_anchor(ref_body)
                    o = shift_into(ref_wear, dxy[0], dxy[1], waterline)
                out[r * F:(r + 1) * F, c * F:(c + 1) * F] = o
        dst = A / name.replace('_v1.png', '_moves_v1.png')
        Image.fromarray(out).save(dst)
        print('wrote', dst.name)

if __name__ == '__main__':
    main()
