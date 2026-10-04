#!/usr/bin/env node
// Reframe a video to another shape around the speaker's face — landscape to vertical or square.
//
//   node reframe.mjs <video> --out <out.mov> (--size 1080x1920 | --aspect 9:16) [--face x,y | --cuts cuts.json] [--fps n]
//
// The crop keeps the face centred horizontally and in the upper part of the frame, and never extends
// past the source. A subject that moves across the frame is not tracked: check frames across the
// result and report any where the face leaves the crop.

import { extname } from 'node:path';
import { parseArgs, die, run, probe, readJson, standardRate, parseRate, isMain } from './common.mjs';

const even = (x) => Math.max(2, Math.floor(x / 2) * 2);

// The largest crop of the target shape that fits the source, placed around the face: centred on it
// across, with the face 42 % of the way down.
export function cropFor(sw, sh, W, H, face = { x: sw / 2, y: sh * 0.45 }) {
  const target = W / H;
  let cw, ch;
  if (sw / sh > target) { ch = even(sh); cw = even(ch * target); } else { cw = even(sw); ch = even(cw / target); }
  const x0 = Math.max(0, Math.min(sw - cw, Math.round(face.x - cw / 2)));
  const y0 = Math.max(0, Math.min(sh - ch, Math.round(face.y - ch * 0.42)));
  return { cw, ch, x0, y0 };
}

export function targetSize(sw, sh, { size, aspect }) {
  if (size) return String(size).split('x').map(Number);
  const [aw, ah] = String(aspect).split(':').map(Number);
  const short = Math.min(sw, sh) >= 1080 ? 1080 : Math.min(sw, sh) - (Math.min(sw, sh) % 2);
  return aw <= ah ? [short, Math.round(short * ah / aw / 2) * 2] : [Math.round(short * aw / ah / 2) * 2, short];
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  if (!input || !args.out || (!args.size && !args.aspect)) die('usage: reframe.mjs <video> --out out.mov (--size WxH | --aspect W:H) [--face x,y | --cuts cuts.json] [--fps n]');

  const p = probe(input);
  if (!p.video) die('the input has no video stream');
  const sw = p.video.width, sh = p.video.height;
  const [W, H] = targetSize(sw, sh, args);
  let face = { x: sw / 2, y: sh * 0.45 };
  if (typeof args.face === 'string') { const [x, y] = args.face.split(',').map(Number); face = { x, y }; }
  else if (args.cuts) { const c = readJson(args.cuts); if (c.face) face = c.face; }

  const { cw, ch, x0, y0 } = cropFor(sw, sh, W, H, face);
  const rate = args.fps !== undefined ? parseRate(args.fps) : standardRate(p.video.fps || 30);
  // A .mov keeps the audio as it is; an .mp4 cannot hold uncompressed audio, so it gets AAC.
  const mp4 = extname(args.out).toLowerCase() === '.mp4';
  const audio = !p.audio ? ['-an'] : mp4 && p.audio.codec.startsWith('pcm') ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'copy'];

  run('ffmpeg', ['-v', 'error', '-y', '-i', input,
    '-vf', `crop=${cw}:${ch}:${x0}:${y0},scale=${W}:${H}:flags=lanczos,fps=${rate.rational},format=yuv420p`,
    '-c:v', 'libx264', '-crf', mp4 ? '17' : '14', '-preset', 'medium', ...audio, ...(mp4 ? ['-movflags', '+faststart'] : []), args.out]);

  const scale = W / cw;
  console.log(`crop ${cw}×${ch} at ${x0},${y0} of ${sw}×${sh} → ${W}×${H} (×${scale.toFixed(2)}${scale > 1.5 ? ' — upscaled, expect softness' : ''}) → ${args.out}`);
}
