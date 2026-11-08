#!/usr/bin/env python3
"""Finds each body part in the inventory mockup's figure and writes
assets/body_labels.png: same size as the mockup, red channel = part id
(1 head, 2 torso, 3 R arm, 4 L arm, 5 R hand, 6 L hand, 7 R leg, 8 L leg,
9 R foot, 10 L foot; 0 = not part of the figure). The figure faces the
viewer, so the player's right side is on the left of the image.
Re-run this if the figure in the mockup changes."""
import sys, pathlib
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = ROOT / "assets" / (sys.argv[1] if len(sys.argv) > 1 else "inventory_mock_v1.png")
im = np.array(Image.open(src).convert("RGB")).astype(int)
H, W, _ = im.shape
x0, y0, x1, y1 = 20, 68, 137, 185  # body panel interior
fills = [(48, 74, 54), (34, 57, 45)]
outline = (139, 183, 126)

fill = np.zeros((H, W), bool)
for c in fills: fill |= (np.abs(im - c).sum(2) == 0)
fill[:, :x0] = fill[:, x1:] = False; fill[:y0] = fill[y1:] = False
line = (np.abs(im - outline).sum(2) == 0)
line[:, :x0] = line[:, x1:] = False; line[:y0] = line[y1:] = False

lab, n = ndimage.label(fill)
sizes = ndimage.sum(fill, lab, range(1, n + 1))
keep = [i + 1 for i, s in enumerate(sizes) if s > 15]
cents = {i: ndimage.center_of_mass(fill, lab, i) for i in keep}
cx_mid = np.mean([c[1] for c in cents.values()])

def name(i):
    cy, cx = cents[i]; side = 'R' if cx < cx_mid else 'L'
    return cy, cx, side, sizes[i - 1]
info = {i: name(i) for i in keep}
if "-v" in sys.argv: print(cx_mid, {i: tuple(round(float(v),1) if not isinstance(v,str) else v for v in info[i]) for i in keep})
# Sort by vertical position to classify.
order = sorted(keep, key=lambda i: info[i][0])
ids = {}
head = order[0]; ids[head] = 1
rest = [i for i in keep if i != head]
torso = max(rest, key=lambda i: info[i][3] if abs(info[i][1] - cx_mid) < 8 else 0); ids[torso] = 2
rest = [i for i in rest if i != torso]
side = [i for i in rest if abs(info[i][1] - cx_mid) > 15]   # arms and hands
center = [i for i in rest if i not in side]                  # legs and feet
for s, a, h in (('R', 3, 5), ('L', 4, 6)):
    grp = sorted([i for i in side if info[i][2] == s], key=lambda i: info[i][0])
    ids[grp[0]] = a; ids[grp[1]] = h
for s, l, f in (('R', 7, 9), ('L', 8, 10)):
    grp = sorted([i for i in center if info[i][2] == s], key=lambda i: info[i][0])
    ids[grp[0]] = l; ids[grp[1]] = f
assert len(set(ids.values())) == 10, ids

out = np.zeros((H, W), np.uint8)
for i, pid in ids.items(): out[lab == i] = pid
# Give each outline pixel to the nearest part.
dist, (iy, ix) = ndimage.distance_transform_edt(out == 0, return_indices=True)
ly, lx = np.where(line)
out[ly, lx] = out[iy[ly, lx], ix[ly, lx]]
rgba = np.zeros((H, W, 4), np.uint8); rgba[..., 0] = out; rgba[..., 3] = (out > 0) * 255
Image.fromarray(rgba).save(ROOT / "assets" / "body_labels.png")
print("parts:", sorted(ids.values()))
