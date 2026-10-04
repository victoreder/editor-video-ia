#!/usr/bin/env node
// An edit plan → a HyperFrames project for one format: the graded A-roll framed on the speaker, the
// camera, layouts, transitions and effects, graphics and B-roll, captions clear of the mouth, the hook,
// the call to action and the progress bar — one paused GSAP timeline. Also writes the sound-effect cues
// every visible event implies.
//
//   node compose.mjs <edit.json> --format vertical|landscape|square|portrait --out <project dir>
//
// Every time in the plan is on the output timeline (the master's). The picture always fills the frame:
// the speaker is scaled to cover it, zooms only go in, and a layout never shows past the recording's
// edge. Captions sit below the lowest point the mouth reaches while they show, and above the apps'
// own buttons. See reference/composition.md for the plan's fields.

import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, symlinkSync, rmSync, lstatSync } from 'node:fs';
import { join, dirname, resolve, basename, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, die, readJson, writeJson, probe, isMain, ASSETS, loadStyle } from './common.mjs';
import { gsapPath } from './engine.mjs';

export const FORMATS = {
  vertical: { W: 1080, H: 1920, safeTop: 0.1, safeBottom: 0.8, caption: 0.735, panel: 0.47 },
  portrait: { W: 1080, H: 1350, safeTop: 0.07, safeBottom: 0.84, caption: 0.78, panel: 0.46 },
  square: { W: 1080, H: 1080, safeTop: 0.06, safeBottom: 0.86, caption: 0.8, panel: 0.45 },
  landscape: { W: 1920, H: 1080, safeTop: 0.06, safeBottom: 0.9, caption: 0.855, panel: 0.5 },
};
const FONT_FILES = { Montserrat: 'montserrat', Inter: 'inter', Anton: 'anton', 'Playfair Display': 'playfair-display', 'JetBrains Mono': 'jetbrains-mono' };

const r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

// ---------------------------------------------------------------- icons

let ICONS = null;
function icon(name, { size = 48, stroke = 2 } = {}) {
  ICONS ||= readJson(join(ASSETS, 'icons', 'lucide.json'));
  const inner = ICONS.icons[name] || ICONS.icons['sparkles'];
  return `<svg width="${Math.round(size)}" height="${Math.round(size)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex:none">${inner}</svg>`;
}

// ---------------------------------------------------------------- the plan's world

export function loadPlan(file) {
  const plan = readJson(file), base = dirname(resolve(file));
  const at = (p) => (p ? (isAbsolute(p) ? p : resolve(base, p)) : null);
  const style = loadStyle(plan.style || 'dynamic', base);
  const tokens = { ...style.palette, ...style.fonts, ...(plan.brand?.accent ? { accent: plan.brand.accent } : {}) };
  if (plan.brand?.font) tokens.display = plan.brand.font;
  tokens.dark = lum(tokens.panel) < 0.3;
  if (!tokens.dark) tokens.text = tokens.ink || '#111827';
  const words = readJson(at(plan.words));
  const chunks = plan.captions?.file ? readJson(at(plan.captions.file)).chunks : [];
  const track = plan.track && existsSync(at(plan.track)) ? readJson(at(plan.track)) : null;
  return { plan, base, at, style, tokens, words, chunks, track };
}

function wordFinder(words) {
  const W = words.map((w) => ({ n: norm(w.text), t: w.start }));
  return (text, from = -Infinity, until = Infinity) => {
    const q = String(text).split(/\s+/).map(norm).filter(Boolean);
    if (!q.length) return null;
    for (let i = 0; i < W.length; i++) {
      if (W[i].t < from - 1e-6 || W[i].t > until) continue;
      if (q.every((k, j) => W[i + j] && (W[i + j].n === k || (j === q.length - 1 && W[i + j].n.startsWith(k))))) return W[i].t;
    }
    return null;
  };
}

// ---------------------------------------------------------------- geometry

function geometry(fmt, src, track, face) {
  const { W, H } = fmt, fs = Math.max(W / src.width, H / src.height), FW = src.width * fs, FH = src.height * fs;
  const pathAt = (t) => {
    if (!track?.path?.length) return { x: face.x, y: face.y };
    const i = clamp(Math.round(t * track.rate), 0, track.path.length - 1);
    return track.path[i];
  };
  const sampleAt = (t) => (track?.samples?.length ? track.samples[clamp(Math.round(t * track.rate), 0, track.samples.length - 1)] : { mouthY: face.mouth, headTop: face.y - (face.mouth - face.y) * 1.6, headW: (face.mouth - face.y) * 2.6 });
  const frameX = (t) => clamp(W / 2 - pathAt(t).x * fs, W - FW, 0);
  const frameY = (t) => clamp(H * 0.42 - pathAt(t).y * fs, H - FH, 0);
  return { W, H, fs, FW, FH, pathAt, sampleAt, frameX, frameY };
}

// The layout transform that puts the full-canvas speaker into a box, covering it, the face near the
// box's upper-middle.
function fitSpeaker(g, box, t, preferred) {
  const fx = g.frameX(t), fy = g.frameY(t), face = g.pathAt(t);
  const kmin = Math.max(box.w / g.FW, box.h / g.FH);
  const k = clamp(preferred, kmin, 1);
  const cx = face.x * g.fs + fx, cy = face.y * g.fs + fy;
  let tx = box.x + box.w / 2 - k * cx, ty = box.y + box.h * 0.42 - k * cy;
  tx = clamp(tx, box.x + box.w - k * (fx + g.FW), box.x - k * fx);
  ty = clamp(ty, box.y + box.h - k * (fy + g.FH), box.y - k * fy);
  return { k: r3(k), x: Math.round(tx), y: Math.round(ty) };
}

function layoutBoxes(fmtName, fmt) {
  const { W, H } = fmt;
  if (fmtName === 'landscape') return { panel: { x: W / 2, y: 0, w: W / 2, h: H }, speakerSplit: { x: 0, y: 0, w: W / 2, h: H }, overlay: { x: W * 0.53, y: H * 0.1, w: W * 0.42, h: H * 0.62 }, pip: { x: W * 0.74, y: H * 0.52, w: W * 0.22, h: W * 0.22 } };
  const ph = Math.round(H * fmt.panel);
  return { panel: { x: 0, y: 0, w: W, h: ph }, speakerSplit: { x: 0, y: ph, w: W, h: H - ph }, overlay: { x: W * 0.05, y: H * (fmt.safeTop + 0.01), w: W * 0.9, h: H * 0.34 }, pip: { x: W * 0.58, y: H * 0.5, w: W * 0.36, h: W * 0.36 } };
}

// ---------------------------------------------------------------- captions

function captionCss(preset, t, fmt, size) {
  if (preset === 'clean') return `.cap .w{font:700 ${size}px/1.15 "${t.body}";color:#fff;padding:2px 6px;text-shadow:0 2px 12px rgba(0,0,0,.65),0 0 2px rgba(0,0,0,.8);}
.cap .w.key{color:#fff;}.cap .w.on{color:${t.accent === '#FFFFFF' ? '#FFD400' : '#fff'};text-decoration:underline;text-decoration-thickness:.12em;text-underline-offset:.18em;text-decoration-color:${t.accent};}`;
  if (preset === 'cinematic') return `.cap .w{font:500 ${size}px/1.2 "${t.body}";color:${t.text};letter-spacing:.02em;padding:0 3px;text-shadow:0 2px 10px rgba(0,0,0,.8);}.cap .w.on,.cap .w.key{color:${t.text};}`;
  return `.cap .w{font:900 ${size}px/1.05 "${t.display}";color:#fff;padding:.04em .2em;border-radius:.2em;-webkit-text-stroke:${Math.round(size * 0.12)}px #000;paint-order:stroke fill;text-transform:uppercase;}
.cap .w.key{color:${t.key};display:inline-block;transform:scale(1.08);}
.cap .w.on{background:${t.accent};color:#fff;-webkit-text-stroke:0;}
.cap .w.on.key{background:${t.key};color:#0A0A18;}`;
}

// ---------------------------------------------------------------- compose

export function compose(planFile, fmtName, outDir) {
  const { plan, at, style, tokens, words, chunks, track } = loadPlan(planFile);
  const fmt = FORMATS[fmtName];
  if (!fmt) die(`unknown format ${fmtName}`);
  const { W, H } = fmt;
  const D = plan.duration, FPS = plan.fps || 25, F = (x) => r3(Math.round(x * FPS) / FPS);
  const src = plan.source, face = plan.face;
  const g = geometry(fmt, src, track, face);
  const boxes = layoutBoxes(fmtName, fmt);
  const wordAt = wordFinder(words);
  const warnings = [], events = [];
  const beats = [...plan.beats].sort((a, b) => a.start - b.start);
  mkdirSync(join(outDir, 'assets'), { recursive: true });
  mkdirSync(join(outDir, 'vendor'), { recursive: true });
  mkdirSync(join(outDir, 'fonts'), { recursive: true });
  const link = (file, name) => { const dst = join(outDir, 'assets', name); try { if (existsSync(dst) || lstatSync(dst)) rmSync(dst); } catch {} symlinkSync(resolve(file), dst); return `assets/${name}`; };
  if (!existsSync(gsapPath())) die(`the rendering engine is not set up — run: node ${join(import.meta.dirname, 'engine.mjs')} setup`);
  copyFileSync(gsapPath(), join(outDir, 'vendor', 'gsap.min.js'));

  // fonts the style uses
  let fontCss = '';
  for (const fam of new Set([tokens.display, tokens.body, tokens.mono])) {
    const key = FONT_FILES[fam]; if (!key) continue;
    for (const w of [400, 500, 600, 700, 800, 900]) {
      const f = join(ASSETS, 'fonts', `${key}-${w}.woff2`);
      if (!existsSync(f)) continue;
      copyFileSync(f, join(outDir, 'fonts', `${key}-${w}.woff2`));
      fontCss += `@font-face{font-family:"${fam}";src:url("fonts/${key}-${w}.woff2") format("woff2");font-weight:${w};font-display:block;}\n`;
    }
  }

  const aroll = link(at(plan.aroll), 'aroll.mp4');
  const faceAvgY = beats.length ? beats.reduce((s, b) => s + g.pathAt((b.start + b.end) / 2).y, 0) / beats.length : face.y;
  const origin = { x: W / 2, y: Math.round(faceAvgY * g.fs + g.frameY(D / 2)) };
  let html = '', css = '', js = '';
  let track_ = 2;
  const clip = (id, cls, t0, t1, inner, style_ = '') => `<div id="${id}" class="${cls} clip" data-start="${F(t0)}" data-duration="${F(Math.max(0.04, t1 - t0))}" data-track-index="${track_++}" style="${style_}">${inner}</div>`;

  // ---- camera: zoom levels per beat, pushes, snaps, shakes
  const camTargets = `['#cam','.cam2']`;
  js += `tl.set(${camTargets},{scale:1,x:0,y:0},0);tl.set('#layout',{scale:1,x:0,y:0},0);`;
  const zoomAt = [];                           // [{t, z}] piecewise, for caption clearance
  const zset = (t, z) => zoomAt.push({ t, z });
  for (const b of beats) {
    const cam = [...(b.camera || [])].sort((x, y) => x.at - y.at);
    cam.forEach((c, i) => { const next = cam[i + 1]; const nextStart = next ? next.at - (next.snap ? 0.04 : 0) : Infinity; if (c.over && c.at + c.over > nextStart) c.over = Math.max(0.04, nextStart - c.at); });
    for (const c of cam) {
      const z = clamp(c.zoom ?? 1, 1, style.camera?.maxZoom ? Math.max(style.camera.maxZoom, 1) : 1.35);
      if (c.to !== undefined && c.over) {
        const z2 = clamp(c.to, 1, 1.4);
        js += `tl.fromTo(${camTargets},{scale:${z}},{scale:${z2},duration:${r3(c.over)},ease:'none'},${F(c.at)});`;
        zset(c.at, z); zset(c.at + c.over, z2);
      } else if (c.snap) { js += `tl.to(${camTargets},{scale:${z},duration:.12,ease:'power3.out'},${F(c.at - 0.04)});`; zset(c.at, z); events.push({ at: c.at, kind: 'snap' }); }
      else { js += `tl.set(${camTargets},{scale:${z}},${F(c.at)});`; zset(c.at, z); }
    }
    for (const e of b.effects || []) {
      if (e.kind === 'shake') js += `tl.to(${camTargets},{x:'+=12',y:'+=7',duration:.04,repeat:5,yoyo:true,ease:'none'},${F(e.at)});tl.set(${camTargets},{x:0,y:0},${F(e.at + 0.25)});`;
      else if (e.kind === 'flash-hit') { js += `tl.fromTo('#flash',{opacity:0},{opacity:.35,duration:.04},${F(e.at)});tl.to('#flash',{opacity:0,duration:.18},${F(e.at + 0.04)});`; events.push({ at: e.at, kind: 'flash-hit' }); }
      else if (e.kind === 'rgb-pulse') js += `tl.set('#cam',{filter:'url(#rgb)'},${F(e.at)});tl.fromTo('#rgb-r',{attr:{dx:0}},{attr:{dx:14},duration:.05,repeat:3,yoyo:true},${F(e.at)});tl.fromTo('#rgb-gb',{attr:{dx:0}},{attr:{dx:-14},duration:.05,repeat:3,yoyo:true},${F(e.at)});tl.set('#cam',{filter:'none'},${F(e.at + 0.22)});`;
    }
  }
  zoomAt.sort((a, b) => a.t - b.t);
  const zoomMaxIn = (t0, t1) => { let z = 1; let cur = 1; for (const p of zoomAt) { if (p.t <= t0) cur = p.z; else if (p.t <= t1) z = Math.max(z, p.z); } return Math.max(z, cur); };

  // ---- tracking: the frame follows the face (holds, then eases)
  let lastX = null;
  for (let t = 0; t <= D; t += 0.5) {
    const x = Math.round(g.frameX(t)), y = Math.round(g.frameY(t));
    if (lastX === null) js += `tl.set('.frame',{x:${x},y:${y}},0);`;
    else if (Math.abs(x - lastX.x) > 1 || Math.abs(y - lastX.y) > 1) js += `tl.to('.frame',{x:${x},y:${y},duration:.5,ease:'sine.inOut'},${F(Math.max(0, t - 0.5))});`;
    lastX = { x, y };
  }

  // ---- layouts, panels and graphics
  // On landscape the speaker's face sits mid-frame, so an overlay goes beside it: on the wider free side
  // at the deepest zoom the span reaches. A beat with no room beside the face becomes a split.
  const besideFace = (t0, t1, minW = W * 0.3) => {
    const z = zoomMaxIn(t0, t1);
    let lo = W, hi = 0;
    for (let t = t0; t <= t1 + 1e-6; t += 0.25) {
      const cx = g.pathAt(t).x * g.fs + g.frameX(t), hw = g.sampleAt(t).headW * g.fs * 0.62;
      lo = Math.min(lo, origin.x + (cx - hw - origin.x) * z); hi = Math.max(hi, origin.x + (cx + hw - origin.x) * z);
    }
    const m = W * 0.03, right = { x: hi + m, w: W - m - (hi + m) }, left = { x: m, w: lo - 2 * m };
    const best = right.w >= left.w ? right : left;
    return best.w >= minW ? { x: Math.round(best.x), y: Math.round(H * 0.1), w: Math.round(best.w), h: Math.round(H * 0.62) } : null;
  };
  const PANEL_BG = `background:${tokens.dark ? `radial-gradient(90% 70% at 20% 10%,color-mix(in srgb,${tokens.accent} 30%,transparent) 0%,transparent 60%),radial-gradient(80% 60% at 90% 90%,color-mix(in srgb,${tokens.c1} 20%,transparent) 0%,transparent 60%),linear-gradient(160deg,${tokens.panel} 0%,${tokens.panel2} 100%)` : `linear-gradient(160deg,${tokens.panel},${tokens.panel2})`};`;
  const overlayBoxes = new Map();
  const joinsPanel = (a, c) => Boolean(a && c && layoutOf(a) === 'split' && layoutOf(c) === 'split' && Math.abs(a.end - c.start) < 0.05
    && (a.graphic || a.broll) && (c.graphic || c.broll) && (a.graphic?.until ?? a.end) >= a.end - 0.05 && (c.graphic?.at ?? c.start) <= c.start + 0.05);
  const layoutOf = (b) => {
    const L = b.layout || 'full';
    if (L !== 'overlay' || fmtName !== 'landscape') return L;
    if (!overlayBoxes.has(b.id)) {
      const side = besideFace(Math.max(b.start, b.graphic?.at ?? b.start), Math.min(b.end, b.graphic?.until ?? b.end));
      overlayBoxes.set(b.id, side);
      if (!side) warnings.push(`${b.id}: no room beside the face for an overlay on ${fmtName} — shown as a split`);
    }
    return overlayBoxes.get(b.id) ? 'overlay' : 'split';
  };
  let prevLayout = 'full';
  const splitPref = fmtName === 'landscape' ? 0.62 : 0.66;
  beats.forEach((b, bi) => {
    const L = layoutOf(b), t0 = b.start, t1 = b.end, mid = (t0 + t1) / 2;
    let target = { k: 1, x: 0, y: 0 }, clipPath = 'inset(0px 0px 0px 0px round 0px)', speakerOpacity = 1;
    if (L === 'split') target = fitSpeaker(g, boxes.speakerSplit, mid, splitPref);
    if (L === 'pip') {
      const bx = boxes.pip, head = g.sampleAt(mid).headW * g.fs;
      target = fitSpeaker(g, bx, mid, clamp(bx.w / (head * 2.2), 0.2, 0.9));
      clipPath = `inset(${Math.round(bx.y)}px ${Math.round(W - bx.x - bx.w)}px ${Math.round(H - bx.y - bx.h)}px ${Math.round(bx.x)}px round ${Math.round(bx.w / 2)}px)`;
    }
    if (L === 'cutaway') speakerOpacity = 0;
    if (L !== prevLayout || bi === 0) {
      const tt = bi === 0 ? 0 : F(t0 - 0.06), dur = bi === 0 ? 0 : 0.4;
      js += `tl.set('#speaker',{zIndex:${L === 'pip' ? 30 : 0}},${tt});tl.to('#pipring',{opacity:${L === 'pip' ? 1 : 0},duration:${dur || 0.01}},${tt});`;
      js += dur ? `tl.to('#layout',{scale:${target.k},x:${target.x},y:${target.y},duration:${dur},ease:'power3.inOut'},${tt});` : `tl.set('#layout',{scale:${target.k},x:${target.x},y:${target.y}},0);`;
      js += dur ? `tl.to('#speaker',{clipPath:'${clipPath}',opacity:${speakerOpacity},duration:${dur},ease:'power3.inOut'},${tt});` : `tl.set('#speaker',{clipPath:'${clipPath}',opacity:${speakerOpacity}},0);`;
      events.push(bi && L !== prevLayout ? { at: t0, kind: 'layout' } : null);
    }
    prevLayout = L;

    // the graphic's container
    const gfx = b.graphic;
    if (!gfx && !b.broll) return;
    const g0 = Math.max(t0, gfx?.at ?? t0), g1 = Math.min(t1, gfx?.until ?? t1);
    let box = L === 'split' ? boxes.panel : L === 'overlay' ? overlayBoxes.get(b.id) || boxes.overlay : { x: 0, y: 0, w: W, h: H };
    const withPanel = L === 'split' || L === 'cutaway' || L === 'pip';
    const id = `g-${b.id}`;
    if (b.broll) {
      const r = b.broll, bid = `br-${b.id}`, file = at(r.file);
      if (!existsSync(file)) warnings.push(`${b.id}: B-roll file missing: ${r.file}`);
      else {
        const isImg = /\.(png|jpe?g|webp)$/i.test(file);
        const rel = link(file, `${b.id}-broll${file.slice(file.lastIndexOf('.'))}`);
        const b0 = Math.max(t0, r.at ?? t0), b1 = Math.min(t1, r.until ?? t1);
        const media = isImg ? `<img src="${rel}" style="width:100%;height:100%;object-fit:cover">` : `<video src="${rel}" muted playsinline data-start="${F(b0)}" data-duration="${F(b1 - b0)}" data-media-start="${r3(r.from ?? 0)}" style="width:100%;height:100%;object-fit:cover"></video>`;
        html += clip(bid, 'broll', b0, b1, `<div class="kb" id="${bid}-kb">${media}</div>`, `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`);
        js += `tl.fromTo('#${bid}',{opacity:0},{opacity:1,duration:.18},${F(b0)});tl.fromTo('#${bid}-kb',{scale:1.02},{scale:1.1,duration:${r3(b1 - b0)},ease:'none'},${F(b0)});`;
        events.push({ at: b0, kind: 'enter' });
      }
    }
    if (!gfx) return;
    const ctx = {
      id, t0: g0, t1: g1, box: { w: Math.round(box.w), h: Math.round(box.h) }, tokens: { ...tokens, displayWeight: style.fonts?.displayWeight ?? 900 },
      word: (text, from = g0 - 0.3) => wordAt(text, Math.max(from, g0 - 0.3), g1), icon, motion: (style.graphics?.motion || ['pop'])[0], fmt: fmtName,
      onPanel: withPanel,
    };
    let part;
    if (gfx.component) {
      const modPath = join(ASSETS, 'components', `${gfx.component}.mjs`);
      if (!existsSync(modPath)) { warnings.push(`${b.id}: unknown component "${gfx.component}"`); return; }
      part = COMPONENTS[gfx.component](gfx.props || {}, ctx);
    } else if (gfx.scene) {
      const file = at(gfx.scene);
      if (!existsSync(file)) { warnings.push(`${b.id}: scene file missing: ${gfx.scene}`); return; }
      // every occurrence of SCENE is the scene's id: #SCENE in selectors, SCENE-name in element ids
      const text = readFileSync(file, 'utf8').replaceAll('SCENE', id);
      const script = (text.match(/<script[^>]*type="text\/scene"[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';
      const styles = (text.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).map((s) => s.replace(/<\/?style[^>]*>/g, '')).join('\n');
      const body = text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
      const wmap = JSON.stringify(Object.fromEntries(words.filter((w) => w.start >= g0 - 0.3 && w.start <= g1).map((w) => [norm(w.text), w.start]).reverse()));
      part = { html: body, css: styles, js: `(function(){const T0=${F(g0)},T1=${F(g1)},box={w:${Math.round(box.w)},h:${Math.round(box.h)}};const at=(s)=>T0+s;const W=${wmap};const word=(x)=>{const k=String(x).toLowerCase().replace(/[^\\p{L}\\p{N}']/gu,'');return W[k]??null;};const $=(s)=>'#${id} '+s;\n${script}\n})();`, events: (gfx.events || []).map((e) => ({ at: e.at, kind: e.kind })) };
    }
    const panelBg = withPanel ? PANEL_BG : '';
    const grid = withPanel && tokens.dark ? `<div class="grid" id="${id}-grid"></div>` : '';
    html += clip(id, `gfx ${withPanel ? 'panel' : ''}`, g0 - (L === 'split' ? 0.06 : 0), g1, `${grid}${part.html}`, `left:${Math.round(box.x)}px;top:${Math.round(box.y)}px;width:${Math.round(box.w)}px;height:${Math.round(box.h)}px;${panelBg}`);
    css += part.css + '\n';
    if (L === 'split') {
      const vertical = fmtName !== 'landscape';
      // two panel beats in a row share one panel: the first's content leaves and the second's arrives,
      // and the panel itself neither closes nor opens again between them
      if (joinsPanel(beats[bi - 1], b)) js += `tl.set('#${id}',{${vertical ? 'y' : 'x'}:0},${F(g0 - 0.06)});`;
      else js += `tl.fromTo('#${id}',{${vertical ? 'y' : 'x'}:${vertical ? -box.h : box.w}},{${vertical ? 'y' : 'x'}:0,duration:.42,ease:'power3.out'},${F(g0 - 0.06)});`;
      if (!joinsPanel(b, beats[bi + 1])) js += `tl.to('#${id}',{${vertical ? 'y' : 'x'}:${vertical ? -box.h : box.w},duration:.3,ease:'power3.in'},${F(g1 - 0.3)});`;
      else js += `tl.to('#${id} > :not(.grid)',{opacity:0,duration:.15},${F(g1 - 0.15)});`;
    } else if (withPanel) js += `tl.fromTo('#${id}',{opacity:0},{opacity:1,duration:.2},${F(g0)});`;
    if (grid) js += `tl.fromTo('#${id}-grid',{x:0,y:0},{x:60,y:60,duration:${r3(Math.max(0.5, g1 - g0))},ease:'none'},${F(g0)});`;
    // a graphic's code runs on its own: if it throws, that graphic is missing, not the whole video
    js += `try{${part.js}}catch(e){console.error('graphic ${b.id} failed: '+(e&&e.message));}`;
    for (const e of part.events || []) events.push(e);
  });

  // ---- text behind the speaker
  const tbCss = [], tbShown = new Set();
  for (const b of beats) {
    const tb = b.textBehind;
    if (!tb) continue;
    const t0 = F(tb.at ?? b.start), t1 = F(tb.until ?? b.end);
    if (!tb.cutout || !existsSync(at(tb.cutout))) { warnings.push(`${b.id}: text-behind needs its cut-out (run cutouts.mjs) — shown as a normal title instead`); }
    const s = g.sampleAt((t0 + t1) / 2), headTop = s.headTop * g.fs + g.frameY((t0 + t1) / 2);
    const zoom = zoomMaxIn(t0, t1), headTopZ = origin.y + (headTop - origin.y) * zoom;
    const chars = String(tb.text).length;
    let cap = Math.min((headTopZ - H * 0.03) / 0.62, (W * 0.9) / Math.max(1, chars * 0.64) * 0.72);
    if (cap < H * 0.055) { warnings.push(`${b.id}: too little room above the head for text behind it (${Math.round(headTopZ)} px) — use a title instead`); continue; }
    const size = Math.round(cap / 0.72), top = Math.round(headTopZ + cap * 0.38 - size * 0.86);
    const tid = `tb-${b.id}`;
    tbShown.add(b.id);
    html += clip(tid, 'tbtext', t0, t1, `<span>${esc(tb.text)}</span>`, `top:${top}px;font-size:${size}px`);
    tbCss.push(tid);
    js += `tl.fromTo('#${tid} span',{opacity:0,scale:1.35,y:40},{opacity:1,scale:1,y:0,duration:.34,ease:'power3.out'},${t0});tl.to('#${tid} span',{opacity:0,duration:.14},${F(t1 - 0.14)});`;
    events.push({ at: t0 + 0.05, kind: 'hook' });
    if (tb.cutout && existsSync(at(tb.cutout))) {
      const rel = link(at(tb.cutout), `${b.id}-cutout.webm`);
      html += `<div class="speaker cut" id="speaker-${b.id}"><div class="layout lay2"><div class="cam cam2"><div class="frame"><video src="${rel}" muted playsinline data-start="${F(tb.cutoutStart ?? t0)}" data-duration="${F((tb.cutoutEnd ?? t1) - (tb.cutoutStart ?? t0))}" data-track-index="${track_++}"></video></div></div></div></div>`;
    }
  }
  if (tbCss.length) css += `.tbtext{position:absolute;left:0;width:${W}px;text-align:center;font-family:"${tokens.display}";font-weight:${style.fonts?.displayWeight ?? 900};line-height:1;letter-spacing:-.02em;white-space:nowrap;}
.tbtext span{display:inline-block;background:linear-gradient(180deg,${tokens.dark ? tokens.panel : '#111827'} 0%,${tokens.accent} 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 16px 40px rgba(0,0,0,.35));}\n`;

  // ---- transitions at beat ends
  beats.forEach((b) => {
    const tr = b.transition;
    if (!tr || tr.kind === 'cut') return;
    const T = F(b.end), d = tr.duration ?? style.transitions?.duration ?? 0.24;
    const k = tr.kind;
    if (k === 'whip' || k === 'slide') {
      const dir = tr.direction === 'right' ? -1 : 1, dist = Math.round(W * (k === 'slide' ? 1 : 0.28)) * dir;
      js += `tl.set('#cam',{filter:'url(#hblur)'},${F(T - d * 0.45)});tl.to('#cam',{x:${-dist},duration:${r3(d * 0.45)},ease:'power2.in'},${F(T - d * 0.45)});tl.to('#hblur-g',{attr:{stdDeviation:'42 0'},duration:${r3(d * 0.45)},ease:'power2.in'},${F(T - d * 0.45)});`;
      js += `tl.set('#cam',{x:${dist}},${T});tl.to('#cam',{x:0,duration:${r3(d * 0.55)},ease:'power3.out'},${T});tl.to('#hblur-g',{attr:{stdDeviation:'0 0'},duration:${r3(d * 0.55)},ease:'power3.out'},${T});tl.set('#cam',{filter:'none'},${F(T + d * 0.55)});`;
    } else if (k === 'zoom') {
      js += `tl.fromTo('#layout',{filter:'blur(0px)'},{filter:'blur(14px)',duration:${r3(d * 0.45)},ease:'power2.in'},${F(T - d * 0.45)});tl.to('#cam',{scale:'*=1.35',duration:${r3(d * 0.45)},ease:'power2.in'},${F(T - d * 0.45)});`;
      js += `tl.set('#cam',{scale:1.3},${T});tl.to('#cam',{scale:1,duration:${r3(d * 0.55)},ease:'power3.out'},${T});tl.to('#layout',{filter:'blur(0px)',duration:${r3(d * 0.55)},ease:'power3.out'},${T});tl.set('#layout',{filter:'none'},${F(T + d * 0.55)});`;
    } else if (k === 'flash') {
      js += `tl.fromTo('#flash',{opacity:0},{opacity:.92,duration:${r3(d * 0.3)},ease:'none'},${F(T - d * 0.3)});tl.to('#flash',{opacity:0,duration:${r3(d * 0.9)},ease:'power2.out'},${T});`;
    } else if (k === 'glitch') {
      js += `tl.set('#cam',{filter:'url(#rgb)'},${F(T - 0.1)});tl.fromTo('#rgb-r',{attr:{dx:0}},{attr:{dx:28},duration:.05,repeat:3,yoyo:true,ease:'none'},${F(T - 0.1)});tl.fromTo('#rgb-gb',{attr:{dx:0}},{attr:{dx:-28},duration:.05,repeat:3,yoyo:true,ease:'none'},${F(T - 0.1)});tl.fromTo('#cam',{x:-18},{x:18,duration:.05,repeat:3,yoyo:true,ease:'none'},${F(T - 0.1)});tl.set('#cam',{x:0,filter:'none'},${F(T + 0.12)});`;
    } else if (k === 'light-leak') {
      js += `tl.fromTo('#leak',{opacity:0,x:${-W * 0.6}},{opacity:.85,x:0,duration:${r3(d * 0.5)},ease:'power2.in'},${F(T - d * 0.5)});tl.to('#leak',{opacity:0,x:${W * 0.5},duration:${r3(d * 0.6)},ease:'power2.out'},${T});`;
    } else if (k === 'dip') {
      js += `tl.fromTo('#dip',{opacity:0},{opacity:1,duration:${r3(d * 0.5)}},${F(T - d * 0.5)});tl.to('#dip',{opacity:0,duration:${r3(d * 0.5)}},${T});`;
    }
    events.push({ at: T, kind: `transition:${k}` });
  });

  // ---- captions
  const cap = style.captions || { preset: 'bold-pop', size: 0.08 };
  const capSize = Math.round(cap.size * Math.min(W, H) * (fmtName === 'landscape' ? 0.85 : 1));
  const emph = new Set((plan.captions?.emphasis || []).map((t) => Math.round(t * 100)));
  const emoji = plan.captions?.emoji || [];
  const hidden = plan.captions?.hide || [];
  const rails = [];
  let capHtml = '';
  const baseClass = (w) => `w${emph.has(Math.round(w.start * 100)) || [...emph].some((e) => Math.abs(e - Math.round(w.start * 100)) <= 6) ? ' key' : ''}`;
  chunks.forEach((c, i) => {
    if (hidden.some(([a, b]) => c.start >= a && c.start < b)) return;
    const beat = beats.find((b) => c.start >= b.start - 1e-6 && c.start < b.end) || beats[beats.length - 1];
    const L = layoutOf(beat);
    let y;
    if (L === 'split' && fmtName !== 'landscape') y = boxes.panel.h + capSize * 0.1;
    else if (L === 'cutaway' || L === 'pip') y = H * (fmtName === 'landscape' ? 0.86 : 0.8);
    else {
      let mouth = 0;
      for (let t = c.start; t <= c.end + 1e-6; t += 0.2) {
        const s = g.sampleAt(t), m = s.mouthY * g.fs + g.frameY(t), z = zoomMaxIn(t, t + 0.2);
        mouth = Math.max(mouth, origin.y + (m - origin.y) * z);
      }
      const clearance = H * 0.045 + capSize * 0.62;
      y = Math.max(H * fmt.caption, mouth + clearance);
      if (y > H * fmt.safeBottom) { warnings.push(`caption ${i} at ${c.start.toFixed(2)}s: the mouth sits low (${Math.round(mouth)} px); caption held at the safe line`); y = H * fmt.safeBottom; }
    }
    const x0 = L === 'split' && fmtName === 'landscape' ? 0 : 0, cw = L === 'split' && fmtName === 'landscape' ? W / 2 : W;
    rails.push({ i, at: c.start, y: Math.round(y), layout: L });
    const em = emoji.find((e) => e.at >= c.start - 0.05 && e.at < c.end);
    const wordsHtml = c.words.map((w, j) => `<span class="${baseClass(w)}" id="c${i}w${j}">${esc(w.text)}</span>`).join('');
    capHtml += `<div class="cap" id="c${i}" style="left:${x0}px;width:${cw}px;top:${Math.round(y - capSize * 0.62)}px"><div class="cap-fit"><div class="cap-in">${wordsHtml}${em ? `<span class="emo" id="c${i}e">${esc(em.char)}</span>` : ''}</div></div></div>`;
    const s0 = F(c.start), s1 = F(c.end);
    js += `tl.set('#c${i}',{opacity:1},${s0});tl.set('#c${i}',{opacity:0},${s1});`;
    if (cap.preset === 'bold-pop') js += `tl.fromTo('#c${i} .cap-in',{scale:.72,y:16},{scale:1,y:0,duration:.16,ease:'back.out(2.2)'},${s0});`;
    else js += `tl.fromTo('#c${i} .cap-in',{opacity:0,y:10},{opacity:1,y:0,duration:.2,ease:'power2.out'},${s0});`;
    if (cap.preset !== 'cinematic') c.words.forEach((w, j) => { js += `tl.set('#c${i}w${j}',{className:'${baseClass(w)} on'},${F(w.start)});tl.set('#c${i}w${j}',{className:'${baseClass(w)}'},${F(w.end)});`; });
    if (em) { js += `tl.fromTo('#c${i}e',{scale:0,rotation:-30},{scale:1,rotation:8,duration:.3,ease:'back.out(3)'},${F(em.at)});`; events.push({ at: em.at, kind: 'emoji' }); }
  });
  css += `.cap{position:absolute;display:flex;justify-content:center;opacity:0;}
.cap-fit{display:flex;justify-content:center;transform-origin:50% 50%;}
.cap-in{display:flex;flex-wrap:nowrap;align-items:center;gap:${Math.round(capSize * 0.2)}px;transform-origin:50% 60%;filter:drop-shadow(0 ${Math.round(capSize * 0.12)}px ${Math.round(capSize * 0.2)}px rgba(0,0,0,.5));}
.emo{display:inline-block;font-size:${Math.round(capSize * 1.05)}px;line-height:1;}
${captionCss(cap.preset, tokens, fmt, capSize)}\n`;

  // ---- hook title, CTA, progress bar
  // the hook leaves before the first beat that puts something where it sits — a panel, an overlay, a
  // picture in picture, a cutaway or B-roll — and is left out when that beat comes too soon to read it
  let hookEnd = plan.hook?.until ?? 1.8;
  const busy = beats.find((b) => (b.layout || 'full') !== 'full' || b.broll);
  if (plan.hook?.title && busy && busy.start < hookEnd) {
    if (busy.start < 0.8) { warnings.push(`hook title left out: ${busy.id} opens its ${busy.layout || 'B-roll'} at ${busy.start}s, too soon to read it`); hookEnd = 0; }
    else { warnings.push(`hook title ends at ${busy.start}s, where ${busy.id} opens its ${busy.layout || 'B-roll'}, not at ${plan.hook.until ?? 1.8}s`); hookEnd = busy.start; }
  }
  // a title behind the speaker on the first beat is the hook; when it had no room, the hook title is
  if (plan.hook?.title && hookEnd > 0 && !tbShown.has(beats[0]?.id)) {
    const hookBox = (fmtName === 'landscape' && besideFace(0.05, hookEnd, W * 0.2)) || boxes.overlay, id = 'hook';
    const lines = String(plan.hook.title).split('|').map((s) => s.trim()).filter(Boolean);
    const part = COMPONENTS.title({ lines: lines.map((text, i) => ({ text, color: i === lines.length - 1 ? 'key' : undefined })), variant: 'slam' }, { id, t0: 0.05, t1: hookEnd, box: { w: Math.round(hookBox.w), h: Math.round(hookBox.h * 0.8) }, tokens: { ...tokens, text: '#FFFFFF', displayWeight: style.fonts?.displayWeight ?? 900 }, word: () => null, icon, motion: 'slam' });
    html += clip(id, 'gfx hookbox', 0, hookEnd, part.html, `left:${Math.round(hookBox.x)}px;top:${Math.round(hookBox.y)}px;width:${Math.round(hookBox.w)}px;height:${Math.round(hookBox.h * 0.8)}px`);
    css += part.css + '\n';
    js += part.js + `tl.to('#hook',{opacity:0,y:-20,duration:.2,ease:'power2.in'},${F(hookEnd - 0.2)});`;
    events.push({ at: 0.1, kind: 'hook' });
  }
  if (plan.cta) {
    const t0 = F(plan.cta.at ?? D - 2.2), size = Math.round(Math.min(W, H) * 0.052);
    // during a panel beat, the call to action takes the panel over as an end card, so it covers neither
    // the speaker nor the captions on the seam; otherwise it sits at the top of the frame
    const ctaBeat = beats.find((b) => t0 >= b.start - 1e-6 && t0 < b.end), overPanel = ctaBeat && layoutOf(ctaBeat) === 'split';
    const pb = boxes.panel;
    const ctaPos = overPanel ? `left:${Math.round(pb.x)}px;top:${Math.round(pb.y)}px;width:${Math.round(pb.w)}px;height:${Math.round(pb.h)}px;align-items:center;${PANEL_BG}`
      : `top:${Math.round(H * (fmtName === 'landscape' ? 0.1 : fmt.safeTop + 0.02))}px`;
    if (overPanel) js += `tl.fromTo('#cta',{opacity:0},{opacity:1,duration:.22,ease:'power2.out'},${t0});`;
    html += clip('cta', 'ctabox', t0, D, `<div class="pill" id="cta-pill"><span class="ic">${icon(plan.cta.icon || 'plus', { size: size * 1.1, stroke: 3 })}</span>${esc(plan.cta.text || 'FOLLOW FOR MORE')}</div>`, ctaPos);
    css += `.ctabox{position:absolute;left:0;width:${W}px;display:flex;justify-content:center;}
.ctabox .pill{display:flex;align-items:center;gap:${size * 0.4}px;padding:${size * 0.45}px ${size * 0.9}px ${size * 0.45}px ${size * 0.45}px;border-radius:999px;background:#fff;color:#0A0A18;font:900 ${size}px/1 "${tokens.display}";box-shadow:0 ${size * 0.3}px 0 color-mix(in srgb,${tokens.accent} 55%,#fff),0 ${size * 0.5}px ${size}px rgba(0,0,0,.4);}
.ctabox .ic{display:flex;width:${size * 1.6}px;height:${size * 1.6}px;border-radius:50%;background:${tokens.accent};color:#fff;align-items:center;justify-content:center;}\n`;
    js += `tl.fromTo('#cta-pill',{scale:.3,y:-40,opacity:0},{scale:1,y:0,opacity:1,duration:.4,ease:'back.out(2.6)'},${t0});tl.to('#cta-pill',{scale:.9,duration:.08,yoyo:true,repeat:1,ease:'power1.inOut'},${F(t0 + 0.8)});`;
    events.push({ at: t0, kind: 'enter' }, { at: t0 + 0.8, kind: 'press' });
  }
  if (plan.progress) {
    html += `<div id="progress"></div>`;
    css += `#progress{position:absolute;left:0;top:0;height:${Math.max(6, Math.round(H * 0.006))}px;width:${W}px;background:linear-gradient(90deg,${tokens.accent},${tokens.c1});transform-origin:0 50%;transform:scaleX(0);}\n`;
    js += `tl.fromTo('#progress',{scaleX:0},{scaleX:1,duration:${r3(D)},ease:'none'},0);`;
  }

  // ---- the page
  const look = plan.grade || style.grade;
  const vignette = look === 'film' ? 0.55 : look === 'punchy' ? 0.28 : 0;
  // film grain: a noise tile the browser draws once, jumped to a new offset twelve times a second — each
  // step moves it by an amount that is not a divisor of the tile, wrapped, so every frame's grain differs
  const grain = look === 'film' ? 0.3 : 0, tile = 240;
  if (grain) js += `tl.to('#grain',{x:${97 * Math.round(D * 12)},y:${61 * Math.round(D * 12)},duration:${r3(D)},ease:'steps(${Math.round(D * 12)})',modifiers:{x:function(v){return (parseFloat(v)%${tile})+'px';},y:function(v){return (parseFloat(v)%${tile})+'px';}}},0);`;
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<style>
${fontCss}
*{box-sizing:border-box;}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${tokens.bg};}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${tokens.bg};font-family:"${tokens.body}",sans-serif;}
.speaker{position:absolute;left:0;top:0;width:${W}px;height:${H}px;}
.layout,.cam{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;}
.cam{transform-origin:${origin.x}px ${origin.y}px;}
.frame{position:absolute;left:0;top:0;width:${Math.round(g.FW)}px;height:${Math.round(g.FH)}px;}
.frame video{width:100%;height:100%;display:block;}
.gfx,.broll{position:absolute;overflow:hidden;}
.gfx.panel{box-shadow:0 0 0 ${Math.max(4, Math.round(Math.min(W, H) * 0.005))}px ${tokens.accent},0 20px 60px rgba(0,0,0,.55);}
.gfx .grid{position:absolute;inset:-60px;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:60px 60px;}
.broll .kb{width:100%;height:100%;}
#flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;}
#dip{position:absolute;inset:0;background:#000;opacity:0;}
#leak{position:absolute;inset:-20%;background:radial-gradient(40% 50% at 30% 40%,rgba(255,176,90,.9),rgba(255,120,60,0) 70%),radial-gradient(35% 45% at 70% 60%,rgba(255,220,150,.7),rgba(255,220,150,0) 70%);mix-blend-mode:screen;opacity:0;}
#pipring{position:absolute;border-radius:50%;border:${Math.round(Math.min(W, H) * 0.008)}px solid ${tokens.accent};box-shadow:0 20px 50px rgba(0,0,0,.5);opacity:0;z-index:31;}
#vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 55%,rgba(0,0,0,${vignette}) 100%);}
#grain{position:absolute;left:-${tile}px;top:-${tile}px;width:${W + tile * 2}px;height:${H + tile * 2}px;pointer-events:none;opacity:${grain};mix-blend-mode:overlay;background-size:${tile}px ${tile}px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='2.4' intercept='-0.7'/%3E%3CfeFuncG type='linear' slope='2.4' intercept='-0.7'/%3E%3CfeFuncB type='linear' slope='2.4' intercept='-0.7'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
${css}
</style></head>
<body>
<svg width="0" height="0" style="position:absolute">
  <filter id="hblur" x="-20%" y="0" width="140%" height="100%"><feGaussianBlur id="hblur-g" in="SourceGraphic" stdDeviation="0 0"/></filter>
  <filter id="rgb" x="-5%" y="-5%" width="110%" height="110%">
    <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/><feOffset id="rgb-r" in="r" dx="0" dy="0" result="r2"/>
    <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb"/><feOffset id="rgb-gb" in="gb" dx="0" dy="0" result="gb2"/>
    <feBlend in="r2" in2="gb2" mode="screen"/>
  </filter>
</svg>
<div id="root" data-composition-id="edit" data-start="0" data-duration="${r3(D)}" data-fps="${FPS}" data-width="${W}" data-height="${H}">
  <div class="speaker" id="speaker"><div class="layout" id="layout"><div class="cam" id="cam"><div class="frame">
    <video id="aroll" src="${aroll}" muted playsinline data-start="0" data-duration="${r3(D)}" data-track-index="1"></video>
  </div></div></div></div>
  ${vignette ? '<div id="vignette"></div>' : ''}
  ${grain ? '<div id="grain"></div>' : ''}
  <div id="pipring" style="left:${Math.round(boxes.pip.x - 6)}px;top:${Math.round(boxes.pip.y - 6)}px;width:${Math.round(boxes.pip.w + 12)}px;height:${Math.round(boxes.pip.h + 12)}px"></div>
  ${html}
  <div id="captions">${capHtml}</div>
  <div id="leak"></div><div id="dip"></div><div id="flash"></div>
</div>
<script src="vendor/gsap.min.js"></script>
<script>
document.fonts.ready.then(function(){
  // captions that would overflow the safe width are scaled to fit, before anything animates
  document.querySelectorAll('.cap').forEach(function(c){ var inner=c.querySelector('.cap-in'), fit=c.querySelector('.cap-fit'); var max=c.clientWidth*${fmtName === 'vertical' ? 0.74 : 0.9}; if(inner.scrollWidth>max) fit.style.transform='scale('+(max/inner.scrollWidth).toFixed(3)+')'; });
  var tl = gsap.timeline({paused:true});
  ${js}
  window.__timelines["edit"] = tl;
});
</script>
</body></html>
`;
  // text-behind cut-outs share the speaker's layout and camera
  const finalPage = page.replace(/tl\.(set|to|fromTo)\('#layout'/g, "tl.$1(['#layout','.lay2']").replace(/tl\.(set|to|fromTo)\('\.frame'/g, "tl.$1('.frame'");
  writeFileSync(join(outDir, 'index.html'), noImmediate(finalPage));
  writeFileSync(join(outDir, 'hyperframes.json'), JSON.stringify({ paths: { assets: 'assets' } }, null, 2) + '\n');
  const report = { format: fmtName, width: W, height: H, fps: FPS, duration: D, origin, fill: r3(g.fs), rails, warnings, events: events.filter(Boolean).sort((a, b) => a.at - b.at) };
  writeJson(join(outDir, 'compose.json'), report);
  return report;
}

// fromTo tweens must not write their start values before they run: a later fromTo on the same element
// would otherwise decide what it looks like at every earlier frame.
function noImmediate(src) {
  let out = '', i = 0;
  for (;;) {
    const k = src.indexOf('tl.fromTo(', i);
    if (k < 0) return out + src.slice(i);
    let j = src.indexOf('{', k), depth = 0;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
    const second = src.indexOf('{', j + 1);
    out += src.slice(i, second + 1) + 'immediateRender:false,';
    i = second + 1;
  }
}

// ---------------------------------------------------------------- components, loaded once

const COMPONENTS = {};
async function loadComponents() {
  const dir = join(ASSETS, 'components');
  for (const f of (await import('node:fs')).readdirSync(dir)) {
    if (!f.endsWith('.mjs') || f.startsWith('_')) continue;
    const m = await import(pathToFileURL(join(dir, f)).href);
    COMPONENTS[basename(f, '.mjs')] = m.render;
  }
}
export async function ready() { if (!Object.keys(COMPONENTS).length) await loadComponents(); }

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file || !args.out) die('usage: compose.mjs <edit.json> --format vertical|landscape|square|portrait --out <project dir>');
  await ready();
  const r = compose(file, typeof args.format === 'string' ? args.format : 'vertical', resolve(args.out));
  console.log(`${r.format} ${r.width}×${r.height} · ${r.events.length} events · ${r.rails.length} caption chunks placed${r.warnings.length ? `\n${r.warnings.map((w) => `  ⚠ ${w}`).join('\n')}` : ''}\n→ ${resolve(args.out)}/index.html`);
}
