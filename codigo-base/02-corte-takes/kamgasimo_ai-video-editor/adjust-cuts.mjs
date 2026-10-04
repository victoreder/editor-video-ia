#!/usr/bin/env node
// Change a cut list after looking closer — never by editing its keep list by hand.
//
//   node adjust-cuts.mjs cuts.json --clean clean.json [--expected expected.txt] [--duration secs]
//        [--remove a:b[:kind]] … [--words "and"] [--dismiss a:b] … [--restore a:b] … --why "what the evidence showed"
//
// --remove   takes a span out (kind: filler, retake, breath, noise, word; default filler) and resolves any
//            probable candidate it covers. A filler span that also takes a real word — an "and" fused to
//            its "uh" — names it with --words, from what the slice of the span heard
// --dismiss  keeps a probable candidate, recording that it was checked and why
// --restore  puts back every removal overlapping the span
// The keep list and the expected words are recomputed from the removals every time.

import { writeFileSync } from 'node:fs';
import { parseArgs, die, readJson, writeJson, probe, num } from './common.mjs';
import { keepFrom, expectedWords } from './cutlist.mjs';

const args = parseArgs(process.argv.slice(2));
const file = args._[0];
if (!file || !args.clean) die('usage: adjust-cuts.mjs cuts.json --clean clean.json [--expected f] [--remove a:b[:kind]] [--words "and"] [--dismiss a:b] [--restore a:b] --why "…"');
const cuts = readJson(file), clean = readJson(args.clean);
const why = typeof args.why === 'string' ? args.why : '';
const span = (s) => { const [a, b, kind] = String(s).split(':'); const x = { start: Number(a), end: Number(b), kind }; if (!(x.end > x.start)) die(`bad span ${s}`); return x; };
const overlaps = (r, x) => r.start < x.end && r.end > x.start;
cuts.removed ||= []; cuts.probable ||= []; cuts.checked ||= [];
const changes = [];

for (const s of [].concat(args.restore || [])) {
  const x = span(s), before = cuts.removed.length;
  cuts.removed = cuts.removed.filter((r) => !overlaps(r, x));
  changes.push(`restored ${before - cuts.removed.length} removal(s) in ${x.start}–${x.end}`);
}
for (const s of [].concat(args.remove || [])) {
  const x = span(s);
  if (!why) die('--remove needs --why, the evidence for the cut');
  const words = typeof args.words === 'string' ? args.words.split(/[,\s]+/).filter(Boolean) : undefined;
  cuts.removed.push({ start: x.start, end: x.end, kind: x.kind || 'filler', ...(words ? { words } : {}), evidence: [why], confidence: 'confirmed', decidedOnReview: true });
  const resolved = cuts.probable.filter((p) => overlaps(p, x));
  cuts.probable = cuts.probable.filter((p) => !overlaps(p, x));
  cuts.checked.push(...resolved.map((p) => ({ ...p, outcome: 'removed', why })));
  changes.push(`removed ${x.start}–${x.end} (${x.kind || 'filler'})${resolved.length ? `, resolving ${resolved.length} probable` : ''}`);
}
for (const s of [].concat(args.dismiss || [])) {
  const x = span(s);
  const hit = cuts.probable.filter((p) => overlaps(p, x));
  cuts.probable = cuts.probable.filter((p) => !overlaps(p, x));
  cuts.checked.push(...hit.map((p) => ({ ...p, outcome: 'kept', why })));
  changes.push(`kept ${hit.length} probable candidate(s) in ${x.start}–${x.end}`);
}

const duration = num(args.duration, probe(cuts.source).duration);
cuts.removed.sort((a, b) => a.start - b.start);
cuts.keep = keepFrom(cuts.removed, duration);
writeJson(file, cuts);
if (typeof args.expected === 'string') writeFileSync(args.expected, expectedWords(clean, cuts.removed, cuts.settings?.language).join(' ') + '\n');

const kept = cuts.keep.reduce((s, k) => s + k.end - k.start, 0);
for (const c of changes) console.log(c);
console.log(`${cuts.keep.length} segments · ${kept.toFixed(2)}s kept · ${cuts.probable.length} probable left${cuts.probable.length ? `: ${cuts.probable.map((p) => `${p.start}–${p.end}`).join(', ')}` : ''}`);
