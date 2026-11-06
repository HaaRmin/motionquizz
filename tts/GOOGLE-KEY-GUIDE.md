# Google Cloud TTS: key and voice

The audio for the quiz words comes from Google Cloud Text-to-Speech, with the setup chosen in the
earlier project `Development/RealChinneseQuizz` (its `sound_generator.ipynb`).

## Current setup

- **Key:** `google-tts-key.json` in this folder is a **link** to the key file of the old project,
  `RealChinneseQuizz/decent-space-478214-r0-f1ae3b4762ed.json`. The file stays there, and there is
  only one copy of the secret. The account is `tts-generator` in the Google Cloud project
  **My First Project** (`decent-space-478214-r0`). `.gitignore` keeps `tts/*.json` out of git.
  Checked on 2026-11-06: the key works, and Google lists 38 Mandarin voices.
- **Voice:** `cmn-CN-Chirp3-HD-Despina`, language `cmn-CN`, MP3 output (mono, 24 kHz). The same
  voice reads the Mandarin words and the English questions, so the English has a Chinese accent.
- **Clips per word (as in the old project, made by `make_audio.py`):** `audio/zh/<hanzi>.mp3` (the
  word) and `audio/en/<english>-<hash>.mp3` ("How do you say “<english>” in Chinese?"). They are named
  by the hanzi and the question text, not the English meaning as in the old project, because 59
  meanings repeat in HSK 1–2.
- **Cost:** Chirp3-HD voices are free up to 1 million characters a month. All HSK 1–2 words with
  their questions come to roughly 50,000 characters.
- **Python:** `.venv/` here has `google-cloud-texttospeech`. The Mac's built-in Python 3.9 works,
  but Google prints warnings that it is too old. A newer Python (3.11+) silences them.

Test that the key works (listing voices costs nothing):

```bash
cd "/Users/armin/Development/motion quizz/hsk-quiz/tts"
GOOGLE_APPLICATION_CREDENTIALS="$PWD/google-tts-key.json" .venv/bin/python -c "from google.cloud import texttospeech as t; print([v.name for v in t.TextToSpeechClient().list_voices(language_code='cmn-CN').voices if 'Despina' in v.name])"
```

## Good to know about the key

- It is committed to the private GitHub repository `HaaRmin/RealChinneseQuizz` (commit `2470e3a`).
  Everyone with access to that repository can use it. If that ever matters, create a new key (below)
  and point the link here to the new file.
- Google never shows an existing key again: a key file can be downloaded only once, when it is created.
- If the old project folder moves, the link breaks. Then point it to the new place:
  `ln -sf <new path to the .json> google-tts-key.json`

## If you ever need a new key

1. Open <https://console.cloud.google.com/iam-admin/serviceaccounts?project=decent-space-478214-r0>,
   signed in with the Google account that owns the project. The long way: <https://console.cloud.google.com>
   → project picker at the top → **My First Project** → menu ☰ → **IAM & Admin** → **Service Accounts**.
2. Click `tts-generator@decent-space-478214-r0.iam.gserviceaccount.com` → **Keys** tab.
3. **Add key** → **Create new key** → **JSON** → **Create**. The browser downloads
   `decent-space-478214-r0-<new id>.json`.
4. Put the file somewhere outside any git repository, and point the link to it:
   `ln -sf <path to the new .json> google-tts-key.json`
5. Run the test above. An old key keeps working until you delete it on the **Keys** tab
   (bin icon on its row).

If something blocks you:

- `PERMISSION_DENIED`, API disabled → the API must be on:
  <https://console.cloud.google.com/apis/library/texttospeech.googleapis.com?project=decent-space-478214-r0>
  (shows **Manage** when on) and billing linked:
  <https://console.cloud.google.com/billing/linkedaccount?project=decent-space-478214-r0>.
- `invalid_grant` or `Invalid JWT Signature` → the key was deleted, or the link points to the wrong file.
- "Create new key" greyed out → an organization policy (`iam.disableServiceAccountKeyCreation`)
  forbids keys. A project under a personal Google account normally doesn't have one.
