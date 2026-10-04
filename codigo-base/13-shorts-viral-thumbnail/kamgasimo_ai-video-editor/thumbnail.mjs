#!/usr/bin/env node
// A thumbnail and a cover: the speaker's most expressive frame, cut out and outlined, with a bold title.
//
//   node thumbnail.mjs candidates <aroll.mp4> --words master-words.json --out candidates.jpg [--count 12]
//   node thumbnail.mjs make <aroll.mp4> --at 12.4 --title "AI CAN DO|THIS FOR YOU" --out thumb.jpg
//        [--kind youtube|cover] [--style dynamic] [--accent "#7C5CFF"]
//
// candidates  frames at the strongest word of each sentence — the moments a face is most animated — on
//             one sheet, in time order, their times printed; choose eyes open, mouth mid-word
// make        youtube: 1280×720, the speaker cut out on the right with a white outline and a glow, the
//             title in two lines on the left over a darkened, blurred copy of the frame; cover:
//             1080×1920, the frame full height with the title in pills across the upper third. A title
//             line after "|" takes the style's key colour. Rendered by the engine, nothing uploaded.

import { copyFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, die, run, readJson, tempDir, num, isMain, ASSETS, loadStyle } from './common.mjs';
import { contactSheet } from './frames.mjs';
import { removeBackground, snapshot, gsapPath } from './engine.mjs';

const STOP = new Set('a an the and or but so to of in on at for with from by as is are was were be it this that i you we they my your our do can will just very really not no'.split(' '));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, aroll] = args._;
  if (cmd === 'candidates') {
    if (!aroll || typeof args.words !== 'string' || typeof args.out !== 'string') die('usage: thumbnail.mjs candidates <aroll> --words f --out sheet.jpg [--count n]');
    const words = readJson(args.words);
    const sents = []; let cur = [];
    for (const w of words) { cur.push(w); if (/[.?!]$/.test(w.text)) { sents.push(cur); cur = []; } }
    if (cur.length) sents.push(cur);
    const pick = sents.map((s) => s.reduce((b, w) => { const n = w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); const sc = STOP.has(n) ? 0 : n.length + (/\d/.test(n) ? 5 : 0); return sc > b.sc ? { sc, t: w.start + 0.12 } : b; }, { sc: -1, t: s[0].start + 0.2 }).t);
    const count = num(args.count, 12);
    const times = (pick.length > count ? pick.filter((_, i) => i % Math.ceil(pick.length / count) === 0) : pick).slice(0, count).map((t) => +t.toFixed(2));
    contactSheet(aroll, times, { sheet: args.out, width: 360, cols: 4 });
    console.log(`${times.length} candidates → ${args.out}\n  at ${times.join(', ')}`);
  } else if (cmd === 'make') {
    if (!aroll || args.at === undefined || typeof args.title !== 'string' || typeof args.out !== 'string') die('usage: thumbnail.mjs make <aroll> --at s --title "A|B" --out f.jpg [--kind youtube|cover] [--style id] [--accent #hex]');
    const kind = args.kind === 'cover' ? 'cover' : 'youtube';
    const style = loadStyle(typeof args.style === 'string' ? args.style : 'dynamic');
    const base = style.palette ? style : loadStyle('dynamic');
    const pal = { ...base.palette, ...(typeof args.accent === 'string' ? { accent: args.accent } : {}) };
    const font = base.fonts?.display || 'Montserrat', key = { Montserrat: 'montserrat', Inter: 'inter', 'Playfair Display': 'playfair-display' }[font] || 'montserrat';
    const W = kind === 'cover' ? 1080 : 1280, H = kind === 'cover' ? 1920 : 720;
    const tmp = tempDir('aive-thumb-');
    try {
      const dir = join(tmp.dir, 'p'); mkdirSync(join(dir, 'assets'), { recursive: true }); mkdirSync(join(dir, 'vendor'), { recursive: true });
      run('ffmpeg', ['-v', 'error', '-y', '-ss', String(num(args.at)), '-i', aroll, '-frames:v', '1', join(dir, 'assets', 'frame.png')]);
      removeBackground(join(dir, 'assets', 'frame.png'), join(dir, 'assets', 'cut.png'));
      copyFileSync(gsapPath(), join(dir, 'vendor', 'gsap.min.js'));
      for (const w of [800, 900]) { const f = join(ASSETS, 'fonts', `${key}-${w}.woff2`); if (existsSync(f)) copyFileSync(f, join(dir, 'assets', `f${w}.woff2`)); }
      const lines = args.title.split('|').map((s) => s.trim()).filter(Boolean);
      const longest = Math.max(...lines.map((l) => l.length));
      const size = kind === 'cover' ? Math.min(150, Math.floor(960 / (longest * 0.8))) : Math.min(118, Math.floor(620 / (longest * 0.78)));
      const outline = [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, 4], [4, -4], [-4, -4]].map(([x, y]) => `drop-shadow(${x}px ${y}px 0 #fff)`).join(' ');
      const title = lines.map((l, i) => `<div class="t${i === lines.length - 1 && lines.length > 1 ? ' k' : ''}">${esc(l)}</div>`).join('');
      const body = kind === 'youtube'
        ? `<img class="bg" src="assets/frame.png"><div class="shade"></div><div class="glow"></div><img class="cut" src="assets/cut.png"><div class="title">${title}</div>`
        : `<div class="bgg"></div><div class="glowc"></div><img class="cutc" src="assets/cut.png"><div class="titlec">${title}</div>`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:T;src:url(assets/f900.woff2);font-weight:900}@font-face{font-family:T;src:url(assets/f800.woff2);font-weight:800}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#000}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden}
.bg{position:absolute;inset:-40px;width:${W + 80}px;height:${H + 80}px;object-fit:cover;filter:blur(14px) brightness(.55) saturate(1.2)}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,6,20,.92) 0%,rgba(8,6,20,.6) 48%,rgba(8,6,20,0) 75%)}
.glow{position:absolute;right:-120px;top:40px;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,${pal.accent}aa 0%,${pal.accent}00 65%)}
.cut{position:absolute;right:-60px;bottom:-40px;height:${H * 1.18}px;filter:${outline} drop-shadow(0 0 40px ${pal.accent})}
.title{position:absolute;left:56px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center;gap:10px;transform:rotate(-2deg)}
.t{font:900 ${size}px/1 T,sans-serif;color:#fff;text-transform:uppercase;-webkit-text-stroke:${Math.round(size * 0.06)}px #000;paint-order:stroke fill;text-shadow:0 10px 30px rgba(0,0,0,.6)}
.t.k{color:${pal.key}}
.bgc{position:absolute;inset:-40px;width:${W + 80}px;height:${H + 80}px;object-fit:cover;filter:blur(18px) brightness(.45) saturate(1.2)}
.bgg{position:absolute;inset:0;background:radial-gradient(70% 45% at 50% 30%,${pal.accent}55 0%,${pal.accent}00 70%),linear-gradient(170deg,${pal.panel} 0%,${pal.bg} 100%)}
.glowc{position:absolute;left:50%;top:${H * 0.38}px;width:1100px;height:1100px;margin-left:-550px;border-radius:50%;background:radial-gradient(circle,${pal.accent}99 0%,${pal.accent}00 65%)}
.shade2{position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,6,20,.7) 0%,rgba(8,6,20,0) 45%)}
.cutc{position:absolute;left:50%;bottom:-2px;height:${H * 0.74}px;transform:translateX(-50%);filter:${outline} drop-shadow(0 0 40px ${pal.accent})}
.titlec{position:absolute;left:0;right:0;top:${H * 0.1}px;display:flex;flex-direction:column;align-items:center;gap:14px;transform:rotate(-2deg)}
.titlec .t{background:rgba(8,6,20,.85);padding:6px 28px;border-radius:18px;-webkit-text-stroke:0}
</style></head><body><div id="root" data-composition-id="thumb" data-start="0" data-duration="1" data-width="${W}" data-height="${H}">${body}</div>
<script src="vendor/gsap.min.js"></script><script>document.fonts.ready.then(function(){var tl=gsap.timeline({paused:true});tl.set('#root',{opacity:1},0);window.__timelines["thumb"]=tl;});</script></body></html>`;
      writeFileSync(join(dir, 'index.html'), html);
      const shots = join(tmp.dir, 'shots');
      snapshot(dir, [0.5], shots);
      const png = readdirSync(shots).find((f) => f.endsWith('.png'));
      if (!png) die('the thumbnail did not render');
      run('ffmpeg', ['-v', 'error', '-y', '-i', join(shots, png), '-q:v', '2', args.out]);
      console.log(`${kind} ${W}×${H} → ${args.out}`);
    } finally { tmp.cleanup(); }
  } else die('usage: thumbnail.mjs candidates … | make …');
}
