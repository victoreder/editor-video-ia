// Trilhas sintetizadas (sem licença para checar), em loop, feitas para ficar por
// baixo da voz. Versão enxuta de kamgasimo/synth.mjs (MIT). Também é o fallback
// quando a música por IA não está disponível.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

const SR = 44100;
const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);
let seed = 3;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

export function renderMusic(mood: 'upbeat' | 'calm' | 'cinematic', minSeconds = 0) {
  const bpm = mood === 'upbeat' ? 116 : mood === 'cinematic' ? 72 : 84;
  const beat = 60 / bpm;
  const bars = Math.max(8, Math.ceil(minSeconds / (4 * beat) / 4) * 4);
  const dur = bars * 4 * beat;
  const n = Math.round(dur * SR);
  const L = new Float32Array(n);
  const add = (t0: number, len: number, fn: (t: number) => number, gain = 1) => {
    const i0 = Math.round(t0 * SR);
    const m = Math.round(len * SR);
    for (let k = 0; k < m; k++) {
      const i = (i0 + k) % n; // dá a volta: loop sem emenda
      L[i] += fn(k / SR) * gain;
    }
  };
  // vi–IV–I–V em Lá menor / Dó
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  for (let bar = 0; bar < bars; bar++) {
    const ch = chords[bar % 4];
    const t0 = bar * 4 * beat;
    // pad (saws suavizados por envelope lento)
    for (const note of ch)
      add(t0, 4 * beat, (t) => {
        const f = midi(note + 12);
        const saw = ((t * f) % 1) * 2 - 1;
        const tri = Math.abs(((t * f * 0.5) % 1) * 4 - 2) - 1;
        const env = Math.min(1, t / 0.3) * Math.min(1, (4 * beat - t) / 0.3);
        return (mood === 'calm' ? tri : saw * 0.35 + tri * 0.65) * env;
      }, 0.05);
    if (mood === 'cinematic') add(t0, 4 * beat, (t) => Math.sin(2 * Math.PI * midi(ch[0] - 24) * t) * Math.min(1, t / 1.2) * Math.min(1, (4 * beat - t) / 0.8), 0.22); // drone
    // baixo
    for (let b = 0; b < 4; b++) add(t0 + b * beat, beat * 0.9, (t) => Math.sin(2 * Math.PI * midi(ch[0] - 12) * t) * Math.exp(-t * (mood === 'calm' ? 2 : 4)), 0.32);
    for (let b = 0; b < 4; b++) {
      const tb = t0 + b * beat;
      if (mood === 'cinematic' && b !== 0) continue;
      if (mood === 'upbeat' || b % 2 === 0) add(tb, 0.35, (t) => Math.sin(2 * Math.PI * (45 * t + 90 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 9), mood === 'upbeat' ? 0.55 : 0.35); // kick
      if (b % 2 === 1) add(tb, 0.2, (t) => rnd() * Math.exp(-t * 22), mood === 'upbeat' ? 0.18 : 0.08); // snare/clap
      for (let h = 0; h < (mood === 'upbeat' ? 4 : 2); h++) add(tb + (h * beat) / (mood === 'upbeat' ? 4 : 2), 0.05, (t) => rnd() * Math.exp(-t * 90), 0.04); // hats
    }
    if (mood === 'upbeat') for (let s = 0; s < 8; s++) add(t0 + s * beat * 0.5, beat * 0.4, (t) => Math.sin(2 * Math.PI * midi(ch[s % 3] + 24) * t) * Math.exp(-t * 9), 0.05); // arpejo
  }
  let peak = 0;
  for (const v of L) peak = Math.max(peak, Math.abs(v));
  const pcm = Buffer.alloc(n * 2);
  L.forEach((v, i) => pcm.writeInt16LE(Math.round((v / peak) * 0.8 * 32767), i * 2));
  return pcm;
}


/** gera um MP3 da trilha (com pelo menos `minSeconds` segundos) */
export function writeMusicMp3(mood: 'upbeat' | 'calm' | 'cinematic', out: string, minSeconds = 0) {
  const raw = `${out}.raw`;
  fs.writeFileSync(raw, renderMusic(mood, minSeconds));
  execFileSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-y', '-v', 'error', '-f', 's16le', '-ar', String(SR), '-ac', '1', '-i', raw, '-af', 'aecho=0.6:0.5:60:0.25,lowpass=f=9000', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', out]);
  fs.unlinkSync(raw);
}
