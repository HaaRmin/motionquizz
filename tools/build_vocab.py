#!/usr/bin/env python3
"""Build data/hsk<N>.json from the drkameleon/complete-hsk-vocabulary dataset (MIT).

Raw files: wordlists/exclusive/new/<N>.json  (HSK 3.0, words new at that level).
Usage:  python tools/build_vocab.py raw/new1.json raw/new2.json
Each output entry: {"han": "饭店", "pinyin": "fàndiàn", "en": "restaurant", "pos": ["n"]}
The cleaning is rule-based and deterministic; fix individual glosses in data/overrides.csv.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BAD = re.compile(r"variant of|surname|particle|classifier|abbr|CL:|used in|see |interj|onom|"
                 r"pr\.|old |idiom|nickname|name of|grammatical|prefix|suffix|measure word|"
                 r"indicating|expressing|modal|structural", re.I)
VOWEL = "aāáǎàoōóǒòeēéěè"
MAX_EN = 28


def clean_meaning(m: str):
    for part in m.split(";"):
        if BAD.search(part):
            continue
        g = re.sub(r"\([^)]*\)", "", part)
        g = re.sub(r"\s+", " ", g).strip(" ,.")
        if not g or not re.fullmatch(r"[A-Za-z0-9 ,.'/-]+", g) or len(g) > MAX_EN:
            continue
        return g
    return None


def join_pinyin(p: str) -> str:
    syl = p.split()
    out = syl[0] if syl else ""
    for s in syl[1:]:
        out += ("'" if s[:1].lower() in VOWEL else "") + s
    return out


def convert(raw):
    words = []
    for w in raw:
        han = w["simplified"]
        best = None
        forms = sorted(w["forms"], key=lambda f: f["transcriptions"]["pinyin"][:1].isupper())
        for f in forms:
            if f["transcriptions"]["pinyin"][:1].isupper():
                continue  # proper nouns
            for m in f["meanings"]:
                g = clean_meaning(m)
                if g:
                    best = {"han": han, "pinyin": join_pinyin(f["transcriptions"]["pinyin"]),
                            "en": g, "pos": w.get("pos", []),
                            "multi": len(w["forms"]) > 1}
                    break
            if best:
                break
        if best:
            words.append(best)
    return words


if __name__ == "__main__":
    for path in sys.argv[1:]:
        level = re.search(r"(\d+)", Path(path).stem).group(1)
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        words = convert(raw)
        out = ROOT / "data" / f"hsk{level}.json"
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps(words, ensure_ascii=False, indent=0), encoding="utf-8")
        print(f"{out.name}: {len(words)} / {len(raw)} words kept")
