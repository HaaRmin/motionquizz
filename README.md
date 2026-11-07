# HSK kvíz-animáció generátor

Determinisztikus, LLM nélküli generátor a két kvízformátumhoz, HSK 3.0 szint 1–2 szókinccsel.

- **kepes**: angol szó → írásjegyek gyakorlórácsban → 3 mp visszaszámlálás → pinyin felfedés
- **szoveges**: „How do you say “…” in Chinese?” → 3 válasz → 5 mp visszaszámlálás → zöld helyes válasz

Kimenet: TikTokra szánt MP4 (1080×1920, 30 fps, hanggal), a weboldalon a böngészőben készítve
(lásd lent), vagy helyben a `quiz_gen.py`-jal (HTML, és Playwrighttal MP4).

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
- TikTok-keret: a videó 1080×1920 (9:16). A kvíz elemei (visszaszámláló, kérdés, kártya vagy válaszok,
  követő kártya a logóval) egy csoportban vannak („C” elrendezés, 2026-11-07): 90%-ra kicsinyítve, vízszintesen
  középen (x 159–921), a teteje (a visszaszámláló) y 200-nál, 30 pixellel a TikTok felső sávja alatt, így a TikTok
  felső sávja, jobb oldali oszlopa és felirata nem takarja (`template.html` → `placeGroup`, `GROUP_SCALE`,
  `GROUP_TOP`). A választható elrendezések mockupja: `../mockups/elrendezesek.html` (a repón kívül). A lejátszó **TikTok guides**
  gombja azt mutatja, amit egy iPhone-on mértünk (2026-11, egy TikTok-képernyőképből): a TikTok kitölti a
  képernyőt, ezért felül és alul kb. 73 pixelt levág; a felső sáv kb. 170 pixelig ér, a jobb oldali oszlop
  (profilkép, like, komment, mentés, megosztás) 955 és 1820 között van, 940 pixeltől jobbra, a felirat kb.
  1720-nál kezdődik. A szaggatott keret az a rész, amit semmi nem takar. A videóba egyik sem kerül bele.
- A záró „Follow me” kártya a legalsó kérdés alá kerül, így nem takar el választ vagy kártyát.
- Válaszsávok (szöveges kvíz) és a „Follow me” doboz: a szöveg középen; a sáv színét a sablon a háttérből számolja
  (`template.html` → `tuneBands`): a válaszok mögötti rész átlagszíne (a sötétítő réteggel együtt) adja az árnyalatot,
  sötét háttéren világosabb, világos háttéren sötétebb sávval, mindig olvasható fehér szöveggel.
- Alapértelmezett háttér: `config.json` → `background` (most `bg-4-cat-moon.jpg`); a weboldal ezzel indul,
  a `quiz_gen.py` is ezt használja. `--background auto` vagy az oldalon a „Chosen by the number” a sorszám
  szerint választ a mappából. A logó továbbra is a sorszámból adódik, ha nincs kiválasztva.
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

## Weboldal: kvíz készítése, előnézet, letöltés (GitHub Pages)

A videók egy weboldalon készülnek: `index.html` és a `web/` mappa. Minden a böngészőben fut, szerver és
e-mail nincs.

1. Válaszd ki a típust (képes / szöveges), a HSK-szintet és a **kvíz sorszámát**, majd **Make quiz**.
   Ugyanaz a sorszám mindig ugyanazt a kvízt adja; a szavakat a `quiz_gen.py`-jal azonos módon választja
   (a korábbi sorszámok szavait kihagyja, és ha a lista elfogyott, új kört kezd). A háttér és a logó a
   sorszámból adódik, vagy kézzel választható. A böngésző megjegyzi a következő még nem használt sorszámot
   (már a Make quiznél), így egy új látogatás új szavakkal indul; a **Next ▸** gomb a következő kvízt készíti el.
2. Az előnézetben Play gombbal meghallgatható, a **TikTok guides** gomb a TikTok gombjait és feliratát mutatja.
3. **Export MP4**: a böngésző elkészíti a videót (1080×1920, 30 fps, hanggal; egy szöveges kvíz kb. fél perc),
   és letölti (`kepes_hsk1_001.mp4` stb.).
4. A „TikTok caption” mezőben kész leírás van a kvíz szavaival; **Copy caption** a vágólapra teszi.

Az MP4 készítéséhez WebCodecs (H.264 + AAC) kell: Chrome és Edge számítógépen, Safari iPhone-on (Safari 26).
Ahol nincs, ott az előnézet működik, a letöltés nem; az oldal ezt ki is írja. A háttérfotót és a logót a
videóba közvetlenül rajzolja (nem a képkocka-SVG-n belül), mert a Safari azokat késve tölti be, és a
háttér villogott az iPhone-on készült videókban. A kvíz csoportját külön, 1:1-es képként rajzolja, és csak a kész képet kicsinyíti; a buborék világos kerete körvonal (outline), nem árnyék, mert a Safari a videóban szögletes dobozokat rajzolt belőle. Ha a videókódoló megáll (a Safari az iOS-szimulátorban
a H.264 High profillal ezt teszi), az export a következő beállítással (Main, majd Baseline) kezdi újra.
A Safari a hang (AAC) beállítását teljes MPEG-4 ES-leíróként adja át; az export ebből kiveszi a 2 bájtos
AudioSpecificConfigot, különben a lejátszók nem látják a hangsávot, és az iPhone-on készült videó néma.
Az előnézet médialejátszóként szól (`navigator.audioSession.type = 'playback'`), így az iPhone néma
kapcsolója nem némítja el. A betűk a gép saját kínai betűi (macOS: Kaiti / PingFang), ezért más
gépen kissé másképp nézhetnek ki.

**Közzététel:** a `.github/workflows/pages.yml` minden `main`-re pusholáskor kiteszi az oldalt a GitHub
Pagesre (csak az oldalhoz kellő fájlokat: `index.html`, `web/`, `template.html`, `config.json`, `data/`,
`audio/`, `assets/logos/`, `assets/backgrounds/`). Egyszeri beállítás: **Settings → Pages → Source:
GitHub Actions**. Az oldal címe: `https://haarmin.github.io/motionquizz/`. A Pages oldal mindig nyilvános.

Új logó vagy háttér: tedd a mappába és pushold; a workflow frissíti a `web/index.json` listát.

Verzió: a workflow minden közzétételkor a commit rövid azonosítóját írja a szkriptek címébe (`?v=__BUILD__`), és az oldal fejlécében is megjelenik („version …”). Így a böngésző egy új közzététel után mindig az új szkripteket tölti be, nem a tárolt régieket (a GitHub Pages 10 percig engedi tárolni a fájlokat).
Helyben: `python3 tools/site_index.py`, majd `python3 -m http.server` a mappában, és
`http://localhost:8000/`.

A `quiz_gen.py` parancssori eszköz (HTML és Playwrighttal MP4) továbbra is használható helyben.
