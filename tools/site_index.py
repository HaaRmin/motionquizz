#!/usr/bin/env python3
"""Write web/index.json: the logo and background files the web page can choose from.

A static web page cannot list a folder, so this list is made here, in the same order quiz_gen.py uses
(sorted paths), so the page picks the same logo and background for a seed. The GitHub Pages workflow runs
it on every push; run it by hand after adding or removing a logo or background to test the page locally.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMAGE_TYPES = (".png", ".webp", ".jpg", ".jpeg", ".avif", ".svg")


def files(folder):
    d = ROOT / folder
    return [p.relative_to(ROOT).as_posix() for p in sorted(d.glob("*")) if p.suffix.lower() in IMAGE_TYPES] if d.is_dir() else []


def main():
    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    index = {"logos": files(cfg.get("logos", "assets/logos")), "backgrounds": files(cfg.get("backgrounds", "assets/backgrounds"))}
    # the small picture of each one for the page's pickers (tools/make_thumbs.sh), where there is one
    thumbs = ROOT / "assets" / "thumbs"
    index["thumbs"] = {f: f"assets/thumbs/{Path(f).stem}.jpg" for f in index["logos"] + index["backgrounds"]
                       if (thumbs / f"{Path(f).stem}.jpg").exists()}
    out = ROOT / "web" / "index.json"
    out.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"web/index.json: {len(index['logos'])} logos, {len(index['backgrounds'])} backgrounds, {len(index['thumbs'])} thumbnails")


if __name__ == "__main__":
    main()
