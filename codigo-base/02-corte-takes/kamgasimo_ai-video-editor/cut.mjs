#!/usr/bin/env node
// Render a cut list into a master, and write the timeline that maps source time to output time.
//
//   node cut.mjs <cuts.json> --out master.mov [--timeline timeline.json] [--fps n] [--punch 1.12]
//                [--no-clean] [--fade-ms 12]
//
// Every kept segment fades in and out over a few milliseconds so no join clicks. Every other segment
// is punched in around the face point, so each join reads as a camera change rather than a jump
// (--punch 1 turns that off). The voice gets a conservative clean — high-pass, gentle denoise, light
// compression — unless --no-clean. Loudness is loudness.mjs's job, afterwards.

import { resolve, dirname, isAbsolute, join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs, die, run, probe, readJson, writeJson, num, standardRate, parseRate, punchCrop } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const cutsPath = args._[0];
if (!cutsPath || !args.out) die('usage: cut.mjs <cuts.json> --out master.mov [--timeline f] [--fps n] [--punch z] [--no-clean] [--fade-ms n]');

const cuts = readJson(cutsPath);
const source = isAbsolute(cuts.source) ? cuts.source : resolve(dirname(resolve(cutsPath)), cuts.source);
if (!existsSync(source)) die(`source not found: ${source}`);
if (!Array.isArray(cuts.keep) || !cuts.keep.length) die('the cut list keeps nothing');

const src = probe(source);
if (!src.video || !src.audio) die('the source needs one video and one audio stream');
const W = src.video.width, H = src.video.height;
const rate = args.fps !== undefined ? parseRate(args.fps) : cuts.fps ? parseRate(cuts.fps) : standardRate(src.video.fps || 30);
const fps = rate.fps;
const punch = num(args.punch, cuts.punchIn ?? 1.12);
const fade = num(args['fade-ms'], 12) / 1000;
const face = cuts.face ?? { x: W / 2, y: H * 0.45 };

let prevEnd = -1;
for (const [i, s] of cuts.keep.entries()) {
  if (!(s.end > s.start)) die(`keep[${i}] ends before it starts`);
  if (s.start < prevEnd - 1e-6) die(`keep[${i}] overlaps the segment before it`);
  if (s.end > src.duration + 0.05) die(`keep[${i}] ends past the source (${src.duration.toFixed(2)}s)`);
  prevEnd = s.end;
}

const zoomFor = (i, seg) => seg.zoom ?? (punch > 1 && i % 2 === 1 ? punch : 1);

const fc = [];
cuts.keep.forEach((seg, i) => {
  const z = zoomFor(i, seg);
  let v = `[0:v]trim=${seg.start}:${seg.end},setpts=PTS-STARTPTS`;
  if (z > 1) {
    const { cw, ch, x0, y0 } = punchCrop(W, H, face, z);
    v += `,crop=${cw}:${ch}:${x0}:${y0},scale=${W}:${H}:flags=lanczos`;
  }
  fc.push(`${v},fps=${rate.rational}[v${i}]`);
  const d = seg.end - seg.start;
  fc.push(`[0:a]atrim=${seg.start}:${seg.end},asetpts=PTS-STARTPTS,afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, d - fade).toFixed(3)}:d=${fade}[a${i}]`);
});
const n = cuts.keep.length;
fc.push(`${Array.from({ length: n }, (_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[vout][ac]`);
fc.push(args['no-clean'] ? '[ac]anull[aout]'
  : '[ac]highpass=f=80,afftdn=nf=-50,acompressor=threshold=-28dB:ratio=3:attack=5:release=120:makeup=6dB[aout]');

run('ffmpeg', ['-v', 'error', '-y', '-i', source, '-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-ar', '48000', args.out]);

let out = 0;
const segments = cuts.keep.map((seg, i) => {
  const frames = Math.ceil((seg.end - seg.start) * fps - 1e-6);
  const rec = { srcStart: seg.start, srcEnd: seg.end, outStart: +out.toFixed(4), outEnd: +(out + frames / fps).toFixed(4), zoom: zoomFor(i, seg) };
  out += frames / fps;
  return rec;
});
const measured = probe(args.out).duration;
const timeline = { source, fps: +fps.toFixed(5), rate: rate.rational, planned: +out.toFixed(3), measured: +measured.toFixed(3), segments };
const timelinePath = args.timeline || join(dirname(resolve(args.out)), 'timeline.json');
writeJson(timelinePath, timeline);
console.log(`${n} segments · planned ${timeline.planned.toFixed(3)}s · measured ${timeline.measured.toFixed(3)}s${Math.abs(timeline.measured - timeline.planned) > 1.5 / fps ? '  ⚠ more than a frame apart' : ''}`);
console.log(`→ ${args.out}\n→ ${timelinePath}`);
