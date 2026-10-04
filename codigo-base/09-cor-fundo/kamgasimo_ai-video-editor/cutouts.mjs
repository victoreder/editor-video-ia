#!/usr/bin/env node
// The speaker cut out of the picture, for every title the plan puts behind them.
//
//   node cutouts.mjs <edit.json>
//
// For each beat with textBehind, the A-roll's span (with a tenth of a second either side) is cut out by
// the local person-segmentation model — nothing is uploaded — into a transparent WebM, and the plan is
// updated with where it is and which span it covers. A span already cut out is kept.

import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { parseArgs, die, run, readJson, writeJson, tempDir, isMain } from './common.mjs';
import { removeBackground } from './engine.mjs';

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file) die('usage: cutouts.mjs <edit.json>');
  const plan = readJson(file), work = dirname(resolve(file));
  const aroll = resolve(work, plan.aroll);
  mkdirSync(join(work, 'cutouts'), { recursive: true });
  let made = 0;
  const tmp = tempDir('aive-cut-');
  try {
    for (const b of plan.beats) {
      const tb = b.textBehind;
      if (!tb) continue;
      const s = Math.max(0, (tb.at ?? b.start) - 0.1), e = Math.min(plan.duration, (tb.until ?? b.end) + 0.1);
      const out = join(work, 'cutouts', `${b.id}.webm`);
      if (!(tb.cutout && existsSync(resolve(work, tb.cutout)) && tb.cutoutStart === +s.toFixed(3) && tb.cutoutEnd === +e.toFixed(3))) {
        const clip = join(tmp.dir, `${b.id}.mp4`);
        run('ffmpeg', ['-v', 'error', '-y', '-ss', s.toFixed(3), '-to', e.toFixed(3), '-i', aroll, '-an', '-c:v', 'libx264', '-crf', '12', '-g', '1', clip]);
        removeBackground(clip, out);
        made++;
      }
      Object.assign(tb, { cutout: `cutouts/${b.id}.webm`, cutoutStart: +s.toFixed(3), cutoutEnd: +e.toFixed(3) });
    }
    writeJson(file, plan);
    console.log(`${made} cut-out(s) made · plan updated → ${file}`);
  } finally {
    tmp.cleanup();
  }
}
