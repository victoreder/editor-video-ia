#!/usr/bin/env node
// A first cut list from the transcripts and the measured audio — every removal with its evidence.
//
//   node plan-cuts.mjs <media> --clean clean.json --verbatim verbatim.json --acoustics acoustics.json
//        --out cuts.json [--expected expected.txt]
//        [--remove fillers,pauses,retakes,deadair | none] [--sentence-pause 0.3] [--clause-pause 0.2]
//        [--lead 0.15] [--tail 0.35] [--probable keep|remove] [--face x,y] [--mouth y] [--punch 1.12]
//        [--language en] [--from s --to s]
//
// --from/--to limit the cut to one span of the source — a Short taken from a long recording: everything
// outside it goes as dead air, and fillers, retakes and pauses are looked for inside it only.
//
// --face is the centre of the speaker's face and --mouth the height of their mouth, in source pixels:
// punch-ins zoom around the face, reframes keep it in the crop, and captions stay clear of the mouth.
//
// What it finds:
//   dead air   before the first word and after the last, beyond a short lead-in and tail
//   fillers    reported by the verbatim transcript or measured as a steady voiced hum, each located by
//              its acoustic extent and confirmed by transcribing that span alone
//   pauses     silences longer than the target — shortened, never removed — measured across a removed
//              filler, so no long gap is left where the filler was
//   retakes    a sentence whose opening words repeat at the start of a later one within 25 s: the
//              earlier, abandoned take goes
// What it cannot confirm is marked probable and, by default, kept. The expected words — what the cut
// must still say — are written for the verification step.

import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { parseArgs, die, run, readJson, writeJson, probe, num, SCRIPTS } from './common.mjs';
import { fillerWords, FILLER_RE, stripFillers, norm, keepFrom, expectedWords } from './cutlist.mjs';

const args = parseArgs(process.argv.slice(2));
const media = args._[0];
if (!media || !args.clean || !args.verbatim || !args.acoustics || !args.out) die('usage: plan-cuts.mjs <media> --clean f --verbatim f --acoustics f --out cuts.json [options]');

// Everything by default; "none" keeps the whole recording and only measures it.
const removeArg = args.remove === undefined ? 'fillers,pauses,retakes,deadair' : String(args.remove);
const remove = new Set(removeArg === 'none' ? [] : removeArg.split(',').map((s) => s.trim()).filter(Boolean));
const sentencePause = num(args['sentence-pause'], 0.3);
const clausePause = num(args['clause-pause'], 0.2);
const lead = num(args.lead, 0.15), tail = num(args.tail, 0.35);
const removeProbable = args.probable === 'remove';
const language = typeof args.language === 'string' ? args.language : undefined;
const langArgs = language ? ['--language', language] : [];
const FILLERS = fillerWords(language);
const cleanAll = readJson(args.clean), verbatimAll = readJson(args.verbatim), ac = readJson(args.acoustics);
const duration = probe(media).duration;
const from = num(args.from, 0), to = num(args.to, duration);
const inRange = (t) => t >= from - 0.05 && t < to + 0.05;
const clean = cleanAll.filter((w) => inRange(w.start)), verbatim = verbatimAll.filter((w) => inRange(w.start));
const db = ac.envelope.db, thr = ac.threshold;

// ---------------------------------------------------------------- slices

function slice(a, b) {
  const r = run(process.execPath, [join(SCRIPTS, 'transcribe.mjs'), media, '--slice', `${Math.max(0, a).toFixed(2)}:${Math.min(duration, b).toFixed(2)}`, ...langArgs]);
  return r.stdout.toString().replace(/^\S+\s+/, '').trim();
}
// filler-only: the span decodes to a filler and nothing else, so cutting it removes no word.
function classify(text) {
  if (FILLER_RE.test(text)) {
    const rest = stripFillers(text.replace(/\[[^\]]*\]/g, '')).replace(/[^\p{L}\p{N}]+/gu, '');
    return rest ? 'filler' : 'filler-only';
  }
  if (!text || /\[stock phrase|\[nothing decoded/.test(text)) return 'nonspeech';
  return 'words';
}

// ---------------------------------------------------------------- speech mask

const N = db.length;
const speech = new Uint8Array(N);
for (let i = 0; i < N; i++) speech[i] = db[i] >= thr ? 1 : 0;
const idx = (t) => Math.max(0, Math.min(N - 1, Math.round(t * 100)));

// Speech as runs of sound, bridging gaps under 0.1 s. A burst shorter than 0.2 s — a click, a lip
// smack, a chair — is not speech, so it never decides where the video starts or ends.
function speechRuns() {
  const runs = [];
  for (let i = 0; i < N;) {
    if (!speech[i]) { i++; continue; }
    let j = i; while (j < N && speech[j]) j++;
    const last = runs[runs.length - 1];
    if (last && i - last.e <= 10) last.e = j; else runs.push({ s: i, e: j });
    i = j;
  }
  return runs.filter((r) => r.e - r.s >= 20).map((r) => ({ start: r.s / 100, end: r.e / 100 }));
}
const runsOfSpeech = speechRuns().filter((r) => r.end > from && r.start < to).map((r) => ({ start: Math.max(r.start, from), end: Math.min(r.end, to) }));
// The first moment after a, before b, that stays below the speech threshold for 60 ms.
function soundEnd(a, b) {
  for (let i = idx(a); i < idx(b); i++) {
    let quiet = true;
    for (let k = i; k < i + 6 && k < N; k++) if (db[k] >= thr) { quiet = false; break; }
    if (quiet) return i / 100;
  }
  return b;
}
function firstOnset() { return runsOfSpeech.length ? runsOfSpeech[0].start : 0; }
function lastEnd() { return runsOfSpeech.length ? runsOfSpeech[runsOfSpeech.length - 1].end : duration; }

const removed = [];
const probable = [];
const add = (list, r) => list.push({ ...r, start: +r.start.toFixed(2), end: +r.end.toFixed(2) });

// ---------------------------------------------------------------- dead air

const t0 = firstOnset(), t1 = lastEnd();
if (remove.has('deadair') || args.from !== undefined || args.to !== undefined) {
  if (t0 - lead > 0.05) add(removed, { start: 0, end: t0 - lead, kind: 'dead-air', evidence: [`first speech onset at ${t0.toFixed(2)}s`] });
  if (duration - (t1 + tail) > 0.05) add(removed, { start: t1 + tail, end: duration, kind: 'dead-air', evidence: [`last speech ends at ${t1.toFixed(2)}s`] });
}

// ---------------------------------------------------------------- fillers

const fillerSpans = [];
if (remove.has('fillers')) {
  const runs = (ac.steadyRuns || []).filter((r) => r.start >= from && r.end <= to);
  const used = new Set();
  const reported = verbatim.filter((w) => FILLERS.has(norm(w.text)));
  const settled = (t) => fillerSpans.some((f) => t >= f.start - 1.0 && t <= f.end + 1.0);
  // A filler is confirmed only when its span, heard alone, decodes to a filler and nothing else: then
  // cutting it takes no word. A span that also holds words, or decodes as a stock phrase, is probable.
  const decide = (rec, kind) => {
    if (kind === 'filler-only') { add(removed, { ...rec, confidence: 'confirmed' }); fillerSpans.push(rec); return; }
    const note = kind === 'nonspeech' ? [] : ['the span also holds words — locate the filler inside it before cutting'];
    add(probable, { ...rec, confidence: 'probable', evidence: [...rec.evidence, ...note] });
    if (kind === 'nonspeech' && removeProbable) { add(removed, { ...rec, confidence: 'probable' }); fillerSpans.push(rec); }
  };
  const rank = { 'filler-only': 3, filler: 2, nonspeech: 1, words: 0 };
  for (const w of reported) {
    if (settled(w.start)) continue;
    // The steady runs near the reported time, within the drift a transcript's timings carry, nearest
    // first. A span decodes most reliably with the quiet after it, so each is heard over a window
    // reaching to the next word, and cut over its measured extent. A run that also carries a word —
    // the end of "and" running into "um" — is heard again from the reported filler on.
    const near = runs.map((r, i) => ({ r, i, d: Math.abs((r.start + r.end) / 2 - (w.start + w.end) / 2) }))
      .filter(({ r, i }) => !used.has(i) && r.end >= w.start - 0.6 && r.start <= w.end + 1.2)
      .sort((x, y) => x.d - y.d).slice(0, 3);
    const window = (r) => [r.start - 0.03, Math.max(r.end, w.end) + 0.03];
    let best = null;
    for (const c of near) {
      const over = window(c.r), heard = slice(...over);
      let cand = { r: c.r, i: c.i, heard, kind: classify(heard), over };
      if (cand.kind === 'filler' || cand.kind === 'words') {
        const part = { start: Math.max(c.r.start, w.start - 0.05), end: Math.min(c.r.end, w.end) };
        if (part.end - part.start >= 0.2 && part.start > c.r.start + 0.05) {
          const over2 = window(part), heard2 = slice(...over2), kind2 = classify(heard2);
          if (rank[kind2] > rank[cand.kind]) cand = { r: part, i: c.i, heard: heard2, kind: kind2, over: over2 };
        }
      }
      if (cand.kind !== 'words' && (!best || rank[cand.kind] > rank[best.kind])) best = cand;
      if (best?.kind === 'filler-only') break;
    }
    let extent, heard, kind, over;
    if (best) { ({ r: extent, heard, kind, over } = best); used.add(best.i); }
    else {
      // No run: the transcript's timing places the filler, and it ends where the sound stops, not
      // where the next word starts.
      extent = { start: w.start, end: Math.max(w.start + 0.15, soundEnd(w.start, w.end)) };
      over = window(extent); heard = slice(...over); kind = classify(heard);
    }
    decide({
      start: extent.start, end: extent.end, kind: 'filler', text: w.text.replace(/[^\p{L}\p{N}']/gu, ''),
      evidence: [`verbatim transcript: "${w.text}" at ${w.start.toFixed(2)}s`,
        best ? `acoustic: steady voiced run ${extent.start.toFixed(2)}–${extent.end.toFixed(2)}s`
          : `acoustic: no steady run near — from the transcript's start to where the sound stops, ${extent.start.toFixed(2)}–${extent.end.toFixed(2)}s`,
        `slice ${Math.max(0, over[0]).toFixed(2)}–${over[1].toFixed(2)}s: "${heard}"`],
    }, kind);
  }
  // steady hums no transcript reported
  runs.forEach((r, i) => {
    if (used.has(i)) return;
    const heard = slice(r.start - 0.03, r.end + 0.03);
    const kind = classify(heard);
    if (kind === 'words') return;
    decide({ start: r.start, end: r.end, kind: 'filler', text: 'hum', evidence: [`acoustic: steady voiced run ${r.start.toFixed(2)}–${r.end.toFixed(2)}s, not in any transcript`, `slice: "${heard}"`] }, kind);
  });
  for (const f of fillerSpans) for (let i = idx(f.start); i <= idx(f.end); i++) speech[i] = 0;
}

// ---------------------------------------------------------------- retakes

if (remove.has('retakes')) {
  const sentences = [];
  let cur = [];
  for (const w of clean) { cur.push(w); if (/[.?!]$/.test(w.text)) { sentences.push(cur); cur = []; } }
  if (cur.length) sentences.push(cur);
  const head = (s, n) => s.slice(0, n).map((w) => norm(w.text)).filter(Boolean).join(' ');
  for (let i = 0; i < sentences.length; i++) for (let j = i + 1; j < sentences.length; j++) {
    const a = sentences[i], b = sentences[j];
    if (b[0].start - a[0].start > 25) break;
    if (a.length < 3 || b.length < 3) continue;
    const four = head(a, 4) === head(b, 4) && head(a, 4).split(' ').length === 4;
    const three = head(a, 3) === head(b, 3);
    if (!three) continue;
    const snapBack = (t) => { let k = idx(t); while (k > 0 && speech[k - 1]) k--; return Math.max(0, k / 100 - 0.05); };
    const rec = { start: snapBack(a[0].start), end: snapBack(b[0].start), kind: 'retake', text: a.map((w) => w.text).join(' '),
      evidence: [`opening "${head(a, 4)}" repeats at ${b[0].start.toFixed(2)}s: "${b.map((w) => w.text).join(' ')}"`] };
    if (rec.end - rec.start < 0.3) continue;
    if (four) { add(removed, { ...rec, confidence: 'confirmed' }); for (let k = idx(rec.start); k <= idx(rec.end); k++) speech[k] = 0; }
    else add(probable, { ...rec, confidence: 'probable' });
    break;
  }
}

// ---------------------------------------------------------------- pauses

if (remove.has('pauses')) {
  const endsSentenceBefore = (t) => {
    let last = null;
    for (const w of clean) { if (w.start <= t + 0.2) last = w; else break; }
    return last ? /[.?!]$/.test(last.text) : false;
  };
  for (let i = idx(t0); i < idx(t1);) {
    if (speech[i]) { i++; continue; }
    let j = i; while (j < N && !speech[j]) j++;
    const a = i / 100, b = j / 100, gap = b - a;
    const target = endsSentenceBefore(a) ? sentencePause : clausePause;
    if (gap > target + 0.05) add(removed, { start: a + target / 2, end: b - target / 2, kind: 'pause', evidence: [`silence ${a.toFixed(2)}–${b.toFixed(2)}s (${gap.toFixed(2)}s) shortened to ${target}s`] });
    i = j;
  }
}

// ---------------------------------------------------------------- keep list and expected words

const keep = keepFrom(removed, duration);
const expected = expectedWords(cleanAll, removed, language);

const face = typeof args.face === 'string' ? (([x, y]) => ({ x, y, ...(args.mouth !== undefined ? { mouth: num(args.mouth) } : {}) }))(args.face.split(',').map(Number)) : undefined;
const cuts = {
  source: resolve(media), ...(face ? { face } : {}), punchIn: num(args.punch, 1.12),
  keep, removed: removed.sort((x, y) => x.start - y.start), probable: probable.sort((x, y) => x.start - y.start),
  settings: { remove: [...remove], sentencePause, clausePause, lead, tail, probable: removeProbable ? 'remove' : 'keep', ...(language ? { language } : {}), ...(args.from !== undefined || args.to !== undefined ? { range: [from, to] } : {}) },
};
writeJson(args.out, cuts);
if (args.expected) writeFileSync(args.expected, expected.join(' ') + '\n');

const total = keep.reduce((s, k) => s + k.end - k.start, 0);
const byKind = {};
for (const r of removed) byKind[r.kind] = +((byKind[r.kind] || 0) + r.end - r.start).toFixed(2);
console.log(`${keep.length} segments kept · ${total.toFixed(2)}s of ${duration.toFixed(2)}s · removed ${Object.entries(byKind).map(([k, v]) => `${k} ${v}s`).join(', ') || 'nothing'}`);
for (const r of removed.filter((x) => x.kind !== 'pause')) console.log(`  − ${r.kind.padEnd(8)} ${r.start.toFixed(2)}–${r.end.toFixed(2)}  ${r.text ?? ''}  (${r.confidence ?? 'measured'})`);
for (const p of probable) console.log(`  ? ${p.kind.padEnd(8)} ${p.start.toFixed(2)}–${p.end.toFixed(2)}  ${p.text ?? ''}  — ${p.evidence[p.evidence.length - 1]}`);
console.log(`→ ${args.out}${args.expected ? `\n→ ${args.expected}` : ''}`);
