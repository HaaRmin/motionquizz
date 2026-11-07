// Word picking and quiz building, ported from quiz_gen.py. The same seed, levels and data files give the same
// words, wrong answers and answer order as the Python generator; the page makes a new random seed for every quiz.
import { sha256hex } from './sha256.js?v=__BUILD__';

const ELIGIBLE_POS = new Set(['n', 'v', 'a', 'vn', 'an', 't', 's', 'f', 'nz']);
// h(): the integer value of sha256("a|b|c"), exactly like quiz_gen.h()
export const h = (...parts) => BigInt('0x' + sha256hex(parts.map(String).join('|')));
const bigCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const chars = s => Array.from(s);

// data/overrides.csv (han,en,action,pinyin) and data/groups.csv; a small CSV reader that understands quoted fields
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
      const w = Object.assign({}, w0, o && o.en.trim() ? { en: o.en.trim() } : {}, o && (o.pinyin || '').trim() ? { pinyin: o.pinyin.trim() } : {});
      w.eligible = action === 'include' || (!w.multi && w.pos.length > 0 && ELIGIBLE_POS.has(w.pos[0]));
      words.push(w);
    }
  }
  return words;
}

// quiz_gen.group_questions: n questions from one set or topic, the groups tried in the seed's order; in the group
// the words in the seed's order, never two with the same English meaning or of one "same" group
function groupQuestions(pool, n, seed, used, groups) {
  const byHan = new Map(pool.map(w => [w.han, w]));
  const rows = groups.rows.filter(r => r.kind === 'set' || r.kind === 'topic')
    .map(r => [h(seed, 'group', r.group), r]).sort((a, b) => bigCmp(a[0], b[0])).map(x => x[1]);
  for (const row of rows) {
    const cands = row.words.filter(x => byHan.has(x) && !used.has(x)).map(x => byHan.get(x))
      .map(w => [h(seed, w.han), w]).sort((a, b) => bigCmp(a[0], b[0])).map(x => x[1]);
    const chosen = [], glosses = new Set();
    for (const w of cands) {
      if (glosses.has(w.en.toLowerCase()) || chosen.some(c => (groups.same.get(c.han) || new Set()).has(w.han))) continue;
      chosen.push(w); glosses.add(w.en.toLowerCase());
      if (chosen.length === n) return [chosen, row];
    }
  }
  return [null, null];
}

// quiz_gen.pick: the quiz's words and their group; without a group with n words, the next n words for this seed
function pick(kind, words, n, seed, used, groups) {
  const pool = words.filter(w => w.eligible && (kind !== 'kepes' || (chars(w.han).length >= 1 && chars(w.han).length <= 4)));
  if (groups && groups.rows.length) { // the three questions always share a group
    let [chosen, row] = groupQuestions(pool, n, seed, used, groups);
    if (!chosen && used.size) { used.clear(); [chosen, row] = groupQuestions(pool, n, seed, used, groups); }
    if (chosen) return [chosen, row];
  }
  const order = pool.map(w => [h(seed, w.han), w]).sort((a, b) => bigCmp(a[0], b[0])).map(x => x[1]);
  let fresh = order.filter(w => !used.has(w.han));
  if (fresh.length < n) { used.clear(); fresh = order; }
  const chosen = [], glosses = new Set();
  for (const w of fresh) {
    if (glosses.has(w.en.toLowerCase())) continue;
    chosen.push(w); glosses.add(w.en.toLowerCase());
    if (chosen.length === n) break;
  }
  return [chosen, null];
}

// quiz_gen.load_groups: data/groups.csv rows -> per word the words of its sets, its topics and its "same" groups
export function loadGroups(rows) {
  const groups = { set: new Map(), topic: new Map(), same: new Map(), rows: [] };
  for (const r of rows) {
    const kind = (r.kind || '').trim(), words = (r.words || '').split(';').map(x => x.trim()).filter(Boolean);
    groups.rows.push({ group: (r.group || '').trim(), kind, label: (r.label || '').trim(), words });
    if (!groups[kind] || kind === 'rows') continue;
    for (const x of words) {
      if (!groups[kind].has(x)) groups[kind].set(x, new Set());
      for (const y of words) if (y !== x) groups[kind].get(x).add(y);
    }
  }
  return groups;
}

// quiz_gen.distractor_levels: wrong answers may come from the chosen levels and the ones below them
export const distractorLevels = levels => Array.from({ length: Math.max(...levels.map(Number)) }, (_, i) => String(i + 1));

// quiz_gen.distractors: k wrong answers, in this order until there are k: the same set, the same topic, the same
// word type and a similar length, then any word. Shared characters only in the set and topic steps; never the same
// English meaning, never a word of the target's "same" group, never two wrong answers of one "same" group.
function distractors(target, words, seed, groups, k = 2) {
  const tchars = new Set(chars(target.han)), tlen = chars(target.han).length, ten = target.en.toLowerCase();
  const never = new Set([target.han, ...(groups.same.get(target.han) || [])]);
  const tpos = target.pos.slice(0, 1).join(), byHan = new Map(words.map(w => [w.han, w]));
  const key = w => h(seed, target.han, w.han), shares = w => chars(w.han).some(c => tchars.has(c));
  const byKey = list => list.map(w => [key(w), w]).sort((a, b) => bigCmp(a[0], b[0])).map(x => x[1]);
  const mates = kind => [...(groups[kind].get(target.han) || [])].filter(x => byHan.has(x)).map(x => byHan.get(x));
  const tiers = [
    byKey(mates('set')),
    byKey(mates('topic')),
    byKey(words.filter(w => w.pos.slice(0, 1).join() === tpos && Math.abs(chars(w.han).length - tlen) <= 1 && !shares(w))),
    words.filter(w => !shares(w)).map(w => [Math.abs(chars(w.han).length - tlen), key(w), w])
      .sort((a, b) => a[0] - b[0] || bigCmp(a[1], b[1])).map(x => x[2]),
  ];
  const out = [], glosses = new Set([ten]);
  for (const tier of tiers) {
    for (const w of tier) {
      if (!w.eligible || never.has(w.han) || glosses.has(w.en.toLowerCase()) || out.includes(w)
        || out.some(o => (groups.same.get(o.han) || new Set()).has(w.han))) continue;
      out.push(w); glosses.add(w.en.toLowerCase());
      if (out.length === k) return out;
    }
  }
  return out;
}

// A new quiz for the seed: its words from one group of the chosen levels, the wrong answers of a text quiz from
// the chosen levels and the ones below them. The page passes a new random seed every time, so every quiz is new.
export function buildQuiz(cfg, lists, overrides, groups, kind, levels, seed) {
  const words = loadWords(levels, lists, overrides), pool = loadWords(distractorLevels(levels), lists, overrides);
  const [chosen, group] = pick(kind, words, cfg[kind].questions, seed, new Set(), groups);
  const items = chosen.map(w => {
    const item = { han: w.han, pinyin: w.pinyin, en: w.en };
    if (kind === 'szoveges') {
      const opts = distractors(w, pool, seed, groups), pos = Number(h(seed, w.han, 'pos') % BigInt(opts.length + 1));
      opts.splice(pos, 0, w);
      item.options = opts.map(o => ({ han: o.han, pinyin: o.pinyin, en: o.en }));
      item.correct = pos;
    }
    return item;
  });
  const d = new Date(), two = x => String(x).padStart(2, '0');
  const stamp = d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
  return { name: kind + '_hsk' + levels.join('-') + '_' + stamp, kind, levels, seed, group: group ? group.label : null, items };
}

// quiz_gen.pick_logo / pick_background: one file of the list, chosen by the seed
export const pickBySeed = (files, seed, salt) => (files.length ? files[Number(h(seed, salt) % BigInt(files.length))] : null);
