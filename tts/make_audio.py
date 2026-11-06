#!/usr/bin/env python3
"""Make the spoken audio for the quiz words with Google Cloud Text-to-Speech.

Ported from RealChinneseQuizz/sound_generator.ipynb: same voice (cmn-CN-Chirp3-HD-Despina, also for the
English questions, so they have a Chinese accent), same two clips per word, MP3 output.
Differences: the words come from data/hsk*.json with data/overrides.csv applied (quiz_gen.load_words), the
question text is the quiz's own (config.json -> szoveges.question), and files are named by the hanzi and by
the question text instead of the English meaning (59 meanings repeat in HSK 1-2, e.g. 爸 / 爸爸 "father").

Output, at the project root:
  audio/zh/<hanzi>.mp3              the word in Mandarin
  audio/en/<slug>-<hash>.mp3        the question, e.g. "How do you say “clothes” in Chinese?"
  audio/manifest.json               which text each file says, with which voice
Run it again any time: a clip whose text and voice have not changed is not requested again.

  .venv/bin/python make_audio.py --level 1,2           # every word of HSK 1 and 2
  .venv/bin/python make_audio.py --words 你好,谢谢      # only these words
  .venv/bin/python make_audio.py --level 1 --dry-run   # count what would be requested, send nothing

The key: tts/google-tts-key.json (see GOOGLE-KEY-GUIDE.md), or GOOGLE_APPLICATION_CREDENTIALS.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
import quiz_gen  # noqa: E402  (load_words and load_config, the same word list the quizzes use)

AUDIO = ROOT / "audio"
MANIFEST = AUDIO / "manifest.json"


def slug(text, maxlen=40):
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s[:maxlen] or "q"


def question_file(text):
    m = re.search(r"[“\"](.+?)[”\"]", text)
    return "en/" + slug(m.group(1) if m else text) + "-" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:6] + ".mp3"


def plan(words, cfg, manifest, voice):
    """The clips to make: (kind, key, text, relative file). Skips clips already made with the same text and voice."""
    jobs, seen = [], set()
    template = cfg["szoveges"]["question"]
    fixed = cfg["kepes"]["question"]  # the picture quiz asks the same question every time
    rows = [[("question", fixed, fixed, question_file(fixed))]]
    for w in words:
        q = template.replace("{en}", w["en"])
        rows.append([("word", w["han"], w["han"], "zh/" + w["han"] + ".mp3"), ("question", q, q, question_file(q))])
    for items in rows:
        for kind, key, text, rel in items:
            if (kind, key) in seen:
                continue
            seen.add((kind, key))
            done = manifest[kind + "s"].get(key)
            if done and done["text"] == text and done["voice"] == voice and (AUDIO / done["file"]).exists():
                continue
            jobs.append((kind, key, text, rel))
    return jobs


def make_client():
    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        key = HERE / "google-tts-key.json"
        if not key.exists():
            sys.exit("No key: put the service-account JSON at tts/google-tts-key.json (see GOOGLE-KEY-GUIDE.md).")
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(key)
    from google.cloud import texttospeech
    return texttospeech, texttospeech.TextToSpeechClient()


def synthesize(tts, client, text, language, voice, out_path, tries=6):
    from google.api_core import exceptions as gx
    delay = 2.0
    for attempt in range(tries):
        try:
            resp = client.synthesize_speech(
                input=tts.SynthesisInput(text=text),
                voice=tts.VoiceSelectionParams(language_code=language, name=voice),
                audio_config=tts.AudioConfig(audio_encoding=tts.AudioEncoding.MP3),
            )
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(resp.audio_content)
            return len(resp.audio_content)
        except (gx.ResourceExhausted, gx.ServiceUnavailable, gx.DeadlineExceeded, gx.InternalServerError):
            if attempt == tries - 1:
                raise
            time.sleep(delay)  # Google's rate limit or a hiccup: wait and try again
            delay *= 2


def main():
    cfg = quiz_gen.load_config()
    acfg = cfg.get("audio", {})
    ap = argparse.ArgumentParser(description="Make the quiz audio with Google TTS.")
    ap.add_argument("--level", default="1,2", help="HSK level(s): 1, 2 or 1,2 (default 1,2)")
    ap.add_argument("--words", help="comma-separated words (hanzi) to make, instead of whole levels")
    ap.add_argument("--voice", default=acfg.get("voice", "cmn-CN-Chirp3-HD-Despina"))
    ap.add_argument("--language", default=acfg.get("language", "cmn-CN"))
    ap.add_argument("--workers", type=int, default=4, help="requests at the same time (default 4)")
    ap.add_argument("--dry-run", action="store_true", help="only count what would be requested")
    a = ap.parse_args()

    levels = [x.strip() for x in a.level.split(",") if x.strip()]
    words = quiz_gen.load_words(levels)
    if a.words:
        wanted = [x.strip() for x in a.words.split(",") if x.strip()]
        by_han = {w["han"]: w for w in words}
        missing = [x for x in wanted if x not in by_han]
        if missing:
            sys.exit("Not in HSK " + ",".join(levels) + ": " + ", ".join(missing))
        words = [by_han[x] for x in wanted]

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    manifest.setdefault("words", {})
    manifest.setdefault("questions", {})
    jobs = plan(words, cfg, manifest, a.voice)
    chars = sum(len(t) for _, _, t, _ in jobs)
    print(f"{len(words)} words -> {len(jobs)} clips to make ({chars:,} characters), voice {a.voice}")
    if a.dry_run or not jobs:
        return

    tts, client = make_client()
    made, failed, size, t0 = 0, [], 0, time.time()

    def save():
        AUDIO.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")

    with ThreadPoolExecutor(max_workers=max(1, a.workers)) as pool:
        futures = {pool.submit(synthesize, tts, client, text, a.language, a.voice, AUDIO / rel): (kind, key, text, rel)
                   for kind, key, text, rel in jobs}
        for fut in as_completed(futures):
            kind, key, text, rel = futures[fut]
            try:
                size += fut.result()
                manifest[kind + "s"][key] = {"file": rel, "text": text, "voice": a.voice}
                made += 1
            except Exception as e:  # keep going; the failed ones are listed at the end and made on the next run
                failed.append((key, str(e).splitlines()[0][:160]))
            if (made + len(failed)) % 50 == 0:
                save()
                print(f"  {made + len(failed)}/{len(jobs)} ({time.time() - t0:.0f} s)", flush=True)
    save()
    print(f"Done: {made} clips made, {size / 1048576:.1f} MB, {chars:,} characters requested, {time.time() - t0:.0f} s")
    if failed:
        print(f"{len(failed)} failed (run again to retry):")
        for key, err in failed[:20]:
            print("  ", key, "-", err)
        sys.exit(1)


if __name__ == "__main__":
    main()
