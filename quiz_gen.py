#!/usr/bin/env python3
"""HSK quiz animation generator - deterministic, no LLM involved.

Examples
  python quiz_gen.py kepes --level 1                 # next képes quiz from HSK 1, HTML only
  python quiz_gen.py szoveges --level 2 --mp4        # next szöveges quiz from HSK 2, HTML + MP4
  python quiz_gen.py kepes --level 1,2 --seed abc    # fixed seed: same output every time
  python quiz_gen.py szoveges --words 谢谢,不客气,对不起,没关系 --mp4
  python quiz_gen.py kepes --level 1 --dry-run       # only print which words it would pick

Same seed + same data files -> same words, same answer order, same video.
Without --seed the seed is "<kind>-L<level>-run<N>", where N counts earlier runs in history.json,
so successive runs walk through the list without repeats until it is used up.
"""
import argparse
import base64
import csv
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
KINDS = ("kepes", "szoveges")
ELIGIBLE_POS = {"n", "v", "a", "vn", "an", "t", "s", "f", "nz"}


def h(*parts) -> int:
    return int(hashlib.sha256("|".join(map(str, parts)).encode("utf-8")).hexdigest(), 16)


def load_config():
    cfg = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
    return cfg


def load_words(levels):
    overrides = {}
    with open(HERE / "data" / "overrides.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            overrides[row["han"].strip()] = row
    words, seen = [], set()
    for lv in levels:
        for w in json.loads((HERE / "data" / f"hsk{lv}.json").read_text(encoding="utf-8")):
            if w["han"] in seen:
                continue
            seen.add(w["han"])
            ov = overrides.get(w["han"])
            action = ((ov or {}).get("action") or "").strip()
            if action == "exclude":
                continue
            if ov and (ov.get("en") or "").strip():
                w = dict(w, en=ov["en"].strip())
            if ov and (ov.get("pinyin") or "").strip():  # the right reading where the source lists several
                w = dict(w, pinyin=ov["pinyin"].strip())
            w["eligible"] = action == "include" or (not w.get("multi") and bool(w["pos"]) and w["pos"][0] in ELIGIBLE_POS)
            words.append(w)
    return words


def group_questions(pool, n, seed, used, groups):
    """n questions from one set or topic of data/groups.csv: the groups are tried in the seed's order and the
    first with n unused words is taken; in it the words go in the seed's order, never two with the same English
    meaning or of one "same" group. Returns (words, group row), or (None, None) when no group has n words."""
    by_han = {w["han"]: w for w in pool}
    rows = sorted((r for r in groups["rows"] if r["kind"] in ("set", "topic")), key=lambda r: h(seed, "group", r["group"]))
    for row in rows:
        cands = sorted((by_han[x] for x in row["words"] if x in by_han and x not in used), key=lambda w: h(seed, w["han"]))
        chosen, glosses = [], set()
        for w in cands:
            if w["en"].lower() in glosses or any(w["han"] in groups["same"].get(c["han"], ()) for c in chosen):
                continue
            chosen.append(w)
            glosses.add(w["en"].lower())
            if len(chosen) == n:
                return chosen, row
    return None, None


def pick(kind, levels, words, n, seed, used, forced, groups=None):
    """The quiz's words and the group they come from (None for --words or when no group has enough words)."""
    by_han = {w["han"]: w for w in words}
    if forced:
        missing = [x for x in forced if x not in by_han]
        if missing:
            sys.exit(f"Not in the selected HSK level(s): {', '.join(missing)}")
        return [by_han[x] for x in forced], None
    pool = [w for w in words if w["eligible"] and (kind != "kepes" or 1 <= len(w["han"]) <= 4)]
    if groups and groups["rows"]:  # the three questions always share a group
        chosen, row = group_questions(pool, n, seed, used, groups)
        if not chosen and used:  # every group used up: start a new cycle
            used.clear()
            chosen, row = group_questions(pool, n, seed, used, groups)
        if chosen:
            return chosen, row
    order = sorted(pool, key=lambda w: h(seed, w["han"]))
    fresh = [w for w in order if w["han"] not in used]
    if len(fresh) < n:  # list used up: start a new cycle
        used.clear()
        fresh = order
    chosen, glosses = [], set()
    for w in fresh:  # no two questions with the same English prompt
        if w["en"].lower() in glosses:
            continue
        chosen.append(w)
        glosses.add(w["en"].lower())
        if len(chosen) == n:
            break
    return chosen, None


def load_groups():
    """data/groups.csv: the words each word shares a set or a topic with, and the words it must never be shown with.
    kind "set": natural alternatives (today / tomorrow / yesterday); "topic": a subject (Food and drink);
    "same": the same meaning, so never one as the other's wrong answer (爸爸 / 爸)."""
    groups = {"set": {}, "topic": {}, "same": {}, "rows": []}
    path = HERE / "data" / "groups.csv"
    if not path.exists():
        return groups
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            kind = (row.get("kind") or "").strip()
            words = [x.strip() for x in (row.get("words") or "").split(";") if x.strip()]
            groups["rows"].append({"group": (row.get("group") or "").strip(), "kind": kind,
                                   "label": (row.get("label") or "").strip(), "words": words})
            if kind in ("set", "topic", "same"):
                for x in words:
                    groups[kind].setdefault(x, set()).update(y for y in words if y != x)
    return groups


def distractor_levels(levels):
    """Wrong answers may come from the chosen levels and the ones below them (an HSK 2 learner knows HSK 1)."""
    top = max(int(x) for x in levels)
    return [str(i) for i in range(1, top + 1)]


def distractors(target, words, seed, groups, k=2):
    """k wrong answers, taken in this order until there are k: words of the same set, of the same topic, of the
    same word type and a similar length, then any word. Shared characters are allowed in the set and topic steps
    (上边 / 下边); never a word with the same English meaning or from the target's "same" group."""
    never = groups["same"].get(target["han"], set()) | {target["han"]}
    tchars, tlen, ten = set(target["han"]), len(target["han"]), target["en"].lower()
    tpos = target["pos"][:1]
    by_han = {w["han"]: w for w in words}
    order = lambda w: h(seed, target["han"], w["han"])  # noqa: E731
    mates = lambda kind: [by_han[x] for x in groups[kind].get(target["han"], ()) if x in by_han]  # noqa: E731
    tiers = [
        sorted(mates("set"), key=order),
        sorted(mates("topic"), key=order),
        sorted((w for w in words if w["pos"][:1] == tpos and abs(len(w["han"]) - tlen) <= 1 and not set(w["han"]) & tchars), key=order),
        sorted((w for w in words if not set(w["han"]) & tchars), key=lambda w: (abs(len(w["han"]) - tlen), order(w))),
    ]
    out, glosses = [], {ten}
    for tier in tiers:
        for w in tier:
            if (not w["eligible"] or w["han"] in never or w["en"].lower() in glosses or w in out
                    or any(w["han"] in groups["same"].get(o["han"], ()) for o in out)):
                continue
            out.append(w)
            glosses.add(w["en"].lower())
            if len(out) == k:
                return out
    return out


def data_uri(path: Path):
    mime = {".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
            ".avif": "image/avif", ".mp3": "audio/mpeg"}[path.suffix.lower()]
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def pick_logo(cfg, seed):
    """One logo from the folder in config.json "logos", chosen by the seed: same seed, same logo."""
    folder = HERE / cfg.get("logos", "assets/logos")
    files = sorted(p for p in folder.glob("*") if p.suffix.lower() in (".png", ".webp", ".jpg", ".jpeg", ".avif", ".svg"))
    return files[h(seed, "logo") % len(files)] if files else None


IMAGE_TYPES = (".png", ".webp", ".jpg", ".jpeg", ".avif")


def pick_background(cfg, seed, forced=None):
    """The background photo: --background if given, else config.json "background" (the default photo), else
    (or with --background auto) one from the folder in config.json "backgrounds", chosen by the seed
    (same seed, same background). None = the drawn lantern street."""
    if forced != "auto":
        forced = forced or cfg.get("background")
    if forced and forced != "auto":
        p = Path(forced)
        p = p if p.is_absolute() or p.exists() else HERE / forced
        if not p.exists():
            sys.exit(f"Background not found: {forced}")
        return p
    folder = HERE / cfg.get("backgrounds", "assets/backgrounds")
    files = sorted(p for p in folder.glob("*") if p.suffix.lower() in IMAGE_TYPES) if folder.is_dir() else []
    return files[h(seed, "background") % len(files)] if files else None


def voice_clips(cfg, kind, kcfg, items):
    """The spoken clips (made by tts/make_audio.py) for this quiz, as data URIs, or None when sound is off.
    question: the picture quiz's fixed question; per item: q = its question (text quiz), zh = the word in Mandarin."""
    acfg = cfg.get("audio") or {}
    man_path = HERE / "audio" / "manifest.json"
    if not acfg.get("enabled", True) or not man_path.exists():
        return None
    man = json.loads(man_path.read_text(encoding="utf-8"))

    def clip(group, key):
        entry = man.get(group, {}).get(key)
        if not entry or not (HERE / "audio" / entry["file"]).exists():
            print(f"  no audio for {key!r}: run tts/make_audio.py", file=sys.stderr)
            return None
        return data_uri(HERE / "audio" / entry["file"])

    out = {"question": clip("questions", kcfg["question"]) if kind == "kepes" else None, "items": []}
    for it in items:
        q = clip("questions", kcfg["question"].replace("{en}", it["en"])) if kind == "szoveges" else None
        out["items"].append({"q": q, "zh": clip("words", it["han"])})
    return out


def cat_images(cfg):
    """The cat's pose images as data URIs, or None when the cat is off (config.json "cat")."""
    cat = cfg.get("cat") or {}
    if not cat.get("enabled"):
        return None
    poses = {k: data_uri(HERE / v) for k, v in (cat.get("poses") or {}).items() if (HERE / v).exists()}
    return poses or None


def font_face(family, path: Path, text: str):
    """Subset a font to the characters used and embed it; needs fontTools (pip install fonttools)."""
    from fontTools import subset
    from fontTools.ttLib import TTCollection
    opts = subset.Options()
    opts.flavor = "woff"
    if path.suffix.lower() in (".ttc", ".otc"):
        coll = TTCollection(str(path))
        idx = next((i for i, f in enumerate(coll.fonts) if "SC" in f["name"].getDebugName(1)), 0)
        opts.font_number = idx
    font = subset.load_font(str(path), opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    with tempfile.NamedTemporaryFile(suffix=".woff", delete=False) as tmp:
        subset.save_font(font, tmp.name, opts)
        b64 = base64.b64encode(Path(tmp.name).read_bytes()).decode()
    Path(tmp.name).unlink()
    return f'@font-face {{ font-family:"{family}"; src:url(data:font/woff;base64,{b64}) format("woff"); font-weight:100 900; }}\n'


def find_font(arg, stem):
    if arg:
        return Path(arg)
    for ext in (".otf", ".ttf", ".ttc", ".woff", ".woff2"):
        p = HERE / "fonts" / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def render_mp4(html: Path, mp4: Path, fps: int, crf: int = 22):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("MP4 needs Playwright: pip install playwright && playwright install chromium")
    ffmpeg = shutil.which("ffmpeg") or sys.exit("MP4 needs ffmpeg on PATH (macOS: brew install ffmpeg)")
    with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
        page.goto(html.resolve().as_uri() + "?capture=1")
        page.evaluate("window.QUIZ_READY")
        dur = page.evaluate("window.DURATION")
        wav = Path(tmp) / "audio.wav"
        wav.write_bytes(base64.b64decode(page.evaluate("window.renderAudioWav()")))
        frames = int(round(dur * fps))
        proc = subprocess.Popen([ffmpeg, "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(fps),
                                 "-c:v", "mjpeg", "-i", "-", "-i", str(wav), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                                 "-crf", str(crf), "-preset", "medium", "-c:a", "aac", "-b:a", "192k", "-shortest",
                                 "-movflags", "+faststart", str(mp4)], stdin=subprocess.PIPE)
        for i in range(frames):
            page.evaluate(f"window.renderAt({i / fps})")
            proc.stdin.write(page.screenshot(type="jpeg", quality=93))
            if i % fps == 0:
                print(f"\r  frames {i}/{frames}", end="", file=sys.stderr, flush=True)
        proc.stdin.close()
        proc.wait()
        browser.close()
        print(f"\r  frames {frames}/{frames}", file=sys.stderr)
        if proc.returncode:
            sys.exit("ffmpeg failed")


def main():
    cfg = load_config()
    ap = argparse.ArgumentParser(description="Generate an HSK quiz animation (HTML, optional MP4).")
    ap.add_argument("kind", choices=KINDS, help="kepes = character card + pinyin reveal; szoveges = 3-option answer quiz")
    ap.add_argument("--level", default="1", help="HSK level(s): 1, 2 or 1,2")
    ap.add_argument("--n", type=int, help="number of questions (default from config.json)")
    ap.add_argument("--seed", help="fixed seed; same seed = same quiz")
    ap.add_argument("--words", help="comma-separated words to use instead of picking")
    ap.add_argument("--out", default=str(HERE / "out"), help="output folder")
    ap.add_argument("--mp4", action="store_true", help="also render MP4 (Playwright + ffmpeg)")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--crf", type=int, default=22, help="video quality: lower = better and bigger (18-26)")
    ap.add_argument("--han-font", help="font file for the big characters (default: fonts/han.*, else system Kaiti)")
    ap.add_argument("--ui-font", help="font file for the other text (default: fonts/ui.*, else system font)")
    ap.add_argument("--dry-run", action="store_true", help="print the pick, write nothing")
    ap.add_argument("--no-history", action="store_true", help="do not read or update history.json")
    ap.add_argument("--background", help="background image to use (default: config.json \"background\"; 'auto': one from assets/backgrounds/, by the seed)")
    a = ap.parse_args()

    levels = [x.strip() for x in a.level.split(",") if x.strip()]
    kcfg = cfg[a.kind]
    n = a.n or kcfg["questions"]
    key = f"{a.kind}-L{'+'.join(levels)}"
    hist_path = HERE / "history.json"
    hist = {} if a.no_history or not hist_path.exists() else json.loads(hist_path.read_text(encoding="utf-8"))
    entry = hist.setdefault(key, {"runs": 0, "used": []})
    seed = a.seed or f"{key}-run{entry['runs']}"
    used = set(entry["used"])

    words = load_words(levels)
    pool, groups = load_words(distractor_levels(levels)), load_groups()  # wrong answers: these levels and the ones below
    forced = [x.strip() for x in a.words.split(",")] if a.words else None
    chosen, group = pick(a.kind, levels, words, n, seed, used, forced, groups)

    items = []
    for w in chosen:
        item = {"han": w["han"], "pinyin": w["pinyin"], "en": w["en"]}
        if a.kind == "szoveges":
            opts = distractors(w, pool, seed, groups)
            pos = h(seed, w["han"], "pos") % (len(opts) + 1)
            opts.insert(pos, w)
            item["options"] = [{"han": o["han"], "pinyin": o["pinyin"], "en": o["en"]} for o in opts]
            item["correct"] = pos
        items.append(item)

    run_no = entry["runs"] + 1
    name = f"{a.kind}_hsk{'-'.join(levels)}_{run_no:03d}" if not a.seed else f"{a.kind}_hsk{'-'.join(levels)}_{a.seed}"
    logo = pick_logo(cfg, seed)
    bg = pick_background(cfg, seed, a.background)
    manifest = {"name": name, "kind": a.kind, "levels": levels, "seed": seed, "group": group["label"] if group else None,
                "logo": logo.name if logo else None,
                "background": bg.name if bg else None, "items": items}
    print(json.dumps(manifest, ensure_ascii=False, indent=1))
    if a.dry_run:
        return

    quiz = {"kind": a.kind, "question": kcfg["question"], "count": kcfg["countdown"], "reveal": kcfg["reveal"],
            "follow": cfg["follow"]["enabled"], "outro": cfg["follow"]["seconds"], "followText": cfg["follow"]["text"],
            "logo": data_uri(logo) if logo else None, "background": data_uri(bg) if bg else None, "cat": cat_images(cfg),
            "voice": voice_clips(cfg, a.kind, kcfg, items), "items": items}

    text = "".join({c for it in items for o in it.get("options", [it]) for c in o["han"] + o["pinyin"] + o["en"]})
    text += kcfg["question"] + cfg["follow"]["text"] + "0123456789()"
    faces = ""
    for family, arg, stem in (("QuizHan", a.han_font, "han"), ("QuizUI", a.ui_font, "ui")):
        fp = find_font(arg, stem)
        if fp:
            faces += font_face(family, fp, text)

    tpl = (HERE / "template.html").read_text(encoding="utf-8")
    html = (tpl.replace("__TITLE__", name)
               .replace("/*FONTFACES*/", faces)
               .replace("/*QUIZDATA*/null", json.dumps(quiz, ensure_ascii=False).replace("</", "<\\/")))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    html_path = out / f"{name}.html"
    html_path.write_text(html, encoding="utf-8")
    (out / f"{name}.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"HTML: {html_path}", file=sys.stderr)

    mp4 = out / f"{name}.mp4"
    if a.mp4:
        render_mp4(html_path, mp4, a.fps, a.crf)
        print(f"MP4:  {mp4}", file=sys.stderr)
    latest = dict(manifest, html=str(html_path), mp4=str(mp4) if a.mp4 else None, run=run_no)
    (out / "latest.json").write_text(json.dumps(latest, ensure_ascii=False, indent=1), encoding="utf-8")

    if not a.no_history and not a.seed and not forced:
        entry["runs"] = run_no
        entry["used"] = sorted(used | {w["han"] for w in chosen})
        hist_path.write_text(json.dumps(hist, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
