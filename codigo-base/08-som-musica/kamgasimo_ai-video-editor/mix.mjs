#!/usr/bin/env node
// Voice first, music under it, sound effects on the picture's beats — and proof that the voice stays on
// top.
//
//   node mix.mjs --voice master.mov [--music music.wav] [--sfx sfx.wav] --out mix.wav
//        [--under 16] [--no-duck] [--target -14] [--tp -1.5] [--json mix.json]
//
// The music is set --under dB below the voice's measured loudness, then sidechained to it so it dips
// while someone speaks and recovers in the gaps; it fades in over half a second and out over the last
// two. Sound effects arrive already levelled by sfx.mjs and are added as they are. The sum is limited,
// then normalised two-pass to the target, in stereo.
//
// The margin is measured, not assumed: in every 400 ms window where the voice is speaking, the voice's
// level is compared with the ducked music's at the same moment. The report gives the median and the
// worst tenth; a mix whose worst tenth is under 12 dB lets the music compete with the words.

import { join, extname } from 'node:path';
import { parseArgs, die, run, probe, tempDir, num, readPcm, writeJson } from './common.mjs';
import { measure, normalize } from './loudness.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.voice || !args.out) die('usage: mix.mjs --voice file [--music file] [--sfx file] --out file [--under dB] [--no-duck] [--target n] [--tp n] [--json f]');

const voice = probe(args.voice);
if (!voice.audio) die('the voice file has no audio');
const D = voice.audio.duration ?? voice.duration;
const under = num(args.under, 16);
const target = num(args.target, -14), tp = num(args.tp, -1.5);
const Iv = measure(args.voice).integrated;
const Im = args.music ? measure(args.music).integrated : null;
if (args.music && !Number.isFinite(Im)) die('the music measures silent');
const gain = args.music ? +((Iv - under) - Im).toFixed(2) : 0;

// Levels in 400 ms windows: where the voice speaks, how far above the music it sits.
function margin(voiceWav, musicWav) {
  const v = readPcm(voiceWav, { rate: 16000 }), m = readPcm(musicWav, { rate: 16000 });
  const win = 6400, db = (x, i) => { let s = 0; for (let k = i; k < i + win && k < x.length; k++) s += x[k] * x[k]; return 10 * Math.log10(s / win / 32768 / 32768 + 1e-12); };
  const vl = [], ml = [];
  for (let i = 0; i + win <= Math.min(v.length, m.length); i += win / 2) { vl.push(db(v, i)); ml.push(db(m, i)); }
  const sorted = [...vl].sort((a, b) => a - b), speaking = sorted[Math.floor(sorted.length * 0.9)] - 12;
  const d = vl.map((x, i) => (x >= speaking ? x - ml[i] : null)).filter((x) => x !== null).sort((a, b) => a - b);
  if (!d.length) return null;
  return { median: +d[Math.floor(d.length / 2)].toFixed(1), worstTenth: +d[Math.floor(d.length * 0.1)].toFixed(1), windows: d.length };
}

const tmp = tempDir('aive-mix-');
try {
  const inputs = ['-i', args.voice];
  const chain = ['[0:a]aformat=channel_layouts=stereo,asplit=3[v][key][vs]'];
  const sum = ['[v]'];
  if (args.music) {
    inputs.push('-stream_loop', '-1', '-i', args.music);
    chain.push(`[1:a]aformat=channel_layouts=stereo,volume=${gain}dB,afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, D - 2).toFixed(3)}:d=2[m0]`);
    chain.push(args['no-duck'] ? '[m0]anull[m];[key]anullsink' : '[m0][key]sidechaincompress=threshold=0.03:ratio=3:attack=20:release=400:makeup=1[m]');
    chain.push('[m]asplit=2[mm][ms]');
    sum.push('[mm]');
  } else chain.push('[key]anullsink');
  if (args.sfx) { inputs.push('-i', args.sfx); chain.push(`[${args.music ? 2 : 1}:a]aformat=channel_layouts=stereo[s]`); sum.push('[s]'); }
  chain.push(`${sum.join('')}amix=inputs=${sum.length}:normalize=0:duration=first,alimiter=limit=0.9:level=false[out]`);
  const raw = join(tmp.dir, 'raw.wav'), vStem = join(tmp.dir, 'voice.wav'), mStem = join(tmp.dir, 'music.wav');
  const maps = ['-map', '[out]', '-t', D.toFixed(3), '-ar', '48000', '-c:a', 'pcm_s16le', raw, '-map', '[vs]', '-t', D.toFixed(3), '-c:a', 'pcm_s16le', vStem];
  if (args.music) maps.push('-map', '[ms]', '-t', D.toFixed(3), '-c:a', 'pcm_s16le', mStem);
  run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', chain.join(';'), ...maps]);

  const withVideo = Boolean(voice.video) && ['.mov', '.mp4', '.mkv'].includes(extname(args.out).toLowerCase());
  let pre = raw;
  if (withVideo) { pre = join(tmp.dir, 'raw.mov'); run('ffmpeg', ['-v', 'error', '-y', '-i', args.voice, '-i', raw, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', pre]); }
  const m = normalize(pre, args.out, { target, tp });
  const mg = args.music ? margin(vStem, mStem) : null;
  const report = { voiceLufs: Iv, musicLufs: Im, musicGainDb: gain, under, ducked: !args['no-duck'], sfx: Boolean(args.sfx), integrated: m.integrated, truePeak: m.truePeak, margin: mg };
  if (typeof args.json === 'string') writeJson(args.json, report);
  console.log(`voice${args.music ? ` + music set ${under} dB under (${gain >= 0 ? '+' : ''}${gain} dB)${args['no-duck'] ? '' : ', ducked'}` : ''}${args.sfx ? ' + sound effects' : ''} → ${args.out}`);
  console.log(`integrated ${m.integrated} LUFS · true peak ${m.truePeak} dBTP${mg ? ` · voice over music while speaking: median ${mg.median} dB, worst tenth ${mg.worstTenth} dB${mg.worstTenth < 12 ? '  ⚠ under 12 dB — mix the music lower' : ''}` : ''}`);
} finally {
  tmp.cleanup();
}
