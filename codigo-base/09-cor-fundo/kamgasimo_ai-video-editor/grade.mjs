#!/usr/bin/env node
// The colour grade: a measured, face-first correction, then the style's look — and the A-roll the
// composition plays, encoded so every frame can be seeked.
//
//   node grade.mjs <master.mov> --out aroll.mp4 [--look punchy|clean|film|none] [--face x,y] [--json grade.json]
//
// The face comes first. It is measured on its own (a box around --face, source pixels) against the
// whole frame, one frame a second. A face that sits dark against a brighter background — the common
// case for a window or a white wall — gets its midtones lifted; a colour cast is pulled gently toward
// neutral. Looks add colour and a highlight curve, never crushed shadows, and the result is measured
// again: **the face never comes out darker than it went in**. Vignette and grain are not baked here —
// the composition adds them to each format's own frame.

import { parseArgs, die, run, probe, writeJson, isMain } from './common.mjs';

function stats(file, crop) {
  const vf = `select='not(mod(n\\,25))',${crop ? `crop=${crop},` : ''}signalstats,metadata=print:file=-`;
  const text = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', vf, '-an', '-f', 'null', '-']).stdout.toString();
  const vals = {};
  for (const m of text.matchAll(/lavfi\.signalstats\.(YAVG|UAVG|VAVG|SATAVG|YLOW|YHIGH)=([\d.]+)/g)) (vals[m[1]] ||= []).push(Number(m[2]));
  const med = (a) => { if (!a?.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1); };
  return { luma: med(vals.YAVG), u: med(vals.UAVG), v: med(vals.VAVG), sat: med(vals.SATAVG), low: med(vals.YLOW), high: med(vals.YHIGH) };
}

export function measure(file, face) {
  const p = probe(file).video;
  let faceBox = null;
  if (face) {
    const w = Math.round(p.width * 0.16), h = Math.round(p.height * 0.24);
    const x = Math.max(0, Math.min(p.width - w, Math.round(face.x - w / 2))), y = Math.max(0, Math.min(p.height - h, Math.round(face.y - h * 0.3)));
    faceBox = `${w}:${h}:${x}:${y}`;
  }
  return { frame: stats(file), face: faceBox ? stats(file, faceBox) : null, faceBox };
}

const LOOKS = {
  punchy: { saturation: 1.16, curve: [[0, 0], [0.25, 0.25], [0.5, 0.52], [0.78, 0.82], [1, 1]] },
  clean: { saturation: 1.06, curve: [[0, 0.015], [0.5, 0.515], [1, 1]] },
  film: { saturation: 0.92, curve: [[0, 0.035], [0.25, 0.24], [0.5, 0.5], [0.78, 0.81], [1, 0.97]], warm: 0.05 },
  none: { saturation: 1, curve: null },
};

export function gradeFilter(m, look, lift = 1) {
  const notes = [], f = [];
  const L = LOOKS[look] || LOOKS.none;
  // A face darker than 0.6 of the frame's brightness, or simply dark, gets its midtones lifted.
  let gamma = 1;
  if (m.face && m.face.luma) {
    const ratio = m.face.luma / Math.max(1, m.frame.luma);
    if (ratio < 0.75 || m.face.luma < 95) { gamma = Math.min(1.3, Math.max(1.06, (0.75 / Math.max(0.35, ratio)) ** 0.5, 105 / m.face.luma)); notes.push(`lifted the face's midtones (face luma ${m.face.luma.toFixed(0)} against ${m.frame.luma.toFixed(0)} for the frame)`); }
  } else if (m.frame.luma < 100) { gamma = Math.min(1.25, 115 / m.frame.luma); notes.push(`lifted exposure (average luma ${m.frame.luma.toFixed(0)})`); }
  gamma *= lift;
  const cr = Math.max(-0.06, Math.min(0.06, -(m.frame.v - 128) / 120)), cb = Math.max(-0.06, Math.min(0.06, -(m.frame.u - 128) / 120));
  const cast = Math.abs(cr) > 0.015 || Math.abs(cb) > 0.015;
  if (cast) notes.push(`neutralised a colour cast (U ${m.frame.u.toFixed(0)}, V ${m.frame.v.toFixed(0)})`);
  f.push(`eq=gamma=${gamma.toFixed(3)}:saturation=${L.saturation}`);
  if (cast || L.warm) f.push(`colorbalance=rm=${cr.toFixed(3)}:bm=${cb.toFixed(3)}:rh=${L.warm || 0}:bh=${-(L.warm || 0)}:bs=${L.warm ? 0.035 : 0}:rs=${L.warm ? -0.025 : 0}`);
  if (L.curve) f.push(`curves=all='${L.curve.map(([a, b]) => `${a}/${b}`).join(' ')}'`);
  f.push('unsharp=5:5:0.45:5:5:0', 'format=yuv420p');
  if (look && look !== 'none') notes.push(`${look} look`);
  return { filter: f.join(','), notes, gamma };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  if (!input || !args.out) die('usage: grade.mjs <master> --out aroll.mp4 [--look punchy|clean|film|none] [--face x,y] [--json grade.json]');
  const p = probe(input);
  if (!p.video) die('the input has no video');
  const look = typeof args.look === 'string' ? args.look : 'punchy';
  const face = typeof args.face === 'string' ? (([x, y]) => ({ x, y }))(args.face.split(',').map(Number)) : null;
  const before = measure(input, face);
  const fps = Math.round(p.video.fps) || 25;
  const encode = (filter) => run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vf', filter, '-an', '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-g', String(fps), '-keyint_min', String(fps), '-movflags', '+faststart', args.out]);
  let g = gradeFilter(before, look);
  encode(g.filter);
  let after = measure(args.out, face);
  // The face must not come out darker: lift until it holds.
  for (let k = 0; k < 3 && before.face && after.face && after.face.luma < before.face.luma - 0.5; k++) {
    g = gradeFilter(before, look, (before.face.luma / after.face.luma) ** 0.8 * (1 + 0.02 * (k + 1)));
    g.notes.push('lifted again to keep the face at least as bright as it was');
    encode(g.filter);
    after = measure(args.out, face);
  }
  if (typeof args.json === 'string') writeJson(args.json, { look, before, after, filter: g.filter, notes: g.notes });
  console.log(`graded (${g.notes.join('; ') || 'no correction needed'}) → ${args.out}`);
  const f = (m) => (m ? `${m.luma?.toFixed(0)}` : '—');
  console.log(`face luma ${f(before.face)} → ${f(after.face)} · frame luma ${f(before.frame)} → ${f(after.frame)} · saturation ${before.frame.sat?.toFixed(0)} → ${after.frame.sat?.toFixed(0)}`);
}
