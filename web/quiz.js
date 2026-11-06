// Word picking and quiz building, ported from quiz_gen.py. The same quiz number, level and data files give
// the same words, answer order, logo and background as the Python generator (checked against it).
import { sha256hex } from './sha256.js';

const ELIGIBLE_POS = new Set(['n', 'v', 'a', 'vn', 'an', 't', 's', 'f', 'nz']);
// h(): the integer value of sha256("a|b|c"), exactly like quiz_gen.h()
export const h = (...parts) => BigInt('0x' + sha256hex(parts.map(String).join('|')));
const bigCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const chars = s => Array.from(s);

// data/overrides.csv (han,en,action); a small CSV reader that understands quoted fields
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter(r => r.some(x => x.trim())).map(r => Object.fromEntries(head.map((k, i) => [k, r[i] || ''])));
}

// quiz_gen.load_words: the levels' words with the overrides applied and the eligible flag set
export function loadWords(levels, lists, overrides) {
  const ov = new Map(overrides.map(r => [r.han.trim(), r]));
  const words = [], seen = new Set();
  for (const lv of levels) {
    for (const w0 of lists[lv]) {
      if (seen.has(w0.han)) continue;
      seen.add(w0.han);
      const o = ov.get(w0.han), action = ((o && o.action) || '').trim();
      if (action === 'exclude') continue;
      const w = Object.assign({}, w0, o && o.en.trim() ? { en: o.en.trim() } : {});
      w.eligible = action === 'include' || (!w.multi && w.pos.length > 0 && ELIGIBLE_POS.has(w.pos[0]));
      words.push(w);
    }
  }
  return words;
}

// quiz_gen.pick: the next n words for this seed, skipping used ones; clears `used` when the list runs out
function pick(kind, words, n, seed, used) {
  const pool = words.filter(w => w.eligible && (kind !== 'kepes' || (chars(w.han).length >= 1 && chars(w.han).length <= 4)));
  const order = pool.map(w => [h(seed, w.han), w]).sort((a, b) => bigCmp(a[0], b[0])).map(x => x[1]);
  let fresh = order.filter(w => !used.has(w.han));
  if (fresh.length < n) { used.clear(); fresh = order; }
  const chosen = [], glosses = new Set();
  for (const w of fresh) {
    if (glosses.has(w.en.toLowerCase())) continue;
    chosen.push(w); glosses.add(w.en.toLowerCase());
    if (chosen.length === n) break;
  }
  return chosen;
}

// quiz_gen.distractors: k wrong answers of other meanings, without a shared character, similar length
function distractors(target, words, seed, k = 2) {
  const tchars = new Set(chars(target.han)), tlen = chars(target.han).length, ten = target.en.toLowerCase();
  const cands = words.filter(w => w.eligible && w.han !== target.han && w.en.toLowerCase() !== ten && !chars(w.han).some(c => tchars.has(c)))
    .map(w => [Math.abs(chars(w.han).length - tlen), h(seed, target.han, w.han), w])
    .sort((a, b) => a[0] - b[0] || bigCmp(a[1], b[1])).map(x => x[2]);
  const out = [], glosses = new Set([ten]);
  for (const w of cands) {
    if (glosses.has(w.en.toLowerCase())) continue;
    out.push(w); glosses.add(w.en.toLowerCase());
    if (out.length === k) break;
  }
  return out;
}

// Quiz number N (1, 2, 3 ...) of a type and level: the same as the N-th run of quiz_gen.py with history.json.
// The earlier runs are replayed to know which words they used, so no history file is needed.
export function buildQuiz(cfg, lists, overrides, kind, levels, number) {
  const words = loadWords(levels, lists, overrides), n = cfg[kind].questions, key = kind + '-L' + levels.join('+');
  const used = new Set();
  for (let r = 0; r < number - 1; r++) {
    for (const w of pick(kind, words, n, key + '-run' + r, used)) used.add(w.han);
  }
  const seed = key + '-run' + (number - 1);
  const items = pick(kind, words, n, seed, used).map(w => {
    const item = { han: w.han, pinyin: w.pinyin, en: w.en };
    if (kind === 'szoveges') {
      const opts = distractors(w, words, seed), pos = Number(h(seed, w.han, 'pos') % BigInt(opts.length + 1));
      opts.splice(pos, 0, w);
      item.options = opts.map(o => ({ han: o.han, pinyin: o.pinyin, en: o.en }));
      item.correct = pos;
    }
    return item;
  });
  const name = kind + '_hsk' + levels.join('-') + '_' + String(number).padStart(3, '0');
  return { name, kind, levels, seed, items };
}

// quiz_gen.pick_logo / pick_background: one file of the list, chosen by the seed
export const pickBySeed = (files, seed, salt) => (files.length ? files[Number(h(seed, salt) % BigInt(files.length))] : null);
