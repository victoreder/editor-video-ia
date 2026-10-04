#!/usr/bin/env node
// The measured audio a cut is decided on: where speech is, where it pauses, and — across a span —
// what kind of sound each 30 ms holds.
//
//   node acoustics.mjs <media> [--out acoustics.json] [--min-pause 0.15]
//   node acoustics.mjs <media> --from 8.3 --to 9.6 [--step 0.03]
//
// The span view prints energy, voicing (0–1), pitch, zero-crossing rate and brightness per frame. A
// filler ("um", "uh") is a steady voiced run: flat pitch, almost no brightness. The end of a word
// like "ways" is the opposite: unvoiced, bright, a high zero-crossing rate.

import { parseArgs, die, readPcm, writeJson, num, isMain } from './common.mjs';

export const RATE = 16000;

export function envelope(pcm, win = RATE / 100) {
  const out = new Float64Array(Math.floor(pcm.length / win));
  for (let i = 0; i < out.length; i++) {
    let s = 0; const o = i * win;
    for (let k = o; k < o + win; k++) s += pcm[k] * pcm[k];
    out[i] = 20 * Math.log10(Math.sqrt(s / win) / 32768 + 1e-9);
  }
  return out;
}

export function levels(db) {
  const sorted = Array.from(db).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.05)];
  const speech = sorted[Math.floor(sorted.length * 0.9)];
  return { floor, speech, threshold: floor + (speech - floor) * 0.3 };
}

export function pauses(db, threshold, minPause) {
  const out = []; let run = null;
  for (let i = 0; i <= db.length; i++) {
    const quiet = i < db.length && db[i] < threshold;
    if (quiet && run === null) run = i;
    if (!quiet && run !== null) {
      if ((i - run) / 100 >= minPause) out.push({ start: run / 100, end: i / 100, duration: +((i - run) / 100).toFixed(2) });
      run = null;
    }
  }
  return out;
}

export function frameFeatures(pcm, at) {
  const i = Math.round(at * RATE), n = 640;
  if (i < 0 || i + n > pcm.length) return null;
  let mean = 0; for (let k = 0; k < n; k++) mean += pcm[i + k]; mean /= n;
  const f = new Float64Array(n); let energy = 0;
  for (let k = 0; k < n; k++) { f[k] = pcm[i + k] - mean; energy += f[k] * f[k]; }
  const db = 20 * Math.log10(Math.sqrt(energy / n) / 32768 + 1e-9);
  let best = 0, lag = 0;
  for (let L = Math.floor(RATE / 400); L < Math.floor(RATE / 70); L++) {
    let c = 0; for (let k = 0; k + L < n; k++) c += f[k] * f[k + L];
    c /= energy + 1e-9;
    if (c > best) { best = c; lag = L; }
  }
  let zc = 0; for (let k = 1; k < 320; k++) if ((f[k - 1] < 0) !== (f[k] < 0)) zc++;
  let diff = 0, sig = 0; for (let k = 1; k < 320; k++) { diff += (f[k] - f[k - 1]) ** 2; sig += f[k] * f[k]; }
  return { t: +at.toFixed(2), db: +db.toFixed(1), voicing: +best.toFixed(2), f0: lag ? Math.round(RATE / lag) : 0, zcr: Math.round(zc / 320 * RATE / 2), brightness: +(diff / (sig + 1)).toFixed(2) };
}

// Long voiced runs with a flat pitch and no brightness — where a filler can hide inside a word.
export function steadyRuns(pcm, { minDuration = 0.45, from = 0, to } = {}) {
  const end = to ?? pcm.length / RATE - 0.05;
  const frames = [];
  for (let t = from; t < end; t += 0.03) frames.push(frameFeatures(pcm, t));
  const steady = (x) => x && x.voicing >= 0.55 && x.brightness <= 0.05 && x.f0 > 60 && x.db > -45;
  const runs = [];
  for (let i = 0, s = null; i <= frames.length; i++) {
    const good = i < frames.length && steady(frames[i]);
    if (good && s === null) s = i;
    if (!good && s !== null) { if ((i - s) * 0.03 >= minDuration) runs.push({ start: frames[s].t, end: +(frames[i - 1].t + 0.03).toFixed(2) }); s = null; }
  }
  return runs;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const media = args._[0];
  if (!media) die('usage: acoustics.mjs <media> [--out file] [--min-pause s] | --from a --to b [--step s]');
  const pcm = readPcm(media, { rate: RATE });
  if (args.from !== undefined) {
    const from = num(args.from), to = num(args.to, from + 1), step = num(args.step, 0.03);
    console.log('    t     dB  voiced   f0   zcrHz  bright');
    for (let t = from; t < to; t += step) {
      const x = frameFeatures(pcm, t);
      if (!x) break;
      console.log(`${x.t.toFixed(2).padStart(6)} ${x.db.toFixed(0).padStart(5)}   ${x.voicing.toFixed(2)}  ${String(x.f0).padStart(4)}  ${String(x.zcr).padStart(6)}  ${'#'.repeat(Math.min(30, Math.round(x.brightness * 30)))}`);
    }
  } else {
    const minPause = num(args['min-pause'], 0.15);
    const db = envelope(pcm);
    const lv = levels(db);
    const ps = pauses(db, lv.threshold, minPause);
    const result = {
      duration: +(pcm.length / RATE).toFixed(3),
      floor: +lv.floor.toFixed(1), speech: +lv.speech.toFixed(1), threshold: +lv.threshold.toFixed(1),
      minPause, pauses: ps, steadyRuns: steadyRuns(pcm),
      envelope: { stepSeconds: 0.01, db: Array.from(db, (v) => +v.toFixed(1)) },
    };
    if (args.out) writeJson(args.out, result);
    console.log(`floor ${result.floor} dB · speech ${result.speech} dB · threshold ${result.threshold} dB · ${ps.length} pauses ≥ ${minPause}s · ${result.steadyRuns.length} steady voiced runs`);
    for (const p of ps) console.log(`  quiet ${p.start.toFixed(2).padStart(7)} – ${p.end.toFixed(2).padStart(7)}  (${p.duration.toFixed(2)}s)`);
  }
}
