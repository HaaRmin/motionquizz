#!/usr/bin/env python3
"""Check data/groups.csv against the word lists (with data/overrides.csv applied).

Reports: words that are not in HSK 1-2 (typos), words that are in the lists but never asked in a quiz (they can
still be wrong answers only if they are eligible, so they do nothing in a group), sets with fewer than two
usable words, and how many quiz words belong to a set or a topic. Run it after editing the file:

  python3 tools/check_groups.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import quiz_gen  # noqa: E402  (load_words and load_groups, the same data the quizzes use)


def main():
    words = {w["han"]: w for w in quiz_gen.load_words(["1", "2"])}
    groups = quiz_gen.load_groups()
    problems = 0
    for row in groups["rows"]:
        unknown = [x for x in row["words"] if x not in words]
        unused = [x for x in row["words"] if x in words and not words[x]["eligible"]]
        usable = [x for x in row["words"] if x in words and words[x]["eligible"]]
        notes = []
        if unknown:
            notes.append("not in HSK 1-2: " + " ".join(unknown))
        if unused:
            notes.append("never used in quizzes: " + " ".join(unused))
        if row["kind"] == "set" and len(usable) < 2:
            notes.append(f"only {len(usable)} usable word (a set needs at least 2)")
        if row["kind"] not in ("set", "topic", "same"):
            notes.append("unknown kind " + row["kind"])
        if notes:
            problems += 1
            print(f"{row['group']} ({row['kind']}): " + "; ".join(notes))
    quiz_words = [w for w in words.values() if w["eligible"]]
    in_set = sum(1 for w in quiz_words if groups["set"].get(w["han"]))
    in_topic = sum(1 for w in quiz_words if groups["topic"].get(w["han"]))
    in_any = sum(1 for w in quiz_words if groups["set"].get(w["han"]) or groups["topic"].get(w["han"]))
    print(f"{len(groups['rows'])} groups; quiz words: {len(quiz_words)}, in a set: {in_set}, in a topic: {in_topic}, "
          f"in either: {in_any} (the rest get wrong answers of the same word type)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
