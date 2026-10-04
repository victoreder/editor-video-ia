#!/usr/bin/env node
// Where the speaker is, over time: a person cut-out of a small proxy, read as a silhouette five times a
// second. It drives the tracking reframe, keeps captions and stickers off the mouth, and says where a
// title can sit behind the head.
//
//   node track.mjs <aroll.mp4> --out track.json --face x,y --mouth y [--at secs] [--sheet track.jpg]
//
// --face and --mouth are the point between the eyes and the mouth's height, in source pixels, read from
// one frame (at --at, default the middle): they calibrate where the face sits inside the silhouette's
// head, so every other sample places them too. The reframe path follows the head like a camera
// operator: it holds still until the head moves more than 4 % of the frame's width, then eases to it.
// --sheet draws the tracked face box and mouth line on eight frames, to look at.

import { join } from 'node:path';
import { parseArgs, die, run, probe, tempDir, writeJson, num, isMain } from './common.mjs';
import { removeBackground } from './engine.mjs';
import { contactSheet } from './frames.mjs';

const RATE = 5, PW = 480;

function silhouette(mask, W, H) {
  const rowCount = new Int32Array(H);
  for (let y = 0; y < H; y++) { let c = 0; for (let x = 0; x < W; x++) if (mask[y * W + x] > 127) c++; rowCount[y] = c; }
  let top = -1;
  for (let y = 0; y < H; y++) if (rowCount[y] >= Math.max(3, W * 0.02)) { top = y; break; }
  if (top < 0) return null;
  const band = Math.round(H * 0.14);
  let sx = 0, n = 0;
  for (let y = top; y < Math.min(H, top + band); y++) for (let x = 0; x < W; x++) if (mask[y * W + x] > 127) { sx += x; n++; }
  const yw = Math.min(H - 1, top + Math.round(H * 0.12));
  let x0 = -1, x1 = -1;
  for (let x = 0; x < W; x++) if (mask[yw * W + x] > 127) { if (x0 < 0) x0 = x; x1 = x; }
  let area = 0; for (const c of rowCount) area += c;
  return { top, cx: n ? sx / n : W / 2, width: x0 >= 0 ? x1 - x0 + 1 : 0, area: area / (W * H) };
}

// Hold until the target moves past the dead zone, then ease toward it (time constant tau seconds).
function follow(values, dt, dead, tau = 0.6) {
  const out = []; let p = values[0], moving = false;
  const a = 1 - Math.exp(-dt / tau);
  for (const v of values) {
    if (Math.abs(v - p) > dead) moving = true;
    if (moving) { p += (v - p) * a; if (Math.abs(v - p) < dead * 0.25) moving = false; }
    out.push(p);
  }
  return out;
}
const median = (arr, w) => arr.map((_, i) => { const s = arr.slice(Math.max(0, i - w), i + w + 1).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; });

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  if (!input || !args.out || typeof args.face !== 'string' || args.mouth === undefined) die('usage: track.mjs <aroll.mp4> --out track.json --face x,y --mouth y [--at secs] [--sheet track.jpg]');
  const p = probe(input);
  const SW = p.video.width, SH = p.video.height, PH = Math.round(PW * SH / SW / 2) * 2, k = SW / PW;
  const [fx, fy] = args.face.split(',').map(Number), my = num(args.mouth);
  const tmp = tempDir('aive-track-');
  try {
    const proxy = join(tmp.dir, 'proxy.mp4'), matte = join(tmp.dir, 'matte.webm');
    run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vf', `fps=${RATE},scale=${PW}:${PH}`, '-an', '-c:v', 'libx264', '-crf', '18', '-g', String(RATE), proxy]);
    removeBackground(proxy, matte);
    const raw = run('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', matte, '-vf', 'alphaextract,format=gray', '-f', 'rawvideo', '-']).stdout;
    const frames = Math.floor(raw.length / (PW * PH));
    const samples = [];
    for (let i = 0; i < frames; i++) {
      const s = silhouette(raw.subarray(i * PW * PH, (i + 1) * PW * PH), PW, PH);
      samples.push(s ? { t: +(i / RATE).toFixed(2), headTop: +(s.top * k).toFixed(1), cx: +(s.cx * k).toFixed(1), headW: +(s.width * k).toFixed(1), area: +s.area.toFixed(3) } : { t: +(i / RATE).toFixed(2), lost: true });
    }
    const found = samples.filter((s) => !s.lost);
    if (!found.length) die('no person found in the picture');
    // calibrate the face and mouth inside the head, at the frame the operator read them from
    const at = num(args.at, p.duration / 2);
    const ref = found.reduce((a, b) => (Math.abs(b.t - at) < Math.abs(a.t - at) ? b : a));
    const calib = { at: ref.t, kx: (fx - ref.cx) / ref.headW, kFace: (fy - ref.headTop) / ref.headW, kMouth: (my - ref.headTop) / ref.headW };
    // fill lost samples from their neighbours, then smooth
    const fill = (key) => { let last = found[0][key]; return samples.map((s) => (s.lost ? last : (last = s[key]))); };
    const cxs = median(fill('cx'), 2), tops = median(fill('headTop'), 2), ws = median(fill('headW'), 2);
    const faceX = cxs.map((c, i) => c + calib.kx * ws[i]), faceY = tops.map((t, i) => t + calib.kFace * ws[i]), mouthY = tops.map((t, i) => t + calib.kMouth * ws[i]);
    const pathX = follow(faceX, 1 / RATE, SW * 0.04), pathY = follow(faceY, 1 / RATE, SH * 0.05);
    const track = {
      source: { width: SW, height: SH }, rate: RATE, calib,
      samples: samples.map((s, i) => ({ t: s.t, faceX: +faceX[i].toFixed(1), faceY: +faceY[i].toFixed(1), mouthY: +mouthY[i].toFixed(1), headTop: +tops[i].toFixed(1), headW: +ws[i].toFixed(1), ...(s.lost ? { lost: true } : {}) })),
      path: samples.map((s, i) => ({ t: s.t, x: +pathX[i].toFixed(1), y: +pathY[i].toFixed(1) })),
    };
    writeJson(args.out, track);
    const spread = Math.max(...faceX) - Math.min(...faceX);
    console.log(`${samples.length} samples at ${RATE}/s · ${samples.length - found.length} without a person · face moves across ${(spread / SW * 100).toFixed(0)} % of the width · mouth ${Math.min(...mouthY).toFixed(0)}–${Math.max(...mouthY).toFixed(0)} px → ${args.out}`);
    if (typeof args.sheet === 'string') {
      const times = Array.from({ length: 8 }, (_, i) => +((i + 0.5) * p.duration / 8).toFixed(2));
      const boxes = times.map((t) => { const i = Math.min(samples.length - 1, Math.round(t * RATE)); return { x: pathX[i], y: pathY[i], m: mouthY[i], w: ws[i] }; });
      // one marked frame per time: the face box around the path point, and the mouth line
      const marked = join(tmp.dir, 'marked.mp4');
      const draw = boxes.map((b, j) => {
        const half = 0.6 / (p.video.fps || 25), en = `between(t\\,${(times[j] - half).toFixed(3)}\\,${(times[j] + half).toFixed(3)})`;
        return `drawbox=x=${Math.round(b.x - b.w * 0.4)}:y=${Math.round(b.y - b.w * 0.45)}:w=${Math.round(b.w * 0.8)}:h=${Math.round(b.w * 0.9)}:color=yellow@0.9:t=6:enable='${en}',drawbox=x=${Math.round(b.x - b.w * 0.5)}:y=${Math.round(b.m)}:w=${Math.round(b.w)}:h=4:color=red@0.9:t=fill:enable='${en}'`;
      }).join(',');
      run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vf', draw, '-an', '-c:v', 'libx264', '-crf', '20', marked]);
      contactSheet(marked, times, { sheet: args.sheet, width: 360 });
      console.log(`→ ${args.sheet} (yellow: the tracked face box; red: the mouth line)`);
    }
  } finally {
    tmp.cleanup();
  }
}
