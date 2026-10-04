#!/usr/bin/env node
// Loudness, measured and delivered.
//
//   node loudness.mjs measure <file> [--json]
//   node loudness.mjs normalize <in> --out <out> [--target -14] [--tp -1.5] [--lra 11]
//   node loudness.mjs check <file> [--target -14] [--tp -1.5] [--tolerance 0.5]
//
// normalize is two-pass: measure, then apply the measured correction linearly, so the level is moved
// without riding it. Video, when present, is copied untouched. −14 LUFS is the level most social and
// video platforms normalise to.

import { extname } from 'node:path';
import { parseArgs, die, run, probe, num, isMain } from './common.mjs';

export function measure(file) {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const text = r.stderr.toString();
  const tail = text.slice(text.lastIndexOf('Summary:'));
  const grab = (label) => { const m = tail.match(new RegExp(`${label}:\\s+(-?[0-9.]+|-inf)`)); return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null; };
  return { integrated: grab('I'), range: grab('LRA'), truePeak: grab('Peak') };
}

export function normalize(input, output, { target = -14, tp = -1.5, lra = 11 } = {}) {
  const first = run('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-map', '0:a:0',
    '-af', `loudnorm=I=${target}:TP=${tp}:LRA=${lra}:print_format=json`, '-f', 'null', '-']).stderr.toString();
  const j = JSON.parse(first.slice(first.lastIndexOf('{'), first.lastIndexOf('}') + 1));
  const filter = `loudnorm=I=${target}:TP=${tp}:LRA=${lra}:measured_I=${j.input_i}:measured_TP=${j.input_tp}` +
    `:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  const hasVideo = Boolean(probe(input).video);
  const ext = extname(output).toLowerCase();
  const audio = ext === '.wav' || ext === '.mov' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k'];
  run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-af', filter, '-ar', '48000',
    ...(hasVideo ? ['-c:v', 'copy'] : ['-vn']), ...audio, ...(ext === '.mp4' ? ['-movflags', '+faststart'] : []), output]);
  return measure(output);
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, file] = args._;
  if (!cmd || !file) die('usage: loudness.mjs measure|normalize|check <file> [--out f] [--target n] [--tp n] [--tolerance n] [--json]');
  const target = num(args.target, -14), tp = num(args.tp, -1.5), tolerance = num(args.tolerance, 0.5);
  const show = (m) => `integrated ${m.integrated} LUFS · range ${m.range} LU · true peak ${m.truePeak} dBTP`;
  if (cmd === 'measure') { const m = measure(file); console.log(args.json ? JSON.stringify(m) : show(m)); }
  else if (cmd === 'normalize') { if (!args.out) die('normalize needs --out'); console.log(`${show(normalize(file, args.out, { target, tp, lra: num(args.lra, 11) }))}\n→ ${args.out}`); }
  else if (cmd === 'check') {
    const m = measure(file);
    const ok = Math.abs(m.integrated - target) <= tolerance && m.truePeak <= tp + 0.05;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${show(m)}  (target ${target} ±${tolerance}, peak ≤ ${tp})`);
    process.exit(ok ? 0 : 1);
  } else die(`unknown command ${cmd}`);
}
