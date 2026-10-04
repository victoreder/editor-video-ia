#!/usr/bin/env node
// The music bed: found, fitted to the video's length, and measured for its beats.
//
//   node music.mjs --duration 22.36 --out music.wav --json music.json
//        (--file song.mp3 | --library "upbeat energetic electronic" | --generate upbeat|calm|cinematic)
//        [--work dir] [--seed n]
//
// --file      the user's own track
// --library   a real track from HeyGen's free music library, searched by the mood words — needs the
//             `heygen` command line signed in (only the mood words are sent). Exits with status 3 and a
//             reason when the library cannot be reached, so the caller can fall back
// --generate  a bed synthesised on this machine (synth.mjs)
//
// Fitting: a longer track starts at its first sound and fades out over the last 1.5 s of the video; a
// shorter one loops with a one-second crossfade. Beats are found from the onset envelope — tempo by
// autocorrelation, phase by the grid that best matches the onsets — so a transition can land on one.

import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, die, run, probe, readPcm, tempDir, writeJson, num, isMain, SCRIPTS, hasCommand } from './common.mjs';
import { hf } from './engine.mjs';

const SR = 48000;

function decode(src, dst, { from = 0 } = {}) {
  run('ffmpeg', ['-v', 'error', '-y', '-ss', String(from), '-i', src, '-vn', '-ac', '2', '-ar', String(SR), '-c:a', 'pcm_s16le', dst]);
}

function firstSound(file) {
  const pcm = readPcm(file, { rate: 8000 });
  let peak = 0; for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > peak * 0.05) return Math.max(0, i / 8000 - 0.02);
  return 0;
}

// Tempo and beat times from an onset envelope (10 ms hops of positive energy change).
export function beats(file, duration) {
  const pcm = readPcm(file, { rate: 11025 });
  const hop = 110, n = Math.floor(pcm.length / hop);
  // Two onset envelopes: the full band finds the tempo, the low band (the kick) finds where the beat is.
  const low = new Float64Array(pcm.length);
  { const a = Math.exp(-2 * Math.PI * 150 / 11025); let s1 = 0, s2 = 0; for (let k = 0; k < pcm.length; k++) { s1 = (1 - a) * pcm[k] + a * s1; s2 = (1 - a) * s1 + a * s2; low[k] = s2; } }
  const onsets = (x, diff) => {
    const e = new Float64Array(n); let prev = 0;
    for (let i = 0; i < n; i++) {
      let s = 0; for (let k = i * hop; k < (i + 1) * hop; k++) { const d = diff ? x[k] - (k ? x[k - 1] : 0) : x[k]; s += d * d; }
      const v = Math.log1p(s / hop); e[i] = Math.max(0, v - prev); prev = v;
    }
    return e;
  };
  const env = onsets(pcm, true), envLow = onsets(low, false);
  const hopS = hop / 11025;
  let bestLag = 0, best = -1;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = 60 / bpm / hopS;
    let s = 0, c = 0;
    for (let i = 0; i + lag * 4 < n; i++) { const j = Math.round(i + lag); s += env[i] * env[j]; c++; }
    const score = s / (c || 1) * (1 + 0.15 * Math.exp(-((bpm - 115) ** 2) / 800)); // a mild pull toward common tempos
    if (score > best) { best = score; bestLag = lag; }
  }
  // Refine tempo and phase together against the kick band: a coarse tempo drifts off the beat within
  // seconds, and the grid that lines up with the most kick energy is the one to snap to.
  const gridScore = (period, p) => {
    let s = 0; for (let t = p; t < Math.min(duration, n * hopS); t += period) { const i = Math.round(t / hopS); s += (envLow[i] || 0) + 0.5 * ((envLow[i - 1] || 0) + (envLow[i + 1] || 0)); }
    return s;
  };
  const coarse = 60 / (bestLag * hopS);
  let period = bestLag * hopS, bestPhase = 0, bestSum = -1;
  for (let bpm = coarse - 1.5; bpm <= coarse + 1.5; bpm += 0.05) {
    const per = 60 / bpm;
    for (let p = 0; p < per; p += hopS) { const sc = gridScore(per, p); if (sc > bestSum) { bestSum = sc; bestPhase = p; period = per; } }
  }
  const out = [];
  for (let t = bestPhase; t < duration; t += period) out.push(+t.toFixed(3));
  return { bpm: +(60 / period).toFixed(1), beats: out };
}

function fromLibrary(intent, work) {
  if (!hasCommand('heygen')) return { error: 'the heygen command line is not installed' };
  const r = hf(['media-use', 'resolve', '--type', 'bgm', '--intent', intent, '--project', work], { allowFail: true });
  const m = (r.out + r.err).match(/resolved\s+(\S+)\s+→\s+(\S+)/);
  if (r.status !== 0 || !m) return { error: (r.out + r.err).trim().split('\n').slice(-3).join(' ') || 'no track resolved' };
  const path = resolve(work, m[2]);
  return existsSync(path) ? { path, id: m[1] } : { error: `resolved ${m[2]} but the file is missing` };
}

export function fit(src, out, duration, tmp) {
  const raw = join(tmp, 'raw.wav');
  decode(src, raw, { from: firstSound(src) });
  const len = probe(raw).duration;
  const fadeStart = Math.max(0, duration - 1.5);
  if (len >= duration) {
    run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af', `atrim=0:${duration},afade=t=in:d=0.3,afade=t=out:st=${fadeStart}:d=1.5`, '-ar', String(SR), '-c:a', 'pcm_s16le', out]);
  } else {
    const copies = Math.ceil(duration / Math.max(1, len - 1)) + 1;
    const inputs = [], labels = [];
    for (let i = 0; i < copies; i++) { inputs.push('-i', raw); labels.push(`[${i}:a]`); }
    let chain = '', last = labels[0];
    for (let i = 1; i < copies; i++) { chain += `${last}${labels[i]}acrossfade=d=1:c1=tri:c2=tri[x${i}];`; last = `[x${i}]`; }
    run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${chain}${last}atrim=0:${duration},afade=t=in:d=0.3,afade=t=out:st=${fadeStart}:d=1.5[o]`, '-map', '[o]', '-ar', String(SR), '-c:a', 'pcm_s16le', out]);
  }
  return len;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.duration === undefined || !args.out || (!args.file && !args.library && !args.generate)) die('usage: music.mjs --duration s --out music.wav [--json f] (--file f | --library "mood" | --generate calm|upbeat|cinematic) [--work dir]');
  const duration = num(args.duration);
  const work = typeof args.work === 'string' ? resolve(args.work) : process.cwd();
  const tmp = tempDir('aive-music-');
  try {
    let src, source;
    if (typeof args.file === 'string') { if (!existsSync(args.file)) die(`not found: ${args.file}`); src = resolve(args.file); source = { kind: 'file', path: src }; }
    else if (typeof args.library === 'string') {
      const r = fromLibrary(args.library, work);
      if (r.error) { console.error(`music library unavailable: ${r.error}`); process.exit(3); }
      src = r.path; source = { kind: 'library', intent: args.library, id: r.id, path: r.path };
    } else {
      src = join(tmp.dir, 'generated.wav');
      run(process.execPath, [join(SCRIPTS, 'synth.mjs'), '--duration', String(duration + 2), '--mood', String(args.generate), '--out', src, ...(args.seed ? ['--seed', String(args.seed)] : [])]);
      source = { kind: 'generated', mood: String(args.generate) };
    }
    const length = fit(src, args.out, duration, tmp.dir);
    const b = beats(args.out, duration);
    const info = { source, trackLength: +length.toFixed(2), duration, ...b };
    if (typeof args.json === 'string') writeJson(args.json, info);
    console.log(`${source.kind === 'library' ? `library track ${source.id}` : source.kind === 'file' ? `your track` : `generated ${source.mood} bed`} · ${length.toFixed(1)}s fitted to ${duration.toFixed(2)}s · ${b.bpm} bpm, ${b.beats.length} beats → ${args.out}`);
  } finally {
    tmp.cleanup();
  }
}
