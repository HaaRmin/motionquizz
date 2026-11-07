// The quiz video page: make a new quiz, preview it with sound, export the MP4 in the browser and download it.
// Everything runs in the browser; the data files, voice clips and images are read from this site.
// ?v=__BUILD__: the GitHub Pages workflow writes the commit there, so a new version never runs with old cached scripts
import { parseCsv, buildQuiz, loadGroups, pickBySeed } from './quiz.js?v=__BUILD__';
import { exportMp4, canExport } from './export.js?v=__BUILD__';

const $ = id => document.getElementById(id);
// the preview plays like a media player, so an iPhone's silent switch does not mute it (see template.html)
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older browser */ }
const path = p => p.split('/').map(encodeURIComponent).join('/');
const get = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error(url + ' (' + r.status + ')'); return r; };
const dataUri = async url => {
  const blob = await (await get(url)).blob();
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
};
const label = p => p.split('/').pop().replace(/\.[^.]+$/, '');
// "bg-4-cat-moon.jpg" -> "Cat moon"
const bgName = p => label(p).replace(/^bg-\d+-/, '').replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase());
const say = (text, kind = '') => { const s = $('status'); s.textContent = text; s.dataset.kind = kind; };
const checked = name => document.querySelector('input[name="' + name + '"]:checked').value;

let D = null, current = null, videoUrl = null;

// the page's data files are checked with the site on every visit, so a new version never meets an old cached one
const fresh = url => get(url, { cache: 'no-cache' });

async function loadData() {
  const [cfg, index, l1, l2, ov, groups, manifest, tpl] = await Promise.all([
    fresh('config.json').then(r => r.json()), fresh('web/index.json').then(r => r.json()),
    fresh('data/hsk1.json').then(r => r.json()), fresh('data/hsk2.json').then(r => r.json()),
    fresh('data/overrides.csv').then(r => r.text()), fresh('data/groups.csv').then(r => r.text()).catch(() => ''),
    fresh('audio/manifest.json').then(r => r.json()).catch(() => null), fresh('template.html').then(r => r.text()),
  ]);
  D = { cfg, index, lists: { 1: l1, 2: l2 }, overrides: parseCsv(ov), groups: loadGroups(groups ? parseCsv(groups) : []), manifest, tpl };
  pictureTiles();
}

// The background and logo pickers: one tile per picture (its thumbnail), plus "Drawn lanterns" and 🎲 Random.
// config.json "background" is the background the page starts with; the logo starts on 🎲.
function tile(group, value, { img, text, icon, cls = '', on = false }) {
  const l = document.createElement('label');
  l.className = 'tile ' + cls;
  const input = Object.assign(document.createElement('input'), { type: 'radio', name: group, value, checked: on });
  input.setAttribute('aria-label', text);
  l.append(input);
  if (img) l.append(Object.assign(document.createElement('img'), { src: path(img), alt: '', loading: 'lazy', decoding: 'async' }));
  if (icon) l.append(Object.assign(document.createElement('span'), { className: 'icon', textContent: icon }));
  if (group === 'bg') l.append(Object.assign(document.createElement('span'), { textContent: text }));
  return l;
}
function pictureTiles() {
  const thumb = f => D.index.thumbs?.[f] || f, start = D.cfg.background;
  const bgs = D.index.backgrounds.slice().sort((a, b) => (b === start) - (a === start)); // the default first
  $('bgs').replaceChildren(
    ...bgs.map(f => tile('bg', f, { img: thumb(f), text: bgName(f), on: f === start })),
    tile('bg', 'lanterns', { text: 'Drawn lanterns', icon: '🏮', cls: 'drawn' }),
    tile('bg', 'auto', { text: 'Random', icon: '🎲', on: !bgs.includes(start) }));
  $('logos').replaceChildren(
    tile('logo', 'auto', { text: 'Random logo', icon: '🎲', on: true }),
    ...D.index.logos.map((f, i) => tile('logo', f, { img: thumb(f), text: 'Logo ' + (i + 1) })));
}

// a new random seed for every quiz: new words, wrong answers and (with 🎲) background and logo
const newSeed = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
const choice = () => ({ kind: checked('kind'), levels: checked('level').split(',') });

// the preview frame keeps the video's proportions at any width, plus the player's bar (one row, or two when narrow)
function sizeFrame() {
  const f = $('frame'), bar = f.contentDocument && f.contentDocument.getElementById('bar');
  f.style.height = Math.round(f.clientWidth * 1920 / 1080 + (bar ? bar.offsetHeight : 64) + 2) + 'px';
  void f.offsetHeight; // lay the new size out now, so the preview fits itself to it straight away
  if (f.contentWindow && typeof f.contentWindow.fit === 'function') f.contentWindow.fit();
}

// quiz_gen.py main(): the quiz data the template expects, with the clips and images inlined as data URIs
async function quizData(c) {
  const q = buildQuiz(D.cfg, D.lists, D.overrides, D.groups, c.kind, c.levels, newSeed()), k = D.cfg[c.kind];
  const logoPick = checked('logo'), bgPick = checked('bg');
  const logo = logoPick === 'auto' ? pickBySeed(D.index.logos, q.seed, 'logo') : logoPick;
  const bg = bgPick === 'auto' ? pickBySeed(D.index.backgrounds, q.seed, 'background') : bgPick === 'lanterns' ? null : bgPick;
  let voice = null;
  if (D.manifest && (D.cfg.audio || {}).enabled !== false) {
    const clip = async (group, key) => { const e = (D.manifest[group] || {})[key]; return e ? dataUri('audio/' + path(e.file)) : null; };
    voice = {
      question: c.kind === 'kepes' ? await clip('questions', k.question) : null,
      items: await Promise.all(q.items.map(async it => ({
        q: c.kind === 'szoveges' ? await clip('questions', k.question.replace('{en}', it.en)) : null,
        zh: await clip('words', it.han),
      }))),
    };
  }
  const quiz = {
    kind: c.kind, question: k.question, count: k.countdown, reveal: k.reveal,
    follow: D.cfg.follow.enabled, outro: D.cfg.follow.seconds, followText: D.cfg.follow.text,
    logo: logo ? await dataUri(path(logo)) : null, background: bg ? await dataUri(path(bg)) : null, cat: null, voice, items: q.items,
  };
  return { q, quiz, logo, bg };
}

function showWords(q) {
  const list = $('words');
  list.replaceChildren(...q.items.map(it => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="han"></span> <span class="pin"></span> <span class="en"></span>';
    li.querySelector('.han').textContent = it.han;
    li.querySelector('.pin').textContent = it.pinyin;
    li.querySelector('.en').textContent = it.en;
    if (it.options) {
      const wrong = it.options.filter((o, j) => j !== it.correct).map(o => o.han + ' (' + o.pinyin + ', ' + o.en + ')').join(', ');
      const small = document.createElement('small'); small.textContent = 'wrong answers: ' + wrong; li.append(small);
    }
    return li;
  }));
  $('caption').value = 'HSK ' + q.levels.join('+') + ' Chinese quiz' + (q.group ? ' · ' + q.group : '') + ': ' +
    q.items.map(it => it.han + ' ' + it.pinyin + ' = ' + it.en).join(' · ') +
    '\n#learnchinese #chinese #hsk #mandarin #chineselanguage';
}

async function preview() {
  const c = choice();
  $('make').disabled = true; $('export').disabled = true; $('download').hidden = true;
  sizeFrame();
  say('Making a new quiz…');
  try {
    const { q, quiz, logo, bg } = await quizData(c);
    const html = D.tpl.split('__TITLE__').join(q.name).replace('/*QUIZDATA*/null', () => JSON.stringify(quiz).replace(/<\//g, '<\\/'));
    const frame = $('frame');
    await new Promise(res => { frame.onload = res; frame.srcdoc = html; });
    await frame.contentWindow.QUIZ_READY;
    sizeFrame();
    current = { c, q };
    showWords(q);
    $('picked').textContent = (q.group ? 'Group: ' + q.group + ' · ' : '') + (bg ? bgName(bg) : 'Drawn lanterns') + ' · ' + (logo ? label(logo) : 'no logo') + ' · ' + Math.round(frame.contentWindow.DURATION) + ' s';
    say('Your quiz is ready. Press Play in the preview, or export the video.', 'ok');
    $('export').disabled = !(await canExport());
  } catch (e) {
    say('Could not make the quiz: ' + e.message, 'error');
  } finally {
    $('make').disabled = false;
  }
}

async function exportVideo() {
  if (!current) return;
  const { q } = current;
  $('export').disabled = true; $('make').disabled = true;
  const t0 = performance.now();
  try {
    const blob = await exportMp4($('frame').contentWindow, (done, total) => {
      $('bar').value = done / total;
      say('Making the video… ' + Math.round(100 * done / total) + '%');
    });
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = URL.createObjectURL(blob);
    const a = $('download');
    a.href = videoUrl; a.download = q.name + '.mp4'; a.hidden = false;
    a.textContent = 'Download ' + q.name + '.mp4 (' + (blob.size / 1048576).toFixed(1) + ' MB)';
    a.click();
    say('Video ready in ' + ((performance.now() - t0) / 1000).toFixed(0) + ' s.', 'ok');
  } catch (e) {
    say('Export failed: ' + e.message, 'error');
  } finally {
    $('bar').value = 0; $('export').disabled = false; $('make').disabled = false;
  }
}

$('make').onclick = preview;
$('export').onclick = exportVideo;
window.addEventListener('resize', sizeFrame);
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('caption').value); $('copy').textContent = 'Copied'; } catch (e) { $('caption').select(); }
  setTimeout(() => { $('copy').textContent = 'Copy caption'; }, 1500);
};

(async () => {
  say('Loading the word lists…');
  try {
    await loadData();
    if (!(await canExport())) $('browser').hidden = false;
    say('Ready. Choose a quiz and press New quiz.');
    $('make').disabled = false;
    sizeFrame();
  } catch (e) {
    say('Could not load the quiz data: ' + e.message, 'error');
  }
})();
