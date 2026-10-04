#!/usr/bin/env node
// A music bed synthesised on this machine — the fallback when no track is given and the music library
// is not signed in. No samples, no service, no licence to check. Made to sit under a voice.
//
//   node synth.mjs --duration 24 --out bed.wav [--mood upbeat|calm|cinematic] [--bpm n] [--seed 7]
//
// upbeat     118 bpm: four-on-the-floor kick, claps, sixteenth hats, a sidechained bass, off-beat
//            chord stabs and a pluck arpeggio, over vi–IV–I–V
// calm       84 bpm lo-fi: swung soft drums, electric-piano seventh chords, a round bass, vinyl crackle
// cinematic  88 bpm: swelling string pads, a low drone, sparse piano and deep hits
// Every mood opens on its chords alone for a bar, drops a bar out every eight to breathe, and runs
// through a stereo reverb and a gentle master limiter. Seeded, so the same settings render the same.

import { parseArgs, die, writeWav, num } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.duration === undefined || !args.out) die('usage: synth.mjs --duration secs --out bed.wav [--mood upbeat|calm|cinematic] [--bpm n] [--seed n]');

const SR = 48000;
const mood = ['upbeat', 'calm', 'cinematic'].includes(args.mood) ? args.mood : 'upbeat';
const D = num(args.duration);
const N = Math.round(D * SR);
const BPM = num(args.bpm, { upbeat: 118, calm: 84, cinematic: 88 }[mood]);
const B = 60 / BPM, BAR = 4 * B;
const swing = mood === 'calm' ? 0.16 : 0;

let seed = num(args.seed, 7) >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const midi = (m) => 440 * 2 ** ((m - 69) / 12);

const L = new Float32Array(N), R = new Float32Array(N);       // dry mix
const RL = new Float32Array(N), RR = new Float32Array(N);     // reverb send
const duck = new Float32Array(N).fill(1);                     // sidechain gain from the kick

function place(t, sig, { gain = 1, pan = 0, send = 0, ducked = false } = {}) {
  const i0 = Math.round(t * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2 * gain, gr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2 * gain;
  for (let k = 0; k < sig.length; k++) {
    const i = i0 + k; if (i < 0 || i >= N) continue;
    const v = sig[k] * (ducked ? duck[i] : 1);
    L[i] += v * gl; R[i] += v * gr; RL[i] += v * gl * send; RR[i] += v * gr * send;
  }
}

// ---------------------------------------------------------------- voices

function polySaw(f, d, detune = 0) {       // band-limited saw (polyBLEP)
  const n = Math.round(d * SR), y = new Float32Array(n), dt = f * (1 + detune) / SR; let ph = rnd();
  for (let i = 0; i < n; i++) {
    let v = 2 * ph - 1;
    if (ph < dt) { const x = ph / dt; v -= x + x - x * x - 1; } else if (ph > 1 - dt) { const x = (ph - 1) / dt; v -= x * x + x + x + 1; }
    y[i] = v; ph += dt; if (ph >= 1) ph -= 1;
  }
  return y;
}
function svfLow(x, cutoff, q = 0.7) {       // state-variable low-pass; cutoff may be a function of the sample
  const y = new Float32Array(x.length); let low = 0, band = 0;
  for (let i = 0; i < x.length; i++) {
    const fc = typeof cutoff === 'function' ? cutoff(i) : cutoff;
    const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR);
    low += f * band; const high = x[i] - low - band / q; band += f * high; y[i] = low;
  }
  return y;
}
const env = (n, a, d, s, r, hold) => Float32Array.from({ length: n }, (_, i) => {
  const t = i / SR;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * (t - a) / d;
  if (t < hold) return s;
  return Math.max(0, s * (1 - (t - hold) / r));
});
const mul = (x, e) => x.map((v, i) => v * (e[i] ?? 0));

function pad(notes, d, bright) {
  const n = Math.round((d + 0.8) * SR);
  const out = new Float32Array(n);
  for (const m of notes) for (const dt of [-0.006, 0, 0.007]) { const s = polySaw(midi(m), d + 0.8, dt); for (let i = 0; i < n; i++) out[i] += s[i] / notes.length / 3; }
  const e = env(n, mood === 'cinematic' ? 0.9 : 0.25, 0.4, 0.8, 0.8, d);
  return mul(svfLow(out, (i) => bright * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, i / n))), 0.9), e);
}
function epiano(notes, d) {                   // two-operator FM, bell-ish attack
  const n = Math.round((d + 0.6) * SR), out = new Float32Array(n);
  for (const m of notes) { const f = midi(m); for (let i = 0; i < n; i++) { const t = i / SR; const idx = 1.6 * Math.exp(-t * 3); out[i] += Math.sin(2 * Math.PI * f * t + idx * Math.sin(2 * Math.PI * f * t)) * Math.exp(-t * 1.1) / notes.length; } }
  return out;
}
function pluck(f, d = 0.35) { const n = Math.round(d * SR); const s = svfLow(polySaw(f, d), (i) => 5200 * Math.exp(-i / SR * 16) + 400, 1.2); return mul(s, env(n, 0.003, 0.1, 0.35, 0.18, d - 0.18)); }
function bass(f, d) { const n = Math.round(d * SR); const y = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; y[i] = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * Math.min(1, t / 0.008) * Math.min(1, (d - t) / 0.03); } return y; }
function kick(soft) { const d = 0.45, n = Math.round(d * SR), y = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += 2 * Math.PI * (48 + (soft ? 70 : 120) * Math.exp(-t * 32)) / SR; y[i] = Math.tanh(Math.sin(ph) * Math.exp(-t * (soft ? 9 : 7)) * 1.6) + (t < 0.004 ? (rnd() * 2 - 1) * 0.3 : 0); } return y; }
function clap(soft) { const d = 0.3, n = Math.round(d * SR), y = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; const bursts = [0, 0.011, 0.022].reduce((s, o) => s + (t >= o ? Math.exp(-(t - o) * 90) : 0), 0) * 0.5 + Math.exp(-t * 18) * 0.6; y[i] = (rnd() * 2 - 1) * bursts; } return svfLow(y, soft ? 2200 : 5000, 1.4); }
function hat(open) { const d = open ? 0.18 : 0.05, n = Math.round(d * SR), y = new Float32Array(n); let prev = 0; for (let i = 0; i < n; i++) { const v = rnd() * 2 - 1; y[i] = (v - prev) * Math.exp(-(i / SR) * (open ? 18 : 70)); prev = v; } return y; }
function hit() { const d = 1.6, n = Math.round(d * SR), y = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += 2 * Math.PI * (38 + 60 * Math.exp(-t * 6)) / SR; y[i] = Math.sin(ph) * Math.exp(-t * 2.6) + (rnd() * 2 - 1) * Math.exp(-t * 14) * 0.25; } return y; }

// ---------------------------------------------------------------- the arrangement

const PROG = {
  upbeat: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],                 // Am F C G
  calm: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]],   // Fmaj7 Em7 Dm7 Cmaj7
  cinematic: [[45, 52, 57, 60], [41, 48, 53, 57], [48, 55, 60, 64], [43, 50, 55, 59]],
}[mood];
const bars = Math.ceil(D / BAR);

for (let bar = 0; bar < bars; bar++) {
  const t0 = bar * BAR;
  const ch = PROG[bar % PROG.length], root = ch[0] - 12;
  const intro = bar === 0, breath = bar > 0 && bar % 8 === 7;
  if (mood === 'calm') place(t0, epiano(ch.map((m) => m + 12), BAR), { gain: 0.34, pan: -0.1, send: 0.35 });
  else place(t0, pad(ch, BAR, mood === 'cinematic' ? 2400 : 3600), { gain: mood === 'cinematic' ? 0.5 : 0.28, send: 0.45, ducked: true });
  if (mood === 'cinematic') { place(t0, pad([root - 12], BAR, 500), { gain: 0.35, send: 0.2 }); if (!intro && bar % 2 === 0) place(t0, hit(), { gain: 0.5, send: 0.4 }); }
  if (intro) continue;

  for (let b = 0; b < 4; b++) {
    const tb = t0 + b * B;
    if (mood === 'upbeat') {
      if (!breath) { place(tb, kick(false), { gain: 0.9 }); const i0 = Math.round(tb * SR); for (let k = 0; k < SR * 0.22 && i0 + k < N; k++) duck[i0 + k] = Math.min(duck[i0 + k], 0.35 + 0.65 * (k / (SR * 0.22)) ** 1.6); }
      if (!breath && (b === 1 || b === 3)) place(tb, clap(false), { gain: 0.45, send: 0.25 });
      for (let s = 0; s < 4; s++) place(tb + s * B / 4, hat(s === 2), { gain: s === 2 ? 0.16 : 0.1, pan: 0.25, send: 0.05 });
      place(tb + B / 2, bass(midi(root + (b % 2 ? 12 : 0)), B / 2 * 0.9), { gain: 0.42, ducked: true });
      place(tb + B / 2, pluck(midi(ch[(b + 1) % ch.length] + 12), B / 2), { gain: 0.12, pan: 0.3, send: 0.3, ducked: true });
      place(tb + B / 4 * 3, pluck(midi(ch[b % ch.length] + 24), B / 4), { gain: 0.07, pan: -0.35, send: 0.4, ducked: true });
    } else if (mood === 'calm') {
      const sw = (x) => x + (Math.round(x / (B / 2)) % 2 ? swing * B : 0);
      if (!breath && (b === 0 || b === 2)) place(tb, kick(true), { gain: 0.7 });
      if (!breath && (b === 1 || b === 3)) place(tb, clap(true), { gain: 0.3, send: 0.2 });
      for (let s = 0; s < 2; s++) place(sw(tb + s * B / 2), hat(false), { gain: 0.08, pan: 0.3 });
      if (b === 0 || b === 2) place(tb, bass(midi(root), B * 1.7), { gain: 0.35 });
    } else {
      if (b === 0 && bar % 2 === 1) place(tb, pluck(midi(ch[2] + 12), B * 2), { gain: 0.1, send: 0.6 });
    }
  }
}
if (mood === 'calm') for (let i = 0; i < N; i++) { const c = rnd() < 0.0006 ? (rnd() * 2 - 1) * 0.25 : 0; L[i] += c + (rnd() * 2 - 1) * 0.004; R[i] += c + (rnd() * 2 - 1) * 0.004; }

// ---------------------------------------------------------------- reverb and master

function reverb(x, spread) {                   // Schroeder: four combs, two all-passes
  const out = new Float32Array(x.length);
  for (const [len, fb] of [[1557, 0.8], [1617, 0.79], [1491, 0.81], [1422, 0.8]]) {
    const n = len + spread, buf = new Float32Array(n); let idx = 0, lp = 0;
    for (let i = 0; i < x.length; i++) { const y = buf[idx]; lp = y * 0.6 + lp * 0.4; buf[idx] = x[i] + lp * fb; out[i] += y / 4; idx = (idx + 1) % n; }
  }
  for (const len of [225 + spread, 556 + spread]) {
    const buf = new Float32Array(len); let idx = 0;
    for (let i = 0; i < out.length; i++) { const b = buf[idx]; const y = -out[i] + b; buf[idx] = out[i] + b * 0.5; out[i] = y; idx = (idx + 1) % len; }
  }
  return out;
}
const wl = reverb(RL, 0), wr = reverb(RR, 23);
let peak = 0;
for (let i = 0; i < N; i++) { L[i] = Math.tanh((L[i] + wl[i] * 0.5) * 1.2); R[i] = Math.tanh((R[i] + wr[i] * 0.5) * 1.2); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const g = peak ? 0.89 / peak : 1;
for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }

writeWav(args.out, [L, R], SR);
console.log(`${mood} bed · ${BPM} bpm · ${D.toFixed(2)}s → ${args.out}`);
