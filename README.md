# HSK kvíz-animáció generátor

Determinisztikus, LLM nélküli generátor a két kvízformátumhoz, HSK 3.0 szint 1–2 szókinccsel.

- **kepes**: angol szó → írásjegyek gyakorlórácsban → 3 mp visszaszámlálás → pinyin felfedés
- **szoveges**: „How do you say “…” in Chinese?” → 3 válasz → 5 mp visszaszámlálás → zöld helyes válasz

Kimenet: önálló HTML (lejátszó, csúszka, hang) és opcionálisan MP4 (1080×1920, 30 fps, hanggal).

## Telepítés (macOS)

```bash
pip install -r requirements.txt
playwright install chromium     # csak MP4-hez
brew install ffmpeg             # csak MP4-hez
```

## Használat

```bash
python quiz_gen.py kepes --level 1 --mp4          # következő képes kvíz HSK 1-ből
python quiz_gen.py szoveges --level 2 --mp4       # következő szöveges kvíz HSK 2-ből
python quiz_gen.py kepes --level 1,2              # mindkét szint együtt
python quiz_gen.py szoveges --seed tavasz01       # fix seed: mindig ugyanaz a kvíz
python quiz_gen.py szoveges --words 谢谢,不客气,对不起,没关系
python quiz_gen.py kepes --level 1 --dry-run      # csak kiírja, mit választana
```

Az `out/` mappába kerül a `.html`, a `.mp4` és egy `.json` (a kiválasztott szavak, pl. a poszt szövegéhez).

## Hogyan választ

- Ugyanaz a seed + ugyanazok az adatfájlok = ugyanaz a kvíz, ugyanaz a válaszsorrend, ugyanaz a videó.
- Seed nélkül a seed `<típus>-L<szint>-run<N>`; a `history.json` jegyzi a már használt szavakat, így a futások
  ismétlés nélkül haladnak végig a listán, és ha elfogyott, új kört kezdenek. `--no-history` kikapcsolja.
- Alapból főnevek, igék, melléknevek és időszavak kerülnek be, a többféle kiejtésű szavak nem.
  A szöveges kvíz rossz válaszai ugyanabból a szintből jönnek, eltérő jelentéssel, közös írásjegy nélkül.

## Testreszabás

- `config.json`: kérdésszöveg, kérdések száma, visszaszámlálás és felfedés hossza, követő kártya.
- Logók: az `assets/logos/` mappa összes képe. Videónként egy, a seedből választva (ugyanaz a seed =
  ugyanaz a logó; a választott fájl neve a kimeneti `.json`-ban, `logo`). Új logó: tedd a mappába
  (négyzetes kép, a kör alakú keret levágja a sarkait). A mappát a `config.json` → `logos` adja meg.
- Háttér: egy fotó az `assets/backgrounds/` mappából, videónként egy, a seedből választva (a neve a
  kimeneti `.json`-ban, `background`). Lassan nagyít és úszik, és egy sötétítés alatt van, hogy a szöveg
  olvasható maradjon. Egy adott kép kényszerítése: `--background assets/backgrounds/<fájl>`. Ajánlott:
  álló, legalább 1080×1920-as JPEG. Ha a mappa üres, a rajzolt színes lampionos utca marad (a színek a
  `template.html` `LANTERN_COLORS` listájában). A mappát a `config.json` → `backgrounds` adja meg.
- TikTok-keret: a videó 1080×1920 (9:16), és minden tartalom a TikTok saját felülete alatti biztonságos
  részben marad: felül 130, alul 480, jobbra 150, balra 60 pixel szabadon (a TikTok-fül, a gombsor és a
  felirat helye). A lejátszó **TikTok guides** gombja mutatja ezeket a sávokat; a videóba nem kerülnek bele.
- `data/overrides.csv`: angol jelentés javítása (`han,en,`), szó kizárása (`han,,exclude`) vagy
  felvétele a gyakori kifejezések közé (`han,en,include`).
- `fonts/`: opcionális betűtípusok beágyazása (lásd ott). Nélkülük a rendszer betűi szólnak.
- Kinézet és animáció: `template.html` (CSS és a `charQuiz` / `mcQuiz` függvények).
- A macska (fotó-kivágások; **kikapcsolva**, `config.json` → `cat` → `enabled: false`; a képek az
  `assets/cat/` mappában maradtak). Bekapcsolva a `catView`
  függvény mozgatja: kérdés közben kikukucskál (`peek`) vagy felnéz (`look`), a válasznál beugrik ülve
  (`sit`), a végén elalszik (`sleep`). Bármelyik póz elhagyható, ilyenkor egy másikat használ.
  Új kép kivágása (macOS, a beépített háttéreltávolítóval, fehér matrica-szegéllyel, AVIF-be):

  ```bash
  swiftc -O tools/cutout.swift -o /tmp/cutout
  /tmp/cutout foto.jpg assets/cat/sit.avif all 8 1 2   # bemenet, kimenet, all, szegély px, nagyítás, élszűkítés px
  ```

## Szólista frissítése

```bash
curl -L -o raw/new1.json https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/wordlists/exclusive/new/1.json
curl -L -o raw/new2.json https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/wordlists/exclusive/new/2.json
python tools/build_vocab.py raw/new1.json raw/new2.json
```

Forrás és licenc: `data/SOURCE.md`.

## Kiejtés (hangfájlok)

Az `audio/` mappában minden HSK 1–2 szó kimondva (`audio/zh/<írásjegy>.mp3`) és a szöveges kvíz
kérdése (`audio/en/…mp3`, „How do you say “…” in Chinese?”), plus a képes kvíz állandó kérdése.
Google Cloud Text-to-Speech, `cmn-CN-Chirp3-HD-Despina` hang (a `RealChinneseQuizz` projektben
választva; az angol kérdést is ő mondja, kínai akcentussal). Az `audio/manifest.json` mutatja,
melyik fájl mit mond. A hang és a nyelv a `config.json` → `audio` alatt állítható.

A videóban minden kártya elején elhangzik a kérdés (a képes kvízben az állandó „How do you say this in
Chinese?”), a felfedés után pedig a szó kínaiul; közben a zene halkabb. A `quiz_gen.py` a kiválasztott
szavak klipjeit ágyazza a HTML-be. `config.json` → `audio` → `enabled: false` kikapcsolja.

Új vagy javított szó után (pl. `overrides.csv`-ben módosított angol jelentés) futtasd újra; csak az új
vagy megváltozott szöveget kéri le:

```bash
cd tts
.venv/bin/python make_audio.py --level 1,2
```

A kulcs és a beállítás: `tts/GOOGLE-KEY-GUIDE.md`. A kulcs (`tts/google-tts-key.json`) soha nem
kerül gitbe. Ingyenes keret: Chirp3-HD hangra havi 1 millió karakter; a teljes HSK 1–2 kb. 41 000.

## Automatikus futtatás: GitHub Actions

A `.github/workflows/hsk-quiz.yml` minden nap elkészít egy képes és egy szöveges kvízt, mindkettőt külön
e-mailben elküldi, 7 napig a futás mellékleteként is megőrzi, és visszacommitolja a `history.json`-t.
Claude-ot nem használ.

1. Tedd a mappát egy **külön, privát** GitHub repóba és pushold a `main` ágra.
2. **Settings → Secrets and variables → Actions → Secrets:**
   - mindig: `MAIL_TO` (több cím vesszővel) és `MAIL_FROM`
   - plusz az egyik küldési mód:
     - **Gmail:** `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER` = a Gmail-cím,
       `SMTP_PASSWORD` = alkalmazásjelszó (kétlépcsős azonosítás kell hozzá). `MAIL_FROM` = ugyanaz a cím.
     - **Céges Microsoft 365:** `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, felhasználó és jelszó.
       Csak akkor megy, ha az IT engedélyezi a postafióknak az SMTP AUTH-ot, és a fiókon nincs MFA-kényszer
       e protokollra; érdemes egy külön szolgáltatási postafiók.
     - **Resend (levélküldő API):** `RESEND_API_KEY`; a `MAIL_FROM` domainjét a Resendben hitelesíteni kell.
3. Opcionális **Variables:** `QUIZ_LEVEL` = `1`, `2` vagy `1,2` (alapértelmezés: `1`).
4. **Settings → Actions → General → Workflow permissions:** „Read and write permissions”.
5. **Actions → HSK quiz video → Run workflow** egy próbafuttatáshoz (típus, szint, küldés választható).

Az időpont UTC-ben van (`cron` sor a workflow elején). Egy futás (két videó) kb. 10–12 perc.
Ha ugyanaz a szó ismétlődne, ellenőrizd, hogy a „Save history” lépés pusholt-e: a `main` ágra írás
kell hozzá (`permissions: contents: write`), védett ágnál engedélyezd a GitHub Actions botnak.

Próba levélküldés nélkül, helyben: `python send_mail.py --dry-run` (az `out/latest.eml`-be írja).
