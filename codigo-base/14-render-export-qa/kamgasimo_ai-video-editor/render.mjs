#!/usr/bin/env node
// From the edit plan to finished files: compose, lint and render each format's picture; cue a sound
// effect on every visible event; mix the voice, the music and the effects; put the mix under each
// picture at the delivery loudness.
//
//   node render.mjs <edit.json> --out-dir OUT --name NAME [--formats vertical,landscape] [--draft]
//        [--no-sfx] [--no-music] [--under 13]
//
// Pictures render muted: the engine is not trusted with the sound (a render path that re-mixes audio
// was seen to raise its loudness), so the verified mix is laid under each picture afterwards. Cues
// come from what the picture does — a transition whooshes, a title slams, a card pops, a button clicks
// — in the style's sound vocabulary, never closer than 0.15 s to a stronger cue. --draft renders
// quickly at draft quality for review.

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { parseArgs, die, run, readJson, writeJson, isMain, SCRIPTS, loadStyle } from './common.mjs';
import { compose, ready, FORMATS } from './compose.mjs';
import { lint, render, validate } from './engine.mjs';
import { renderCues } from './sfx.mjs';
import { normalize } from './loudness.mjs';

const PRIORITY = ['transition', 'hook', 'reveal', 'press', 'snap', 'flash-hit', 'layout', 'count', 'enter', 'type', 'emoji'];

export function cuesFor(events, style) {
  const sx = style.sfx || {};
  const cues = [];
  for (const e of events) {
    const [kind, sub] = e.kind.split(':');
    let c = null;
    if (kind === 'transition') c = sub === 'glitch' ? { kind: sx.glitch || 'glitch' } : sub === 'flash' ? { kind: 'impact', gain: -5 } : sub === 'light-leak' ? { kind: 'whoosh-long', gain: -2 } : sub === 'dip' ? null : { kind: (sx.transition || ['whoosh'])[0] };
    else if (kind === 'hook') c = { kind: 'impact', gain: -2 };
    else if (kind === 'reveal') c = sx.density === 'low' ? (sx.reveal ? { kind: sx.reveal, gain: -4 } : null) : { kind: 'impact', gain: -6 };
    else if (kind === 'press') c = sx.cta ? { kind: sx.cta } : null;
    else if (kind === 'snap') c = sx.snap ? { kind: 'swoosh', gain: -5 } : null;
    else if (kind === 'flash-hit') c = { kind: 'impact', gain: -7 };
    else if (kind === 'layout') c = sx.density === 'low' ? null : { kind: 'swoosh', gain: -6 };
    else if (kind === 'count') c = { kind: 'ping', gain: -3 };
    else if (kind === 'enter') c = (sx.enter || [])[0] ? { kind: sx.enter[0], gain: -3 } : null;
    else if (kind === 'type') c = sx.type ? { kind: sx.type, gain: -4 } : null;
    else if (kind === 'emoji') c = sx.density === 'high' ? { kind: 'pop', gain: -7 } : null;
    if (c) cues.push({ at: Math.max(0, Math.round(e.at * 1000) / 1000), ...c, priority: PRIORITY.indexOf(kind) });
  }
  // strongest first; a weaker cue within 0.15 s of a kept one is dropped
  const kept = [];
  for (const c of [...cues].sort((a, b) => a.priority - b.priority || a.at - b.at)) if (!kept.some((k) => Math.abs(k.at - c.at) < 0.15)) kept.push(c);
  return kept.sort((a, b) => a.at - b.at).map(({ priority, ...c }) => c);
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const planFile = args._[0];
  if (!planFile || typeof args['out-dir'] !== 'string' || typeof args.name !== 'string') die('usage: render.mjs <edit.json> --out-dir OUT --name NAME [--formats a,b] [--draft] [--no-sfx] [--no-music] [--under dB]');
  await ready();
  const plan = readJson(planFile), work = dirname(resolve(planFile)), out = resolve(args['out-dir']);
  const style = loadStyle(plan.style || 'dynamic', dirname(resolve(planFile)));
  const formats = typeof args.formats === 'string' ? args.formats.split(',') : plan.formats || ['vertical'];
  mkdirSync(join(work, 'render'), { recursive: true });
  mkdirSync(out, { recursive: true });
  let events = null;
  const pictures = {};
  for (const f of formats) {
    if (!FORMATS[f]) die(`unknown format ${f}`);
    const dir = join(work, `compose-${f}`);
    const t0 = Date.now();
    const rep = compose(planFile, f, dir);
    events ||= rep.events;
    const l = lint(dir);
    if (l.errors) die(`${f}: the composition has ${l.errors} lint error(s):\n${l.report.split('\n').filter((x) => /✗/.test(x)).join('\n')}`);
    // scripts run in the browser before anything renders: a graphic that throws is named here
    const v = validate(dir);
    const failed = [...v.errors, ...v.warnings].filter((e) => /graphic \S+ failed|Error|not found|missing/i.test(e.text || ''));
    if (!v.ok || failed.length) die(`${f}: the composition fails in the browser:\n${[...new Set(failed.concat(v.errors).map((e) => `  ${e.text}`))].join('\n')}`);
    const pic = join(work, 'render', `${f}${args.draft ? '-draft' : ''}.mp4`);
    render(dir, pic, { fps: plan.fps, quality: args.draft ? 'draft' : 'looks' });
    pictures[f] = pic;
    console.log(`${f}: composed (${rep.events.length} events${rep.warnings.length ? `, ${rep.warnings.length} warning(s)` : ''}), linted, rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    for (const w of rep.warnings) console.log(`  ⚠ ${w}`);
  }

  // sound: effects from the events, then the mix
  const master = join(work, 'master.mov');
  // cues the picture reports, plus the plan's own for moments it cannot see
  const extra = (plan.beats || []).flatMap((b) => b.sfx || []).map((c) => ({ at: c.at, kind: c.kind, ...(c.gain !== undefined ? { gain: c.gain } : {}) }));
  const cues = args['no-sfx'] ? [] : [...cuesFor(events || [], style).filter((c) => !extra.some((x) => Math.abs(x.at - c.at) < 0.15)), ...extra].sort((a, b) => a.at - b.at);
  writeJson(join(work, 'sfx-cues.json'), cues);
  let sfx = null;
  if (cues.length) { sfx = join(work, 'sfx.wav'); renderCues(cues, plan.duration, sfx); }
  const music = !args['no-music'] && plan.music?.file && existsSync(join(work, plan.music.file)) ? join(work, plan.music.file) : null;
  const mix = join(work, 'mix.wav');
  const mixArgs = [join(SCRIPTS, 'mix.mjs'), '--voice', master, '--out', mix, '--json', join(work, 'mix.json'), '--under', String(args.under ?? style.music?.under ?? 14)];
  if (music) mixArgs.push('--music', music);
  if (sfx) mixArgs.push('--sfx', sfx);
  console.log(run(process.execPath, mixArgs).stdout.toString().trim());

  // each picture with the mix under it, at the delivery loudness
  for (const [f, pic] of Object.entries(pictures)) {
    const muxed = join(work, 'render', `${f}-muxed.mov`);
    run('ffmpeg', ['-v', 'error', '-y', '-i', pic, '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', '-shortest', muxed]);
    const dest = join(out, `${args.name}-${f}${args.draft ? '-draft' : ''}.mp4`);
    const m = normalize(muxed, dest, { target: -14, tp: -1.5 });
    console.log(`→ ${dest}  (${m.integrated} LUFS, true peak ${m.truePeak} dBTP)`);
  }
  console.log(`${cues.length} sound-effect cues${music ? ' · music' : ''} · ${Object.keys(pictures).length} format(s)`);
}
