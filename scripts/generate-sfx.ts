// Gera os efeitos sonoros por síntese (sem samples, sem licença): public/sfx/*.wav
// Inspirado em kamgasimo/synth.mjs e motion-script/generate-sounds.mjs (MIT).
//   npm run sfx:generate
import fs from 'node:fs';
import path from 'node:path';

const SR = 48000;
let seed = 7;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => rnd() * 2 - 1;

function writeWav(file: string, data: Float32Array) {
  // normaliza o pico em −1 dBFS
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 0.89 / peak : 1;
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * g)) * 32767), 44 + i * 2));
  fs.writeFileSync(file, buf);
}

const make = (sec: number, fn: (t: number, i: number) => number) => {
  const n = Math.round(sec * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, i);
  // fade de 3 ms nas pontas (sem clique)
  const f = Math.round(0.003 * SR);
  for (let i = 0; i < f; i++) {
    out[i] *= i / f;
    out[n - 1 - i] *= i / f;
  }
  return out;
};

/** filtro passa-banda simples (state variable) com corte variável no tempo */
function bandNoise(sec: number, cutoff: (t: number) => number, q: number, env: (t: number) => number) {
  let low = 0;
  let band = 0;
  return make(sec, (t) => {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff(t), SR / 6)) / SR);
    low += f * band;
    const high = noise() - low - band / q;
    band += f * high;
    return band * env(t);
  });
}

const sfx: Record<string, Float32Array> = {
  // whoosh: ruído com banda subindo e descendo, pico em ~0,18 s
  whoosh: bandNoise(0.5, (t) => 300 + 4200 * Math.sin(Math.PI * Math.min(1, t / 0.42)), 1.4, (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.45)), 2)),
  swoosh: bandNoise(0.3, (t) => 800 + 5000 * (t / 0.3), 1.8, (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.28)), 1.5)),
  // pop: seno com queda rápida de pitch
  pop: make(0.14, (t) => Math.sin(2 * Math.PI * (380 * t + 900 * t * Math.exp(-t * 40))) * Math.exp(-t * 32)),
  click: make(0.05, (t) => (noise() * 0.5 + Math.sin(2 * Math.PI * 2200 * t)) * Math.exp(-t * 160)),
  // impact: sub grave + ruído de ataque
  impact: make(0.9, (t) => Math.sin(2 * Math.PI * (48 * t + 60 * (1 - Math.exp(-t * 18)) / 18)) * Math.exp(-t * 4.5) * 1.1 + noise() * Math.exp(-t * 40) * 0.6),
  // riser: ruído + tom subindo por 1,4 s
  riser: make(1.5, (t) => (noise() * 0.35 + Math.sin(2 * Math.PI * (200 * t + 380 * t * t))) * Math.pow(Math.min(1, t / 1.4), 2.2) * (t > 1.4 ? Math.exp(-(t - 1.4) * 40) : 1)),
  sparkle: make(0.7, (t) => [1568, 2093, 2637, 3136].reduce((s, f, k) => s + (t > k * 0.06 ? Math.sin(2 * Math.PI * f * (t - k * 0.06)) * Math.exp(-(t - k * 0.06) * 9) : 0), 0)),
  ding: make(0.9, (t) => (Math.sin(2 * Math.PI * 1318 * t) + 0.4 * Math.sin(2 * Math.PI * 2636 * t)) * Math.exp(-t * 5)),
  glitch: make(0.35, (t, i) => (Math.floor(i / 400) % 3 === 0 ? noise() : Math.sign(Math.sin(2 * Math.PI * (120 + 900 * ((Math.floor(t * 30) * 7) % 5)) * t)) * 0.6) * (t < 0.3 ? 1 : 0.2)),
  typing: make(0.9, (t) => {
    const k = Math.floor(t / 0.11);
    const local = t - k * 0.11 - (k % 2) * 0.02;
    return local > 0 ? (noise() * 0.6 + Math.sin(2 * Math.PI * 1800 * local)) * Math.exp(-local * 220) : 0;
  }),
};

const out = path.join(process.cwd(), 'public', 'sfx');
fs.mkdirSync(out, {recursive: true});
for (const [name, data] of Object.entries(sfx)) {
  writeWav(path.join(out, `${name}.wav`), data);
  console.log(`sfx/${name}.wav (${(data.length / SR).toFixed(2)} s)`);
}
