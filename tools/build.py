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
    "player": "player_v2.png",
    "grass": "grass_v2.png",
    "ground": "ground_v1.png",
    "edgeWater": "edge_water_v1.png",
    "edgeDirt": "edge_dirt_v1.png",
    "water": "water_v1.png",
    "objects": "objects_v1.png",
    "zWalker": "zombie_walker_v1.png",
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
