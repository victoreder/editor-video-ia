#!/usr/bin/env node
// Long video → Shorts: the self-contained moments worth cutting out, ranked.
//
//   node moments.mjs --work WORK [--count 5] [--min 20] [--max 60]
//
// Reads the source's clean transcript (WORK/clean.json). A moment is a run of whole sentences between
// --min and --max seconds. It scores for what makes a Short work on its own:
//   hook        its first sentence grabs: a question, a number, "you", a strong word, and it is short
//   standalone  it does not open on a word that points back ("and", "but", "so", "this", "it"…)
//   payoff      it ends on a full stop or an exclamation, ideally a conclusion ("that's why", "the key")
//   energy      how densely it is spoken
// The best non-overlapping moments are printed with their text; judge them — the score only shortlists.

import { join } from 'node:path';
import { parseArgs, die, readJson, writeJson, num, isMain } from './common.mjs';

const POWER = /\b(secret|mistake|never|always|best|worst|free|money|fast|easy|simple|truth|wrong|nobody|everyone|stop|how to|why|biggest|only)\b/i;
const DANGLING = /^(and|but|so|because|also|this|that|these|those|it|they|then|which|or)$/i;
const PAYOFF = /\b(that's why|the key|remember|so if you|the point|bottom line|in short|that is how|that's how)\b/i;

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.work !== 'string') die('usage: moments.mjs --work WORK [--count n] [--min s] [--max s]');
  const words = readJson(join(args.work, 'clean.json'));
  const min = num(args.min, 20), max = num(args.max, 60), count = num(args.count, 5);
  const sents = []; let cur = [];
  for (const w of words) { cur.push(w); if (/[.?!]$/.test(w.text)) { sents.push(cur); cur = []; } }
  if (cur.length) sents.push(cur);
  const text = (s) => s.map((w) => w.text).join(' ');
  const cands = [];
  for (let i = 0; i < sents.length; i++) {
    for (let j = i; j < sents.length; j++) {
      const start = sents[i][0].start, end = sents[j][sents[j].length - 1].end, d = end - start;
      if (d > max) break;
      if (d < min) continue;
      const first = text(sents[i]), last = text(sents[j]), n = sents.slice(i, j + 1).reduce((s, x) => s + x.length, 0);
      let score = 0;
      const why = [];
      if (/\?$/.test(first)) { score += 3; why.push('opens on a question'); }
      if (/\d/.test(first)) { score += 2; why.push('a number up front'); }
      if (/\byou\b/i.test(first)) { score += 1; why.push('speaks to the viewer'); }
      if (POWER.test(first)) { score += 1.5; why.push('a strong opening word'); }
      if (sents[i].length <= 12) { score += 1; why.push('a short first line'); }
      if (DANGLING.test(sents[i][0].text.replace(/[^\p{L}']/gu, ''))) { score -= 3; why.push('opens pointing back'); }
      if (/[.!]$/.test(last)) score += 1;
      if (PAYOFF.test(last) || PAYOFF.test(text(sents.slice(i, j + 1).flat()))) { score += 1.5; why.push('lands a conclusion'); }
      score += Math.min(2, (n / d) / 1.5);
      score += 1 - Math.min(1, Math.abs(d - 35) / 25);
      cands.push({ start: +start.toFixed(2), end: +end.toFixed(2), duration: +d.toFixed(1), score: +score.toFixed(2), why, opening: first, closing: last });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) { if (picked.length >= count) break; if (picked.every((p) => c.end <= p.start || c.start >= p.end)) picked.push(c); }
  picked.sort((a, b) => a.start - b.start);
  writeJson(join(args.work, 'moments.json'), picked);
  if (!picked.length) console.log(`no moment between ${min} and ${max} s — the recording may be too short for Shorts`);
  picked.forEach((p, k) => console.log(`${k + 1}. ${p.start}–${p.end}s (${p.duration}s) score ${p.score} — ${p.why.join(', ')}\n   “${p.opening}” … “${p.closing}”`));
  console.log(`→ ${join(args.work, 'moments.json')}`);
}
