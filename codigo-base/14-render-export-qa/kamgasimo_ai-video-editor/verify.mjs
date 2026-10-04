#!/usr/bin/env node
// The quality gate. Measures what can be measured, names what cannot, and exits non-zero when any
// measured check fails.
//
//   node verify.mjs <render>
//        [--expect-text expected.txt | --expect-words words.json]   the words the render must carry
//        [--expect-duration secs | --timeline timeline.json]
//        [--size 1080x1920] [--fps 30] [--target -14] [--tp -1.5] [--tolerance 0.5]
//        [--fillers remove|keep] [--no-fillers] [--language en] [--glossary "A, B"] [--sheet frames.jpg]
//        [--no-words] [--audio-only] [--out report.json]
//
// Fillers are looked for three ways: in a filler-sensitive transcript; as long steady voiced hums in
// the audio; and each candidate is transcribed alone. A filler that decodes as one fails the gate. A
// candidate that decodes as a stock phrase ("Thank you.") where nothing was said is a non-word sound
// — reported as probable, for a person to listen to. With --timeline, each finding also names its time
// in the source, where a cut list is changed. --no-fillers skips the search on a file whose audio is
// that of a master already checked.

import { join, dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseArgs, die, run, probe, readJson, writeJson, tempDir, num, readPcm, SCRIPTS } from './common.mjs';
import { measure } from './loudness.mjs';
import { contactSheet } from './frames.mjs';
import { steadyRuns } from './acoustics.mjs';
import { fillerWords, FILLER_RE } from './cutlist.mjs';
const UNVERIFIED = ['pacing and the feel of each cut', 'whether the audio sounds natural', 'whether any music suits the video', 'overall taste'];

const args = parseArgs(process.argv.slice(2));
const render = args._[0];
if (!render) die('usage: verify.mjs <render> [--expect-text f | --expect-words f] [--expect-duration s | --timeline f] [--size WxH] [--fps n] [--sheet f] [--out f]');

const checks = [];
const check = (name, status, detail) => checks.push({ name, status, detail });
const node = (script, a) => run(process.execPath, [join(SCRIPTS, script), ...a]);
const FILLERS = fillerWords(typeof args.language === 'string' ? args.language : undefined);
const glossaryArgs = [...(typeof args.glossary === 'string' ? ['--glossary', args.glossary] : []), ...(typeof args.language === 'string' ? ['--language', args.language] : [])];

// ---------------------------------------------------------------- words

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// Words compared as tokens: lower case, no punctuation, spelled-out numbers as digits, no fillers.
// Each token keeps the start time of the word it came from, when it has one.
function tokens(items) {
  const raw = [];
  for (const it of items) {
    const parts = it.text.toLowerCase().replace(/[’]/g, "'").replace(/(\d),(\d)/g, '$1$2')
      .replace(/([0-9])([a-z])/g, '$1 $2').replace(/([a-z])([0-9])/g, '$1 $2')
      .replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean);
    for (const w of parts) raw.push({ w, t: it.start ?? null });
  }
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const { w, t } = raw[i];
    if (w in TENS) { const n = NUM.indexOf(raw[i + 1]?.w); if (n > 0 && n < 10) { out.push({ w: String(TENS[w] + n), t }); i++; } else out.push({ w: String(TENS[w]), t }); }
    else if (NUM.includes(w)) out.push({ w: String(NUM.indexOf(w)), t });
    else out.push({ w, t });
  }
  return out.filter((x) => !FILLERS.has(x.w));
}
// The words the render lacks and the words it adds, each placed at a time in the render: an added
// word where it is heard, a missing word where the render goes on without it.
function diffWords(expected, actual) {
  const n = expected.length, m = actual.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = expected[i].w === actual[j].w ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const missing = [], added = [];
  const near = (j) => actual[Math.min(j, m - 1)]?.t ?? null;
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (expected[i].w === actual[j].w) { i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) missing.push({ w: expected[i++].w, t: near(j) });
    else { added.push(actual[j]); j++; }
  }
  while (i < n) missing.push({ w: expected[i++].w, t: near(m) });
  while (j < m) added.push(actual[j++]);
  return { missing, added };
}

// ---------------------------------------------------------------- run

const tmp = tempDir('aive-gate-');
let result;
try {
  const p = probe(render);
  const fps = num(args.fps, p.video?.fps ?? 30);
  const frame = 1 / fps;
  const audioOnly = Boolean(args['audio-only']);

  check('decodes', p.streams.audio === 1 && (audioOnly ? p.streams.video === 0 : p.streams.video === 1) ? 'pass' : 'fail',
    `${p.streams.video} video · ${p.streams.audio} audio stream(s)${audioOnly ? ' — audio only' : ''}`);

  const timeline = args.timeline ? readJson(args.timeline) : null;
  const at = (t) => {
    const seg = timeline?.segments.find((x) => t >= x.outStart - 1e-6 && t < x.outEnd);
    return `${t.toFixed(2)}s${seg ? ` (source ${(seg.srcStart + t - seg.outStart).toFixed(2)}s)` : ''}`;
  };
  let expected = args['expect-duration'] !== undefined ? num(args['expect-duration']) : undefined;
  if (expected === undefined && timeline) expected = timeline.measured ?? timeline.planned;
  if (expected === undefined) check('duration', 'skipped', `measured ${p.duration.toFixed(3)}s — no expected duration given`);
  else check('duration', Math.abs(p.duration - expected) <= frame + 0.005 ? 'pass' : 'fail', `measured ${p.duration.toFixed(3)}s · expected ${expected.toFixed(3)}s`);

  if (audioOnly) check('streams in step', 'skipped', 'audio only');
  else if (p.video?.duration && p.audio?.duration) {
    const d = Math.abs(p.video.duration - p.audio.duration);
    check('streams in step', d <= frame + 0.005 ? 'pass' : 'fail', `video ${p.video.duration.toFixed(3)}s · audio ${p.audio.duration.toFixed(3)}s`);
  } else check('streams in step', 'skipped', 'a stream reports no duration');

  if (args.size && p.video) {
    const [w, h] = String(args.size).split('x').map(Number);
    const okFps = args.fps === undefined || Math.abs(p.video.fps - num(args.fps)) < 0.01;
    check('frame size and rate', p.video.width === w && p.video.height === h && okFps ? 'pass' : 'fail',
      `${p.video.width}×${p.video.height} @ ${p.video.fps.toFixed(3)} · expected ${w}×${h}${args.fps !== undefined ? ` @ ${num(args.fps)}` : ''}`);
  }

  const target = num(args.target, -14), tp = num(args.tp, -1.5), tol = num(args.tolerance, 0.5);
  const L = measure(render);
  check('loudness', Math.abs(L.integrated - target) <= tol && L.truePeak <= tp + 0.05 ? 'pass' : 'fail',
    `${L.integrated} LUFS (target ${target} ±${tol}) · true peak ${L.truePeak} dBTP (≤ ${tp})`);

  if (!args['no-words']) {
    const plainPath = join(tmp.dir, 'plain.json'), verbPath = join(tmp.dir, 'verbatim.json');
    node('transcribe.mjs', [render, '--mode', 'clean', '--out', plainPath, ...glossaryArgs]);
    const actual = tokens(readJson(plainPath));
    let expectedText = null;
    if (args['expect-words']) expectedText = readJson(args['expect-words']).map((w) => w.text).join(' ');
    if (args['expect-text']) expectedText = readFileSync(args['expect-text'], 'utf8');
    if (expectedText === null) check('words', 'skipped', 'no expected words given');
    else {
      const d = diffWords(tokens([{ text: expectedText }]), actual);
      const ok = !d.missing.length && !d.added.length;
      const list = (xs) => xs.map((x) => `"${x.w}"${x.t === null ? '' : ` at ${at(x.t)}`}`).join(', ') || '—';
      check('words', ok ? 'pass' : 'fail', ok ? `${actual.length} words, all present, none added`
        : `missing: ${list(d.missing)} · added: ${list(d.added)}`);
    }

    if (args.fillers === 'keep') check('fillers', 'skipped', 'fillers are kept by choice');
    else if (args['no-fillers']) check('fillers', 'skipped', 'checked on the master this file was made from');
    else {
      node('transcribe.mjs', [render, '--mode', 'verbatim', '--out', verbPath, ...glossaryArgs]);
      const reported = readJson(verbPath).filter((w) => FILLERS.has(w.text.toLowerCase().replace(/[^a-z]/g, '')));
      const confirmed = [], probable = [], settled = [];
      const sliceText = (a, b) => node('transcribe.mjs', [render, '--slice', `${Math.max(0, a).toFixed(2)}:${Math.min(p.duration, b).toFixed(2)}`, ...glossaryArgs]).stdout.toString();
      for (const w of reported) {
        let hit = false, nonSpeech = false;
        for (const [a, b] of [[w.start - 0.35, w.end + 0.55], [w.start, w.end + 1.0], [w.start + 0.25, w.end + 1.2]]) {
          if (b - a < 0.2) continue;
          const s = sliceText(a, b);
          if (FILLER_RE.test(s)) { hit = true; break; }
          if (/\[stock phrase/.test(s)) nonSpeech = true;
        }
        if (hit) { confirmed.push(`${at(w.start)} "${w.text}"`); settled.push(w.start); }
        else if (nonSpeech) { probable.push(`${at(w.start)} "${w.text}"`); settled.push(w.start); }
      }
      const runs = steadyRuns(readPcm(render, { rate: 16000 }));
      for (const r of runs) {
        if (settled.some((x) => Math.abs(x - r.start) < 0.6)) continue;
        const s = sliceText(r.start - 0.05, r.end + 0.05);
        const hum = `${at(r.start)} hum of ${(r.end - r.start).toFixed(2)}s`;
        if (FILLER_RE.test(s)) confirmed.push(hum);
        else if (/\[stock phrase|\[nothing decoded/.test(s)) probable.push(hum);
      }
      if (confirmed.length) check('fillers', 'fail', `confirmed: ${confirmed.join(', ')}${probable.length ? ` · probable: ${probable.join(', ')}` : ''}`);
      else if (probable.length) check('fillers', 'listen', `probable non-word sounds — listen at ${probable.join(', ')}`);
      else check('fillers', 'pass', `${reported.length} reported by transcript, ${runs.length} steady voiced runs checked, none confirmed`);
    }
  }

  if (p.video && !audioOnly) {
    const sheet = args.sheet || join(dirname(resolve(render)), `${p.path.split('/').pop().replace(/\.[^.]+$/, '')}-frames.jpg`);
    const times = Array.from({ length: 8 }, (_, i) => +((i + 0.5) * p.duration / 8).toFixed(2));
    contactSheet(render, times, { sheet });
    check('frames', 'look', `contact sheet ${sheet} — ${times.length} frames; look at it`);
  }

  result = { render: p.path, when: new Date().toISOString(), passed: !checks.some((c) => c.status === 'fail'), checks, unverified: UNVERIFIED };
} finally {
  tmp.cleanup();
}

if (args.out) writeJson(args.out, result);
const mark = { pass: 'PASS', fail: 'FAIL', skipped: 'skip', listen: 'LISTEN', look: 'LOOK' };
console.log('| Check | Result | Detail |\n|---|---|---|');
for (const c of result.checks) console.log(`| ${c.name} | ${mark[c.status]} | ${c.detail} |`);
console.log(`\nCannot be measured — for a person: ${result.unverified.join('; ')}.`);
console.log(result.passed ? '\nPASSED (measured checks)' : '\nFAILED');
process.exit(result.passed ? 0 : 1);
