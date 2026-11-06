# Átadás: HSK kvíz-videó generátor

> **Frissítés (2026-11-06):** az e-mailes, napi GitHub Actions-futás helyett a videók egy GitHub Pages
> weboldalon készülnek: kvíz kiválasztása, előnézet, MP4-letöltés a böngészőben. A `send_mail.py` és a napi
> workflow törölve; a mostani működés a `README.md`-ben. Az alábbi szöveg az eredeti átadás, változatlanul.


Ez a dokumentum a `hsk-quiz.zip` mellé készült, egy kódoló ügynöknek. A feladat: a projektet GitHubra tenni,
élesíteni a napi GitHub Actions futást, és a még nem tesztelt részeket ellenőrizni.

## Munkamód

- Ármin a repó egyedüli használója, közvetlenül a `main` ágon dolgozik, branchek és PR-ek nélkül.
- Először írj tervet, amit ő átnéz. Jóváhagyás után dolgozhatsz önállóan, lépésenkénti engedélykérés nélkül.
- Ez a projekt nem Salesforce-os: külön, privát GitHub repóba kerüljön, ne az sfdx projektbe.
- Secretet (jelszót, kulcsot) soha ne írj fájlba, és ne commitolj.

## Cél

Napi két rövid, álló (1080×1920) MP4 kvízvideó kínai szókinccsel, HSK 3.0 1–2. szint:

- **kepes:** angol szó → írásjegyek gyakorlórácsban → 3 mp visszaszámlálás → pinyin felfedés (3 kérdés).
- **szoveges:** „How do you say “…” in Chinese?” → 3 válasz → 5 mp visszaszámlálás → helyes válasz zölden (4 kérdés).

A videókat e-mailben kapja meg, két külön levélben. A futás közben **nincs LLM-hívás**: a szóválasztás és a render
teljesen determinisztikus kód. Ez alapkövetelmény, ne vezess be futásidejű AI-hívást.

## Állapot

**Elkészült és helyben tesztelve:**

- szóválasztás, mindkét kvíztípus, HTML-lejátszó hanggal
- MP4-render Playwright + ffmpeg pipeline-nal, hanggal
- `history.json` léptetés
- levél összeállítása és küldése egy helyi teszt SMTP-szerverre (csatolmánnyal együtt)

**Még nem tesztelve:**

- a GitHub Actions workflow éles futása
- valódi Gmail-küldés
- a betűtípus-útvonalak az `ubuntu-24.04` runneren
- a `history.json` visszapusholása a workflow-ból

## Fájlok

| Fájl | Szerep |
|---|---|
| `quiz_gen.py` | CLI: szóválasztás, HTML írása, opcionális MP4 (`--mp4`), `out/latest.json` |
| `template.html` | A teljes animáció: lampionos háttér, két kvíztípus, lejátszó, szintetizált hang, `renderAt(t)` és `renderAudioWav()` hookok |
| `send_mail.py` | Levélküldés: Resend API vagy SMTP (Gmail / M365), `--dry-run` |
| `config.json` | Kérdésszövegek, kérdésszám, időzítések, követő kártya, logó |
| `data/hsk1.json`, `data/hsk2.json` | Tömörített szólisták (`han`, `pinyin`, `en`, `pos`, `multi`) |
| `data/overrides.csv` | Kézi jelentésjavítás, `include` / `exclude` |
| `data/SOURCE.md` | Forrás és licenc (drkameleon/complete-hsk-vocabulary, MIT) |
| `tools/build_vocab.py` | A nyers listákból készíti a `data/hsk*.json`-t |
| `assets/logos/` | Ármin csatornalogói (月行), 11 db; videónként egy, a seedből választva (a régi `assets/logo.webp` helyett) |
| `.github/workflows/hsk-quiz.yml` | Napi futás 06:17 UTC-kor, mindkét kvíz, levél, history commit, 7 napos melléklet |
| `README.md` | Felhasználói leírás magyarul |

## Működés

1. A `quiz_gen.py` betölti a szinthez tartozó listát, és ráteszi az `overrides.csv`-t.
   - A szópool alapból a főnevek, igék, melléknevek és időszavak, a többféle kiejtésű szavak nélkül. Az `include` sorok bekerülnek, az `exclude` sorok kiesnek.
2. A sorrend `sha256(seed|han)` szerint dől el.
   - Seed nélkül a seed `"<kind>-L<szint>-run<N>"`, ahol N a korábbi futások száma a `history.json`-ban.
   - A már használt szavakat kihagyja; ha a lista elfogyott, új kört kezd.
3. A szöveges kvíz rossz válaszai ugyanabból a poolból jönnek.
   - Eltérő jelentésűek, nincs közös írásjegyük a helyes válasszal, és hasonló a hosszuk.
   - A helyes válasz pozíciója is a seedből számolódik.
4. Az adatok JSON-ként kerülnek a `template.html`-be (`/*QUIZDATA*/`).
   - A betűk opcionálisan részhalmazolva, beágyazva kerülnek be (`/*FONTFACES*/`, fontTools).
5. MP4: a Playwright headless Chromium a `?capture=1` címmel nyitja meg az oldalt, és képkockánként meghívja a `renderAt(i/fps)`-t.
   - JPEG képernyőképeket ffmpeg-be pipe-ol, a hangot a `renderAudioWav()` adja OfflineAudioContextből.
   - Kódolás: CRF 22, AAC.
6. A workflow sorban mindkét típust legyártja és elküldi, a hibákat összegyűjti, majd mindig commitolja a `history.json`-t.

**Invariánsok, ne törd el ezeket:**

- A `renderAt(t)` tiszta függvény: azonos `t`-re azonos képet ad.
  - Nincs `Math.random` (helyette a seedelt `rng()`), nincs CSS transition vagy animation, nincs időzítő.
- Azonos seed és azonos adatfájlok mellett azonos kimenet. A Python oldalon az `h()` (sha256) dönt, a `random` modul nincs használva.
- `history.json` kulcs: `"<kind>-L<szintek>"`, értéke `{runs, used[]}`.

## Feladatok

1. Tervet írni, Árminnal jóváhagyatni.
2. Privát repót létrehozni (`gh repo create ... --private`), és a zip tartalmát pusholni a `main`-re.
   - A `.github` mappa is menjen fel. Az `out/` mappa és a `raw/*.json` fájlok a `.gitignore` szerint nem.
3. Helyi ellenőrzés:
   - `python quiz_gen.py kepes --level 1 --dry-run --no-history`
   - `python quiz_gen.py szoveges --level 2 --dry-run --no-history`
4. Repóbeállítások:
   - Workflow permissions: read/write (Settings → Actions → General, vagy `gh api`).
   - Opcionális `QUIZ_LEVEL` változó (`gh variable set QUIZ_LEVEL --body 1`).
5. Secretek. Ezeket Ármin adja meg, vagy a jelenlétében `gh secret set`-tel kerülnek be. A jelszót ne kérd el a chatben.
   - `MAIL_FROM`, `MAIL_TO`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASSWORD`
   - A jelszó Gmail-alkalmazásjelszó; a küldő fiókon kétlépcsős azonosítás kell hozzá.
   - Javasolt egy külön, erre a célra létrehozott Gmail-fiók.
6. Próbafuttatás: `gh workflow run hsk-quiz.yml -f kinds=kepes -f send=false`, majd `gh run watch`.
   - Ha zöld: futtatás `kinds="kepes szoveges"` és `send=true` beállítással, és Ármin megnézi a leveleket.
7. A talált hibák javítása, és egy rövid összefoglaló Árminnak arról, mi változott.

## Ellenőrizendő kockázatok

- **Betűtípusok a runneren:** a workflow ezeket az útvonalakat várja:
  - `/usr/share/fonts/opentype/noto/NotoSerifCJK-Black.ttc` (a `fonts-noto-cjk-extra` csomagból)
  - `/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc` (a `fonts-noto-cjk` csomagból)
  - Ha az útvonal eltér, a `font_face()` hibát dob. Ilyenkor `fc-list | grep CJK` alapján javítsd.
- **Emoji:** a 🎯 a `fonts-noto-color-emoji` csomagból jön. Ha négyzet jelenik meg, ellenőrizd.
- **Futásidő:** két videó kb. 10–12 perc; a `timeout-minutes` értéke 40.
- **History push:** `git pull --rebase` a push előtt, a commit `[skip ci]` jelölésű. Ha a `main` védett ág, a botnak írási jog kell.
- **Levélméret:** a Gmail kb. 25 MB-os korlátja kódolva értendő. A videók most 5–9 MB-osak, ha nő a kérdésszám, figyelni kell.
- **Ütemezés:** a GitHub ütemezett futásai késhetnek pár percet.
- **Keret:** privát repó, Free csomag: havi 2000 perc és 500 MB tárhely. A becsült használat havi kb. 370 perc és kb. 90 MB.
- **Szólista-minőség:** az angol jelentések szabály alapján vágottak. A furcsákat az `overrides.csv`-be kell felvenni, a kódhoz nem kell nyúlni.

## Nyitott kérdések Árminnak

- „HSK 3.5”-öt kért. Ilyen nevű listát nem találtunk, ezért a HSK 3.0-s listát használjuk. Ha mást ért alatta, csak a `data/` fájlokat kell lecserélni.
- Kik a címzettek (`MAIL_TO`), és jó-e a 06:17 UTC-s időpont?
- Maradjon-e a követő kártya szövege és a logó, vagy változzon?

## Elfogadási feltételek

- Egy kézi `workflow_dispatch` futás zölden lefut.
- Két levél érkezik, mindegyikben egy lejátszható MP4: a kínai írásjegyek, a pinyin és a hang is rendben van.
- A `history.json` frissül a `main`-en.
- A következő futás más szavakat választ.
- Ugyanaz a `--seed` helyben bájtra azonos `.json` kimenetet ad.
