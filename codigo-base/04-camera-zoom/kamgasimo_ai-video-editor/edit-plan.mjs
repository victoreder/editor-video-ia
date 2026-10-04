#!/usr/bin/env node
// The edit plan: what the finished video does, beat by beat, on the output timeline.
//
//   node edit-plan.mjs draft --work WORK --out WORK/edit.json [--style dynamic] [--sections 5.2,9.7]
//        [--hook "WHAT CAN AI|DO FOR YOU?"] [--formats vertical,landscape]
//   node edit-plan.mjs check WORK/edit.json
//
// draft writes a complete, valid plan from the work folder — the mechanical decisions an editor makes
// by rule, so the creative ones are all that is left:
//   camera    a new zoom level at every cut, so no jump cut shows; a slow push on a long shot; a snap
//             zoom on an emphasised word, no closer together than the style allows
//   sections  topic changes (given, or found where a sentence starts after a long pause), each
//             carrying a transition, moved onto the nearest cut
//   captions  one emphasised word per chunk at most, and an emoji where the style allows one
//   ending    the style's call to action and progress bar
// It lists graphic opportunities — numbers, lists, comparisons, steps, claims — under notes, for the
// agent to turn into graphics. check validates a plan and holds it to the style's craft rules.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { parseArgs, die, readJson, writeJson, probe, num, isMain, ASSETS, loadStyle } from './common.mjs';

const STOP = new Set('a an the and or but so to of in on at for with from by as is are was were be been being it its this that these those there here i you he she we they me him her us them my your our their do does did done have has had can could will would should may might must just very really also not no yes if then than too more most some any all each every one two about into over under out up down what which who whom whose when where why how'.split(' '));
const WEAK = new Set('thing things something anything everything stuff going gonna getting becoming become became actually basically literally really kind sort lot lots maybe probably currently different able other another'.split(' '));
const POWER = new Set('impressive amazing incredible insane secret secrets free never always best worst now today new fast easy simple huge massive only first last money growth mistake mistakes proven guaranteed instantly powerful'.split(' '));
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const r2 = (x) => Math.round(x * 100) / 100;

function sentences(words) {
  const out = []; let cur = [];
  for (const w of words) { cur.push(w); if (/[.?!]$/.test(w.text)) { out.push(cur); cur = []; } }
  if (cur.length) out.push(cur);
  return out;
}

export function draft({ work, styleId = 'dynamic', sections: given, hook, formats }) {
  const style = loadStyle(styleId, work);
  const words = readJson(join(work, 'master-words.json'));
  const timeline = readJson(join(work, 'timeline.json'));
  const cuts = readJson(join(work, 'cuts.json'));
  const arollPath = join(work, 'aroll.mp4');
  const a = probe(existsSync(arollPath) ? arollPath : join(work, 'master.mov'));
  const D = +a.duration.toFixed(3), fps = Math.round(timeline.fps || a.video.fps || 25);
  const joins = timeline.segments.slice(1).map((s) => s.outStart);
  const sents = sentences(words);
  const starts = sents.map((s) => s[0].start);
  const nearestJoin = (t, within = 0.45) => { let best = null; for (const j of joins) if (Math.abs(j - t) <= within && (best === null || Math.abs(j - t) < Math.abs(best - t))) best = j; return best; };

  // sections: given, or sentence starts after the longest pauses, spaced by the style's minimum gap
  let secs = given?.length ? given : [];
  if (!secs.length) {
    const gap = style.transitions?.minGap ?? 10;
    const cand = sents.slice(1).map((s, i) => ({ t: s[0].start, pause: s[0].start - sents[i][sents[i].length - 1].start })).sort((x, y) => y.pause - x.pause);
    for (const c of cand) if (c.t > 3 && c.t < D - 3 && secs.every((x) => Math.abs(x - c.t) >= gap)) secs.push(c.t);
    secs.sort((x, y) => x - y);
  }
  secs = secs.map((t) => r2(nearestJoin(t) ?? t - 0.05));

  // beats: one per sentence, cut at sections too, tiling 0 → D
  // a sentence start within 0.9 s of a section start is the same boundary: the section's wins
  const sentenceBounds = starts.slice(1).map((t) => r2(nearestJoin(t, 0.3) ?? Math.max(0, t - 0.08))).filter((t) => secs.every((x) => Math.abs(x - t) > 0.9));
  const bounds = [...new Set([0, ...sentenceBounds, ...secs])].filter((t) => t >= 0 && t < D - 0.6).sort((x, y) => x - y);
  const beats = bounds.map((t, i) => ({ id: `b${String(i + 1).padStart(2, '0')}`, start: r2(t), end: r2(bounds[i + 1] ?? D), layout: 'full', camera: [], effects: [] }));
  beats[beats.length - 1].end = D;

  // camera: a level change at every cut and beat start; pushes; snap zooms on emphasis
  const levels = style.camera?.levels || [1, 1.1];
  let li = 0;
  const changes = [...new Set([0, ...joins, ...bounds])].sort((x, y) => x - y);
  const beatAt = (t) => beats.find((b) => t >= b.start - 1e-6 && t < b.end) || beats[beats.length - 1];
  changes.forEach((t, k) => {
    const z = levels[li % levels.length]; li++;
    const next = changes[k + 1] ?? D, len = next - t;
    const b = beatAt(t);
    if (style.camera?.push && len > 2.6) b.camera.push({ at: r2(t), zoom: z, to: r2(z + style.camera.push), over: r2(len) });
    else b.camera.push({ at: r2(t), zoom: z });
  });

  // captions: one emphasis per chunk; emoji where the style allows
  const capFile = join(work, 'captions.json');
  const chunks = existsSync(capFile) ? readJson(capFile).chunks : [];
  const emojiMap = readJson(join(ASSETS, 'emoji.json'));
  const emphasis = [], emoji = [];
  let lastEmoji = -99, lastSnap = -99;
  const score = (w, i, arr) => {
    const n = norm(w.text); if (!n || STOP.has(n) || WEAK.has(n)) return 0;
    if (/\d/.test(n)) return 9;
    if (POWER.has(n)) return 7;
    if (/^\p{Lu}/u.test(w.text) && i > 0 && n.length > 1) return 6;
    return n.length >= 6 ? 2 + n.length / 10 : 0;
  };
  for (const c of chunks) {
    if (!(style.captions?.emphasisPerChunk > 0)) break;
    const src = words.filter((w) => w.start >= c.start - 0.08 && w.start < c.end);
    let best = null, bs = 0;
    src.forEach((w, i) => { const s = score(w, i, src); if (s > bs) { bs = s; best = w; } });
    if (!best || bs < 2.6 || (emphasis.length && best.start - emphasis[emphasis.length - 1] < 1.1)) continue;
    emphasis.push(r2(best.start));
    const e = emojiMap[norm(best.text)];
    if (e && style.captions?.emojiEvery && best.start - lastEmoji >= style.captions.emojiEvery) { emoji.push({ at: r2(best.start), char: e }); lastEmoji = best.start; }
    if (style.camera?.snapZoom && bs >= 6 && best.start - lastSnap >= (style.camera.snapEvery || 6) && !joins.some((j) => Math.abs(j - best.start) < 0.4)) {
      // a snap always moves closer: 0.14 past the level it interrupts
      const bt = beatAt(best.start), prev = bt.camera.filter((c) => c.at <= best.start).pop();
      const level = prev ? (prev.over ? prev.zoom + (prev.to - prev.zoom) * Math.min(1, (best.start - prev.at) / prev.over) : prev.zoom) : 1;
      bt.camera.push({ at: r2(best.start), zoom: r2(Math.min(1.34, Math.max(style.camera.snapZoom, level + 0.14))), snap: true });
      lastSnap = best.start;
    }
  }
  // a push ends where the next move begins, so a snap zoom holds instead of being pulled back
  beats.forEach((b) => {
    b.camera.sort((x, y) => x.at - y.at);
    b.camera.forEach((c, i) => { const next = b.camera[i + 1]; if (c.over && next && c.at + c.over > next.at) { const k = (next.at - c.at) / c.over; c.to = r2(c.zoom + (c.to - c.zoom) * k); c.over = r2(next.at - c.at); } });
  });

  // transitions at section starts (on the beat that ends there)
  const set = style.transitions?.set || [];
  secs.forEach((t, k) => { const b = beats.find((x) => Math.abs(x.end - t) < 0.02); if (b && set.length) b.transition = { kind: set[k % set.length] }; });

  // opportunities for graphics
  const opps = [];
  sents.forEach((s) => {
    const text = s.map((w) => w.text).join(' '), t0 = r2(s[0].start), t1 = r2(s[s.length - 1].start + 0.4);
    if (/\d/.test(text) || /\b(percent|million|thousand|hundred|twice|double|half)\b/i.test(text)) opps.push({ at: t0, until: t1, kind: 'number', suggest: 'stat or chart', text });
    else if ((text.match(/,/g) || []).length >= 2) opps.push({ at: t0, until: t1, kind: 'list', suggest: 'cards or list', text });
    else if (/\b(vs|versus|instead of|rather than|before|after|compared|than)\b/i.test(text)) opps.push({ at: t0, until: t1, kind: 'contrast', suggest: 'compare', text });
    else if (/\b(first|second|third|then|next|finally|step)\b/i.test(text)) opps.push({ at: t0, until: t1, kind: 'process', suggest: 'steps', text });
    else if (s.some((w, i) => i > 0 && /^\p{Lu}/u.test(w.text) && norm(w.text).length > 2)) opps.push({ at: t0, until: t1, kind: 'named thing', suggest: 'icon, ui or B-roll', text });
  });

  const plan = {
    version: 1, style: styleId, brand: {}, fps, duration: D,
    formats: formats || (a.video.height > a.video.width ? ['vertical'] : ['vertical', 'landscape']),
    source: { width: a.video.width, height: a.video.height },
    aroll: existsSync(arollPath) ? 'aroll.mp4' : 'master.mov', words: 'master-words.json', track: existsSync(join(work, 'track.json')) ? 'track.json' : null,
    face: cuts.face || { x: a.video.width / 2, y: a.video.height * 0.45, mouth: a.video.height * 0.62 },
    captions: { file: 'captions.json', emphasis, emoji, hide: [] },
    sections: secs, beats,
    hook: hook ? { title: hook, until: 1.8 } : null,
    cta: style.cta ? { text: style.cta.text, icon: style.cta.icon, at: r2(Math.max(D * 0.8, D - 2.4)) } : null,
    progress: Boolean(style.progress), grade: style.grade,
    music: existsSync(join(work, 'music.json')) ? { file: 'music.wav', info: 'music.json' } : null,
    notes: { opportunities: opps, todo: ['write the hook title (hook.title, "LINE ONE|LINE TWO")', 'turn the strongest opportunities into graphics (beats[].graphic)', 'check the sections are real topic changes'] },
  };
  return plan;
}

// ---------------------------------------------------------------- check

const LAYOUTS = new Set(['full', 'split', 'overlay', 'cutaway', 'pip']);
const TRANSITIONS = new Set(['cut', 'whip', 'slide', 'zoom', 'flash', 'glitch', 'light-leak', 'dip']);
const EFFECTS = new Set(['shake', 'flash-hit', 'rgb-pulse']);

export function check(file) {
  const plan = readJson(file), base = dirname(resolve(file));
  const errors = [], warnings = [], info = [];
  const style = loadStyle(plan.style || 'dynamic', base);
  const D = plan.duration;
  for (const k of ['aroll', 'words']) if (!plan[k] || !existsSync(resolve(base, plan[k]))) errors.push(`${k}: file missing (${plan[k]})`);
  if (plan.captions?.file && !existsSync(resolve(base, plan.captions.file))) errors.push(`captions.file missing (${plan.captions.file})`);
  const beats = [...(plan.beats || [])].sort((a, b) => a.start - b.start);
  if (!beats.length) errors.push('no beats');
  else {
    if (Math.abs(beats[0].start) > 0.02) errors.push(`the first beat starts at ${beats[0].start}, not 0`);
    if (Math.abs(beats[beats.length - 1].end - D) > 0.05) errors.push(`the last beat ends at ${beats[beats.length - 1].end}, not at the duration ${D}`);
    beats.forEach((b, i) => { if (i && Math.abs(b.start - beats[i - 1].end) > 0.02) errors.push(`${b.id}: gap or overlap with ${beats[i - 1].id} (${beats[i - 1].end} → ${b.start})`); });
  }
  const components = new Set(['cards', 'title', 'list', 'stat', 'icon', 'compare', 'steps', 'quote', 'chart', 'ui', 'lowerthird', 'sticker', 'confetti']);
  const words = plan.words && existsSync(resolve(base, plan.words)) ? readJson(resolve(base, plan.words)) : [];
  const changes = [0];
  let transitions = [], graphicTime = 0;
  for (const b of beats) {
    if (!LAYOUTS.has(b.layout || 'full')) errors.push(`${b.id}: unknown layout "${b.layout}"`);
    for (const c of b.camera || []) {
      if (c.at < b.start - 0.01 || c.at > b.end + 0.01) errors.push(`${b.id}: camera move at ${c.at} outside the beat`);
      if ((c.zoom ?? 1) < 1 || (c.to ?? 1) < 1) errors.push(`${b.id}: a zoom below 1 would show past the recording's edge`);
      if ((c.zoom ?? 1) > (style.camera?.maxZoom ?? 1.3) + 1e-6) warnings.push(`${b.id}: zoom ${c.zoom} over the style's ${style.camera?.maxZoom}`);
      changes.push(c.at);
    }
    for (const e of b.effects || []) if (!EFFECTS.has(e.kind)) errors.push(`${b.id}: unknown effect "${e.kind}"`);
    if (b.transition) { if (!TRANSITIONS.has(b.transition.kind)) errors.push(`${b.id}: unknown transition "${b.transition.kind}"`); else if (b.transition.kind !== 'cut') { transitions.push(b.end); changes.push(b.end); } }
    const gx = b.graphic;
    if (gx) {
      if (gx.component && !components.has(gx.component)) errors.push(`${b.id}: unknown component "${gx.component}"`);
      if (gx.scene && !existsSync(resolve(base, gx.scene))) errors.push(`${b.id}: scene file missing (${gx.scene})`);
      const g0 = gx.at ?? b.start, g1 = gx.until ?? b.end;
      if (g0 < b.start - 0.01 || g1 > b.end + 0.01) errors.push(`${b.id}: graphic ${g0}–${g1} outside its beat`);
      graphicTime += Math.max(0, g1 - g0); changes.push(g0, g1);
      const items = gx.props?.items || [];
      const unsynced = items.filter((it) => !it.word).length;
      if (unsynced) warnings.push(`${b.id}: ${unsynced} of ${items.length} items have no word to land on`);
      for (const it of items) if (it.word && !words.some((w) => norm(w.text).startsWith(norm(String(it.word).split(/\s+/)[0])) && w.start >= g0 - 0.3 && w.start <= g1)) warnings.push(`${b.id}: "${it.word}" is not spoken while the graphic shows`);
      if (!['split', 'overlay', 'cutaway', 'pip'].includes(b.layout) && !['sticker', 'confetti', 'lowerthird'].includes(gx.component)) warnings.push(`${b.id}: a graphic on a "full" layout covers the speaker — use split, overlay, cutaway or pip`);
    }
    if (b.broll && !existsSync(resolve(base, b.broll.file || ''))) errors.push(`${b.id}: B-roll file missing (${b.broll.file})`);
    if (b.textBehind && !b.textBehind.cutout) warnings.push(`${b.id}: text-behind has no cut-out yet — run cutouts.mjs`);
    if ((b.layout || 'full') !== 'full') changes.push(b.start);
  }
  // craft: pacing, spacing, density
  changes.push(...(plan.captions?.emoji || []).map((e) => e.at), D);
  const cs = [...new Set(changes.map((x) => Math.round(x * 10) / 10))].sort((a, b) => a - b);
  let longest = { len: 0 };
  for (let i = 1; i < cs.length; i++) if (cs[i] - cs[i - 1] > longest.len) longest = { len: cs[i] - cs[i - 1], from: cs[i - 1], to: cs[i] };
  if (style.maxStatic && longest.len > style.maxStatic) warnings.push(`nothing changes on screen for ${longest.len.toFixed(1)} s (${longest.from}–${longest.to}); the style allows ${style.maxStatic} s — add a camera move, a graphic or B-roll`);
  transitions.sort((a, b) => a - b);
  for (let i = 1; i < transitions.length; i++) if (transitions[i] - transitions[i - 1] < (style.transitions?.minGap ?? 0)) warnings.push(`transitions at ${transitions[i - 1]} and ${transitions[i]} are closer than the style's ${style.transitions.minGap} s`);
  const cov = graphicTime / D, [lo, hi] = style.graphics?.coverage || [0, 1];
  const hiddenTime = beats.filter((b) => b.layout === 'cutaway').reduce((s, b) => s + b.end - b.start, 0);
  if (cov < lo) warnings.push(`graphics cover ${(cov * 100).toFixed(0)} % of the video; the style wants ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)} %`);
  if (cov > hi + 0.1) warnings.push(`graphics cover ${(cov * 100).toFixed(0)} % of the video, well over the style's ${(hi * 100).toFixed(0)} % — busy; let some sentences stay on the speaker`);
  if (hiddenTime / D > 0.4) warnings.push(`the speaker is hidden (cutaways) for ${(hiddenTime / D * 100).toFixed(0)} % of the video — viewers connect with a face`);
  const em = (plan.captions?.emoji || []).map((e) => e.at).sort((a, b) => a - b);
  for (let i = 1; i < em.length; i++) if (em[i] - em[i - 1] < (style.captions?.emojiEvery || 0) * 0.8) warnings.push(`emoji at ${em[i - 1]} and ${em[i]} are too close for the style`);
  if (style.hook?.title && !plan.hook?.title && !beats[0]?.textBehind) warnings.push('no hook title — the style opens on one');
  const graphicBeats = beats.filter((b) => b.graphic).length, scenes = beats.filter((b) => b.graphic?.scene).length;
  if (graphicBeats >= 3 && scenes * 3 < graphicBeats) warnings.push(`${scenes} bespoke scene(s) for ${graphicBeats} graphic beats — give the key beats their own (reference/craft.md)`);
  info.push(`${beats.length} beats · ${transitions.length} transitions · graphics ${(cov * 100).toFixed(0)} % · ${scenes} bespoke scene(s) · longest static ${longest.len.toFixed(1)} s · ${(plan.captions?.emphasis || []).length} emphasised words · ${em.length} emoji`);
  return { errors, warnings, info };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, file] = args._;
  if (cmd === 'draft') {
    if (typeof args.work !== 'string' || typeof args.out !== 'string') die('usage: edit-plan.mjs draft --work WORK --out edit.json [--style id] [--sections t1,t2] [--hook "A|B"] [--formats a,b]');
    const secs = typeof args.sections === 'string' ? args.sections.split(',').map(Number).filter(Number.isFinite) : undefined;
    const plan = draft({ work: resolve(args.work), styleId: typeof args.style === 'string' ? args.style : 'dynamic', sections: secs, hook: typeof args.hook === 'string' ? args.hook : undefined, formats: typeof args.formats === 'string' ? args.formats.split(',') : undefined });
    writeJson(args.out, plan);
    const r = check(args.out);
    console.log(`drafted ${plan.beats.length} beats, ${plan.sections.length} sections → ${args.out}\n${r.info.join('\n')}`);
    console.log(`${plan.notes.opportunities.length} graphic opportunities:\n${plan.notes.opportunities.map((o) => `  ${o.at.toFixed(2)}–${o.until.toFixed(2)}s ${o.kind.padEnd(11)} → ${o.suggest}: "${o.text}"`).join('\n')}`);
    if (r.warnings.length) console.log(r.warnings.map((w) => `  ⚠ ${w}`).join('\n'));
  } else if (cmd === 'check') {
    if (!file) die('usage: edit-plan.mjs check edit.json');
    const r = check(file);
    console.log(r.info.join('\n'));
    for (const e of r.errors) console.log(`  ✗ ${e}`);
    for (const w of r.warnings) console.log(`  ⚠ ${w}`);
    console.log(r.errors.length ? `${r.errors.length} error(s)` : 'valid');
    process.exit(r.errors.length ? 1 : 0);
  } else die('usage: edit-plan.mjs draft … | check edit.json');
}
