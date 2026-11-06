// The quiz video page: pick a quiz, preview it with sound, export the MP4 in the browser and download it.
// Everything runs in the browser; the data files, voice clips and images are read from this site.
import { parseCsv, buildQuiz, pickBySeed } from './quiz.js';
import { exportMp4, canExport } from './export.js';

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: only the convenience is lost */ } },
};
const path = p => p.split('/').map(encodeURIComponent).join('/');
const get = async url => { const r = await fetch(url); if (!r.ok) throw new Error(url + ' (' + r.status + ')'); return r; };
const dataUri = async url => {
  const blob = await (await get(url)).blob();
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
};
const label = p => p.split('/').pop().replace(/\.[^.]+$/, '');
const say = (text, kind = '') => { const s = $('status'); s.textContent = text; s.dataset.kind = kind; };

let D = null, current = null, videoUrl = null;

async function loadData() {
  const [cfg, index, l1, l2, ov, manifest, tpl] = await Promise.all([
    get('config.json').then(r => r.json()), get('web/index.json').then(r => r.json()),
    get('data/hsk1.json').then(r => r.json()), get('data/hsk2.json').then(r => r.json()),
    get('data/overrides.csv').then(r => r.text()), get('audio/manifest.json').then(r => r.json()).catch(() => null),
    get('template.html').then(r => r.text()),
  ]);
  D = { cfg, index, lists: { 1: l1, 2: l2 }, overrides: parseCsv(ov), manifest, tpl };
  for (const f of index.backgrounds) $('bg').add(new Option(label(f), f));
  for (const f of index.logos) $('logo').add(new Option(label(f), f));
}

const choice = () => ({ kind: $('kind').value, levels: $('level').value.split(','), number: Math.max(1, parseInt($('number').value, 10) || 1) });
const nextKey = c => 'hsk-next:' + c.kind + ':' + c.levels.join('+');
function suggestNumber() { $('number').value = store.get(nextKey(choice())) || '1'; }

// quiz_gen.py main(): the quiz data the template expects, with the clips and images inlined as data URIs
async function quizData(c) {
  const q = buildQuiz(D.cfg, D.lists, D.overrides, c.kind, c.levels, c.number), k = D.cfg[c.kind];
  const logo = $('logo').value === 'auto' ? pickBySeed(D.index.logos, q.seed, 'logo') : $('logo').value;
  const bg = $('bg').value === 'auto' ? pickBySeed(D.index.backgrounds, q.seed, 'background') : $('bg').value === 'lanterns' ? null : $('bg').value;
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
  list.replaceChildren(...q.items.map((it, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="han"></span> <span class="pin"></span> <span class="en"></span>';
    li.querySelector('.han').textContent = it.han;
    li.querySelector('.pin').textContent = it.pinyin;
    li.querySelector('.en').textContent = it.en;
    if (it.options) {
      const wrong = it.options.filter((o, j) => j !== it.correct).map(o => o.han + ' (' + o.pinyin + ')').join(', ');
      const small = document.createElement('small'); small.textContent = 'wrong answers: ' + wrong; li.append(small);
    }
    return li;
  }));
  const lv = q.levels.join('+');
  $('caption').value = 'HSK ' + lv + ' Chinese quiz #' + Number(q.name.split('_').pop()) + ': ' +
    q.items.map(it => it.han + ' ' + it.pinyin + ' = ' + it.en).join(' · ') +
    '\n#learnchinese #chinese #hsk #mandarin #chineselanguage';
}

async function preview() {
  const c = choice();
  $('make').disabled = true; $('export').disabled = true; $('download').hidden = true;
  say('Making quiz #' + c.number + '…');
  try {
    const { q, quiz, logo, bg } = await quizData(c);
    const html = D.tpl.split('__TITLE__').join(q.name).replace('/*QUIZDATA*/null', () => JSON.stringify(quiz).replace(/<\//g, '<\\/'));
    const frame = $('frame');
    await new Promise(res => { frame.onload = res; frame.srcdoc = html; });
    await frame.contentWindow.QUIZ_READY;
    current = { c, q };
    showWords(q);
    $('picked').textContent = (bg ? label(bg) : 'drawn lanterns') + ' · ' + (logo ? label(logo) : 'no logo') + ' · ' + Math.round(frame.contentWindow.DURATION) + ' s';
    say('Quiz #' + c.number + ' is ready. Press Play in the preview, or export the video.', 'ok');
    $('export').disabled = !(await canExport());
  } catch (e) {
    say('Could not make the quiz: ' + e.message, 'error');
  } finally {
    $('make').disabled = false;
  }
}

async function exportVideo() {
  if (!current) return;
  const { c, q } = current;
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
    store.set(nextKey(c), String(c.number + 1));
    say('Video ready in ' + ((performance.now() - t0) / 1000).toFixed(0) + ' s. Next time the number moves on to #' + (c.number + 1) + '.', 'ok');
  } catch (e) {
    say('Export failed: ' + e.message, 'error');
  } finally {
    $('bar').value = 0; $('export').disabled = false; $('make').disabled = false;
  }
}

$('make').onclick = preview;
$('export').onclick = exportVideo;
$('kind').onchange = $('level').onchange = suggestNumber;
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('caption').value); $('copy').textContent = 'Copied'; } catch (e) { $('caption').select(); }
  setTimeout(() => { $('copy').textContent = 'Copy caption'; }, 1500);
};

(async () => {
  say('Loading the word lists…');
  try {
    await loadData();
    suggestNumber();
    if (!(await canExport())) $('browser').hidden = false;
    say('Ready. Choose a quiz and press Make quiz.');
    $('make').disabled = false;
  } catch (e) {
    say('Could not load the quiz data: ' + e.message, 'error');
  }
})();
