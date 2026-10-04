#!/usr/bin/env node
// Sound effects: a cue list becomes one stereo track, each effect's hit landing on its cue's time.
//
//   node sfx.mjs --cues cues.json --duration 22.36 --out sfx.wav
//   node sfx.mjs --list
//
// cues.json is [{ "at": 5.16, "kind": "whoosh", "gain": 0 }, …]; gain is in dB, added to the kind's
// level. Effects come from the recorded library bundled with the rendering engine (Pixabay Content
// License: free for commercial use in videos, no attribution) when it is installed, and are
// synthesised here otherwise. Every library file is measured once — where its hit is and how loud its
// peak is — so a whoosh peaks on the cut, a chime rings on the reveal and a riser climaxes on the
// hook, whatever silence the file starts with.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, die, readPcm, writeWav, readJson, writeJson, cacheDir, num, isMain } from './common.mjs';
import { sfxLibraryDir } from './engine.mjs';

const SR = 48000;

// kind → library file, where its hit is (onset or loudest moment), and its level as a peak in dBFS.
export const KINDS = {
  whoosh: { file: 'whoosh.mp3', hit: 'loudest', level: -15 },
  'whoosh-long': { file: 'whoosh-cinematic.mp3', hit: 'loudest', level: -16 },
  swoosh: { file: 'whoosh-short.mp3', hit: 'loudest', level: -17 },
  pop: { file: 'pop.mp3', hit: 'onset', level: -16 },
  click: { file: 'click.mp3', hit: 'onset', level: -17 },
  'click-soft': { file: 'click-soft.mp3', hit: 'onset', level: -21 },
  impact: { file: 'impact-bass-1.mp3', hit: 'onset', level: -12 },
  'impact-swell': { file: 'impact-bass-2.mp3', hit: 'loudest', level: -12 },
  glitch: { file: 'glitch-1.mp3', hit: 'onset', level: -17 },
  'glitch-long': { file: 'glitch-2.mp3', hit: 'onset', level: -19 },
  'glitch-soft': { file: 'glitch-3.mp3', hit: 'onset', level: -20 },
  riser: { file: 'riser.mp3', hit: 'loudest', level: -16 },
  sparkle: { file: 'sparkle.mp3', hit: 'onset', level: -19 },
  chime: { file: 'chime.mp3', hit: 'onset', level: -18 },
  ping: { file: 'ping.mp3', hit: 'onset', level: -18 },
  notification: { file: 'notification.mp3', hit: 'onset', level: -18 },
  typing: { file: 'typing.mp3', hit: 'onset', level: -20 },
  key: { file: 'key-press.mp3', hit: 'onset', level: -20 },
  error: { file: 'error.mp3', hit: 'onset', level: -18 },
};

// ---------------------------------------------------------------- library, measured once

function measureFile(path) {
  const pcm = readPcm(path, { rate: SR });
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  let onset = 0;
  for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > peak * 0.1) { onset = i; break; }
  const win = SR / 50;                                   // 20 ms RMS
  let loudest = 0, best = 0;
  for (let i = 0; i + win <= pcm.length; i += win / 2) {
    let s = 0; for (let k = i; k < i + win; k++) s += pcm[k] * pcm[k];
    if (s > best) { best = s; loudest = i + win / 2; }
  }
  return { duration: pcm.length / SR, onset: onset / SR, loudest: loudest / SR, peakDb: 20 * Math.log10(peak / 32768 + 1e-9) };
}

export function library() {
  const dir = sfxLibraryDir();
  if (!existsSync(join(dir, 'manifest.json'))) return null;
  const metaPath = join(cacheDir(), 'sfx-library.json');
  let meta = existsSync(metaPath) ? readJson(metaPath) : {};
  let changed = false;
  for (const k of Object.values(KINDS)) {
    if (meta[k.file] || !existsSync(join(dir, k.file))) continue;
    meta[k.file] = measureFile(join(dir, k.file)); changed = true;
  }
  if (changed) writeJson(metaPath, meta);
  return { dir, meta };
}

// ---------------------------------------------------------------- synthesised fallbacks

let seed = 7;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const gen = (d, f) => Float32Array.from({ length: Math.round(d * SR) }, (_, i) => f(i / SR));
function lowpass(x, fc) { const y = new Float32Array(x.length); let s = 0; for (let i = 0; i < x.length; i++) { const a = Math.exp(-2 * Math.PI * (typeof fc === 'function' ? fc(i) : fc) / SR); s = (1 - a) * x[i] + a * s; y[i] = s; } return y; }
function chirp(d, fAt, env) { let ph = 0; return gen(d, (t) => { ph += 2 * Math.PI * fAt(t) / SR; return Math.sin(ph) * env(t); }); }
const noise = (d) => gen(d, () => rand());

const SYNTH = {
  whoosh: () => { const d = 0.5, n = noise(d); const lp = lowpass(n, (i) => 500 + 6000 * Math.sin(Math.PI * i / n.length)); return { sig: lp.map((v, i) => v * Math.sin(Math.PI * i / lp.length) ** 2 * 1.6), hit: d / 2 }; },
  pop: () => ({ sig: chirp(0.09, (t) => 600 + 9000 * t, (t) => Math.exp(-t * 45)), hit: 0 }),
  click: () => ({ sig: gen(0.03, (t) => Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 250) + rand() * Math.exp(-t * 500) * 0.4), hit: 0 }),
  impact: () => { const b = chirp(0.7, (t) => 95 * Math.exp(-t * 3) + 32, (t) => Math.exp(-t * 5)); const nz = lowpass(noise(0.7), 2400); return { sig: b.map((v, i) => v * 0.9 + nz[i] * Math.exp(-(i / SR) * 16) * 0.5), hit: 0 }; },
  riser: () => { const d = 2.5, n = noise(d); const lp = lowpass(n, (i) => 300 + 7000 * (i / n.length) ** 2); return { sig: lp.map((v, i) => v * (i / lp.length) ** 2.2 * 2.5), hit: d }; },
  glitch: () => ({ sig: gen(0.35, (t) => (Math.floor(t * 40) % 2 ? rand() : Math.sign(Math.sin(2 * Math.PI * 180 * t)) * 0.5) * (t < 0.3 ? 1 : 0)), hit: 0 }),
  chime: () => ({ sig: gen(1.2, (t) => [1318.5, 1975.5, 2637].reduce((s, f, i) => s + Math.sin(2 * Math.PI * f * t) * Math.exp(-t * (4 + i * 2)), 0) / 3), hit: 0 }),
  sparkle: () => ({ sig: gen(0.9, (t) => [2637, 3136, 3951, 5274].reduce((s, f, i) => s + Math.sin(2 * Math.PI * f * t) * Math.exp(-t * (6 + i)) * (t > i * 0.05 ? 1 : 0), 0) / 4), hit: 0 }),
  typing: () => { const out = new Float32Array(Math.round(1.2 * SR)); for (let k = 0; k < 18; k++) { const i0 = Math.round((k * 0.062 + (rand() + 1) * 0.008) * SR); for (let j = 0; j < 900 && i0 + j < out.length; j++) out[i0 + j] += rand() * Math.exp(-j / 120) * 0.6; } return { sig: out, hit: 0 }; },
};
const synthFor = (kind) => {
  const base = { 'whoosh-long': 'whoosh', swoosh: 'whoosh', 'click-soft': 'click', 'impact-swell': 'impact', 'glitch-long': 'glitch', 'glitch-soft': 'glitch', ping: 'chime', notification: 'chime', key: 'click', error: 'glitch' }[kind] || kind;
  return SYNTH[base] ? SYNTH[base]() : null;
};

// ---------------------------------------------------------------- the track

function peakOf(x) { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p || 1; }

export function renderCues(cues, duration, out) {
  const N = Math.round(duration * SR);
  const L = new Float32Array(N), R = new Float32Array(N);
  const lib = library();
  const cache = new Map();
  const used = [];
  for (const c of cues) {
    const k = KINDS[c.kind];
    if (!k) { used.push({ ...c, skipped: 'unknown kind' }); continue; }
    let sig, hit, source;
    if (lib && lib.meta[k.file]) {
      if (!cache.has(k.file)) {
        const pcm = readPcm(join(lib.dir, k.file), { rate: SR });
        cache.set(k.file, Float32Array.from(pcm, (v) => v / 32768));
      }
      sig = cache.get(k.file); hit = lib.meta[k.file][k.hit === 'loudest' ? 'loudest' : 'onset']; source = 'library';
    } else {
      const s = synthFor(c.kind);
      if (!s) { used.push({ ...c, skipped: 'no source' }); continue; }
      sig = s.sig; hit = s.hit; source = 'synthesised';
    }
    const gain = 10 ** (((c.gain ?? 0) + k.level) / 20) / peakOf(sig);
    const i0 = Math.round((c.at - hit) * SR);
    const pan = c.pan ?? 0, gl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
    for (let j = 0; j < sig.length; j++) { const i = i0 + j; if (i < 0 || i >= N) continue; L[i] += sig[j] * gain * gl; R[i] += sig[j] * gain * gr; }
    used.push({ at: c.at, kind: c.kind, source, startsAt: +(c.at - hit).toFixed(3) });
  }
  for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i]); R[i] = Math.tanh(R[i]); }
  writeWav(out, [L, R], SR);
  return used;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    const lib = library();
    console.log(lib ? `recorded library: ${lib.dir}` : 'no recorded library — every effect is synthesised');
    for (const [kind, k] of Object.entries(KINDS)) {
      const m = lib?.meta[k.file];
      console.log(`  ${kind.padEnd(14)} ${m ? `${m.duration.toFixed(2)}s, hit at ${(k.hit === 'loudest' ? m.loudest : m.onset).toFixed(3)}s` : 'synthesised'}`);
    }
    process.exit(0);
  }
  if (!args.cues || args.duration === undefined || !args.out) die('usage: sfx.mjs --cues cues.json --duration secs --out sfx.wav | --list');
  const cues = JSON.parse(readFileSync(args.cues, 'utf8'));
  const used = renderCues(Array.isArray(cues) ? cues : cues.cues || [], num(args.duration), args.out);
  const bySource = used.reduce((m, u) => ((m[u.source || u.skipped] = (m[u.source || u.skipped] || 0) + 1), m), {});
  console.log(`${used.length} cues → ${args.out} (${Object.entries(bySource).map(([k, v]) => `${v} ${k}`).join(', ')})`);
}
