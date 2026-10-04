#!/usr/bin/env node
// B-roll: footage over the speaker's words — from the user's own folder, or searched on Pexels.
//
//   node broll.mjs folder <dir> --sheet folder.jpg          list a folder's clips and images, with a sheet
//   node broll.mjs pexels --query "city skyline at night" --out b04.mp4 [--orientation portrait|landscape|square]
//                  [--min-duration 3]
//
// folder   every video and image in the folder, with its length and size, and one frame of each on a
//          sheet in the same order — to choose by looking, not by file name
// pexels   the best match on Pexels (free licence, no attribution required) for the orientation, at
//          least --min-duration long, downloaded at the smallest size at or above 1080 px. Needs a free
//          PEXELS_API_KEY; only the search words are sent. The chosen clip's page and author are printed
//          and written beside it (.json), so credit can be given anyway.
// A generated clip or image (from a service connected to the session) is used like any file: save it,
// then point the beat's broll.file at it.

import { readdirSync, statSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { parseArgs, die, probe, writeJson, num, isMain, tempDir, run, cacheDir } from './common.mjs';

const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']), IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp']);

async function pexels(query, { orientation = 'portrait', minDuration = 3, out }) {
  // the key comes from the environment, or from the skill's config (written once, never printed)
  const cfgPath = join(cacheDir(), 'config.json');
  const key = process.env.PEXELS_API_KEY || (existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')).pexelsKey : null);
  if (!key) die(`no Pexels key — get a free one at https://www.pexels.com/api/, then export PEXELS_API_KEY or save it as {"pexelsKey": "…"} in ${cfgPath}`, 3);
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=15&size=medium`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) die(`Pexels answered HTTP ${res.status}`, 3);
  const data = await res.json();
  const want = orientation === 'portrait' ? (w, h) => h >= w : orientation === 'landscape' ? (w, h) => w > h : (w, h) => Math.abs(w - h) < w * 0.2;
  const videos = (data.videos || []).filter((v) => v.duration >= minDuration && want(v.width, v.height));
  if (!videos.length) die(`no ${orientation} clip of at least ${minDuration}s for "${query}"`, 4);
  const v = videos[0];
  const files = v.video_files.filter((f) => f.file_type === 'video/mp4' && Math.min(f.width, f.height) >= 1080).sort((a, b) => a.width * a.height - b.width * b.height);
  const f = files[0] || v.video_files.filter((x) => x.file_type === 'video/mp4').sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const dl = await fetch(f.link);
  if (!dl.ok) die(`download failed: HTTP ${dl.status}`, 3);
  writeFileSync(out, Buffer.from(await dl.arrayBuffer()));
  const credit = { source: 'Pexels', page: v.url, author: v.user?.name, authorUrl: v.user?.url, licence: 'https://www.pexels.com/license/', query, width: f.width, height: f.height, duration: v.duration };
  writeJson(`${out}.json`, credit);
  return credit;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'folder') {
    const dir = args._[1];
    if (!dir) die('usage: broll.mjs folder <dir> [--sheet f]');
    const files = readdirSync(dir).filter((f) => VIDEO.has(extname(f).toLowerCase()) || IMAGE.has(extname(f).toLowerCase())).sort();
    const tmp = tempDir('aive-broll-');
    try {
      const frames = [];
      files.forEach((f, i) => {
        const path = join(dir, f), isV = VIDEO.has(extname(f).toLowerCase());
        const p = probe(path);
        console.log(`${String(i + 1).padStart(2)}. ${f}  ${isV ? `${p.duration.toFixed(1)}s ` : 'image '}${p.video ? `${p.video.width}×${p.video.height}` : ''}  ${(statSync(path).size / 1e6).toFixed(1)} MB`);
        const still = join(tmp.dir, `${String(i).padStart(3, '0')}.mp4`);
        run('ffmpeg', ['-v', 'error', '-y', ...(isV ? ['-ss', String(Math.min(1, p.duration / 2))] : ['-loop', '1', '-t', '0.2']), '-i', path, '-frames:v', '1', '-vf', 'scale=480:480:force_original_aspect_ratio=decrease,pad=480:480:(ow-iw)/2:(oh-ih)/2', still.replace('.mp4', '.png')]);
        frames.push(still.replace('.mp4', '.png'));
      });
      // the stills are already square and padded: tiled as they are, in the order listed
      if (typeof args.sheet === 'string' && frames.length) {
        const c = Math.min(6, frames.length), r = Math.ceil(frames.length / c);
        run('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', join(tmp.dir, '%03d.png'), '-vf', `scale=240:240,tile=${c}x${r}:padding=4:color=black`, '-frames:v', '1', args.sheet]);
        console.log(`→ ${args.sheet} (in the order listed)`);
      }
    } finally { tmp.cleanup(); }
  } else if (cmd === 'pexels') {
    if (typeof args.query !== 'string' || typeof args.out !== 'string') die('usage: broll.mjs pexels --query "…" --out file.mp4 [--orientation portrait|landscape|square] [--min-duration s]');
    const c = await pexels(args.query, { orientation: typeof args.orientation === 'string' ? args.orientation : 'portrait', minDuration: num(args['min-duration'], 3), out: args.out });
    console.log(`${basename(args.out)}: ${c.width}×${c.height}, ${c.duration}s — by ${c.author} on Pexels (${c.page})`);
  } else die('usage: broll.mjs folder <dir> [--sheet f] | pexels --query "…" --out f.mp4');
}
