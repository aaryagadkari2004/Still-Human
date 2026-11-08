#!/usr/bin/env python3
"""Builds a single self-contained index.html from src/ and assets/.

All art is embedded, so index.html works on its own: double-click it,
or serve it with GitHub Pages.

Usage: python3 tools/build.py
"""
import base64, datetime, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Game name for each image -> file in assets/. Swap a file here to update art.
ASSETS = {
    "player": "player_v4.png",
    "grass": "grass_v2.png",
    "ground": "ground_v1.png",
    "edgeWater": "edge_water_v1.png",
    "edgeDirt": "edge_dirt_v1.png",
    "water": "water_v1.png",
    "objects": "objects_v1.png",
    "zWalker": "zombie_walker_v1.png",
    "zWalker2": "zombie_walker2_v1.png",
    "zWalker3": "zombie_walker3_v1.png",
    "zWalker4": "zombie_walker4_v1.png",
    "zWalker5": "zombie_walker5_v1.png",
    "zWalkerMask": "zombie_walker_v1_mask.png",
    "zWalker2Mask": "zombie_walker2_v1_mask.png",
    "zWalker3Mask": "zombie_walker3_v1_mask.png",
    "zWalker4Mask": "zombie_walker4_v1_mask.png",
    "zWalker5Mask": "zombie_walker5_v1_mask.png",
    "invPanel": "inventory_mock_v1.png",
    "bodyLabels": "body_labels.png",
}

def data_uri(path):
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()

def main():
    tpl = (ROOT / "src" / "index.template.html").read_text()
    assets = {k: data_uri(ROOT / "assets" / v) for k, v in ASSETS.items()}
    build = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    out = (tpl.replace("{{ASSETS}}", json.dumps(assets))
              .replace("{{WORLD}}", (ROOT / "src" / "world.js").read_text())
              .replace("{{GAME}}", (ROOT / "src" / "game.js").read_text())
              .replace("{{BUILD}}", build))
    (ROOT / "index.html").write_text(out)
    print(f"index.html written ({len(out) // 1024} KB)")

if __name__ == "__main__":
    main()
