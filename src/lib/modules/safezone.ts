// Posicionamento das legendas e cards: nunca em cima do rosto, sempre dentro da
// área segura da plataforma e perto da altura ideal de leitura.
// Portado de ghost-editor/safezone.mjs (MIT): 1) abaixo do queixo → 2) acima da
// cabeça → 3) close-up: o mais baixo possível; histerese para a legenda não "pular".
import type {EditPlan, Platform} from '../plan/schema';
import {cameraAt, faceAt, projectBeats} from '../plan/camera';
import {coverFit, srcToScreen} from '../plan/frame';
import {placeClips, projectRange, timelineToSource} from '../plan/timeline';
import {projectedCaptionTimes} from './captions';

// UI das plataformas em 1080x1920 (px cobertos pelo app)
export const PLATFORMS: Record<Platform, {top: number; bottom: number; right: number; name: string}> = {
  instagram: {top: 220, bottom: 420, right: 130, name: 'Instagram Reels'},
  tiktok: {top: 160, bottom: 480, right: 150, name: 'TikTok'},
  shorts: {top: 140, bottom: 380, right: 140, name: 'YouTube Shorts'},
  all: {top: 220, bottom: 480, right: 150, name: 'Reels + TikTok + Shorts'},
};

export type ScreenFace = {top: number; bottom: number; left: number; right: number}; // px de tela

export function makeFaceProbe(plan: EditPlan) {
  const {width: W, height: H, fps} = plan.format;
  const placed = placeClips(plan.clips, fps);
  const beats = projectBeats(plan, placed);
  const srcById = new Map(plan.sources.map((s) => [s.id, s]));
  return (t: number): ScreenFace | null => {
    const hit = timelineToSource(placed, t);
    if (!hit) return null;
    const src = srcById.get(hit.placed.clip.sourceId);
    const f = faceAt(plan.faceTracks, hit.placed.clip.sourceId, hit.srcSec);
    if (!src || !f) return null;
    const fit = coverFit(src.width, src.height, W, H, f.cx, 0.4);
    const cam = cameraAt(plan, hit.placed, hit.srcSec, t, beats);
    const o = srcToScreen(fit, W, H, cam.originX, cam.originY);
    const ox = o.x * W;
    const oy = o.y * H;
    const map = (x: number, y: number) => {
      const p = srcToScreen(fit, W, H, x, y);
      return {x: ox + cam.scale * (p.x * W - ox), y: oy + cam.scale * (p.y * H - oy)};
    };
    const tl = map(f.cx - f.w / 2, f.cy - f.h / 2);
    const br = map(f.cx + f.w / 2, Math.max(f.chinY, f.cy + f.h / 2));
    return {top: tl.y, bottom: br.y, left: tl.x, right: br.x};
  };
}

export function spanFace(probe: (t: number) => ScreenFace | null, t0: number, t1: number) {
  const r = {top: 1e9, bottom: -1e9, left: 1e9, right: -1e9, seen: false};
  for (let t = t0; t <= t1 + 1e-6; t += 0.1) {
    const f = probe(t);
    if (!f) continue;
    r.seen = true;
    r.top = Math.min(r.top, f.top);
    r.bottom = Math.max(r.bottom, f.bottom);
    r.left = Math.min(r.left, f.left);
    r.right = Math.max(r.right, f.right);
  }
  return r;
}

/** Calcula `y` (% da altura, topo do bloco) de cada legenda. Mantém `y` já definido à mão. */
export type Occupied = {t0: number; t1: number; y0: number; y1: number}; // px de tela

export function placeCaptions(plan: EditPlan, opts: {blockHeightPx?: number; keepManual?: boolean; occupied?: Occupied[]} = {}): EditPlan['captions']['chunks'] {
  const {height: H} = plan.format;
  const k = H / 1920;
  const P = PLATFORMS[plan.platform ?? 'instagram'];
  const safeTop = P.top * k;
  const safeBottom = H - P.bottom * k;
  const h = (opts.blockHeightPx ?? 190) * k;
  const gap = 36 * k;
  const ideal = 1180 * k;
  const probe = makeFaceProbe(plan);
  const timed = new Map(projectedCaptionTimes(plan).map((x) => [x.chunk.id, x]));
  let prev: {mode: string; y: number} | null = null;
  return plan.captions.chunks.map((c) => {
    const tt = timed.get(c.id);
    if (!tt || (opts.keepManual !== false && c.y !== undefined && c.manual)) return c;
    const sp = spanFace(probe, tt.t0, tt.t1);
    const maxY = safeBottom - h;
    const opts2: Record<string, number> = {};
    if (!sp.seen) opts2['no-face'] = Math.min(ideal, maxY);
    else {
      if (sp.bottom + gap <= maxY) opts2.below = Math.max(sp.bottom + gap, Math.min(ideal, maxY));
      if (sp.top - gap - h >= safeTop) opts2.above = sp.top - gap - h;
      opts2['lower-face'] = maxY;
    }
    let mode = prev && opts2[prev.mode] !== undefined && prev.mode !== 'lower-face' ? prev.mode : ['no-face', 'below', 'above', 'lower-face'].find((m) => opts2[m] !== undefined)!;
    let y = opts2[mode];
    // desvia de um card na tela ao mesmo tempo: logo abaixo dele, senão a outra zona
    const clash = (yy: number) => (opts.occupied ?? []).find((o) => tt.t0 < o.t1 && tt.t1 > o.t0 && yy < o.y1 && yy + h > o.y0);
    const c0 = clash(y);
    if (c0) {
      const under = c0.y1 + 24 * k;
      if (under <= maxY && !clash(under)) y = under;
      else {
        const alt = ['above', 'below', 'no-face', 'lower-face'].find((m) => m !== mode && opts2[m] !== undefined && !clash(opts2[m]));
        if (alt) {
          mode = alt;
          y = opts2[alt];
        } else if (c0.y0 - h - 24 * k >= safeTop) y = c0.y0 - h - 24 * k;
      }
    }
    if (prev && prev.mode === mode && !c0 && Math.abs(prev.y - y) < 70 * k) {
      const ok = mode === 'below' ? prev.y >= sp.bottom + gap && prev.y <= maxY : mode === 'above' ? prev.y + h <= sp.top - gap && prev.y >= safeTop : true;
      if (ok) y = prev.y;
    }
    if (!Number.isFinite(y)) {
      mode = 'no-face';
      y = Math.min(ideal, maxY);
    }
    prev = {mode, y};
    return {...c, y: +((y / H) * 100).toFixed(2)};
  });
}

/** posição de um card (overlay/B-roll "card") no intervalo: abaixo do queixo, senão acima da cabeça */
export function placeCard(plan: EditPlan, t0: number, t1: number, hPx: number): {y: number; mode: string} | null {
  const {height: H} = plan.format;
  const k = H / 1920;
  const P = PLATFORMS[plan.platform ?? 'instagram'];
  const safeTop = P.top * k;
  const safeBottom = H - P.bottom * k;
  const h = hPx * k;
  const gap = 36 * k;
  const sp = spanFace(makeFaceProbe(plan), t0, t1);
  const maxY = safeBottom - h;
  if (!sp.seen) return {y: (Math.min(990 * k, maxY) / H) * 100, mode: 'no-face'};
  if (sp.bottom + gap <= maxY) return {y: (Math.max(sp.bottom + gap, Math.min(990 * k, maxY)) / H) * 100, mode: 'below'};
  if (sp.top - gap - h >= safeTop) return {y: ((sp.top - gap - h) / H) * 100, mode: 'above'};
  return null;
}

export const CARD_HEIGHT_PX: Record<string, number> = {stat: 360, list: 440, chips: 220, quote: 420, strike: 260, emoji: 0, title: 0, compare: 400, steps: 440, chart: 520, lowerthird: 0, confetti: 0, ui: 0, sticker: 0, behind: 0, broll: 460};

/** calcula o `y` dos cards (gráficos e B-roll "card") e devolve as áreas ocupadas */
export function placeCards(plan: EditPlan): {plan: EditPlan; occupied: Occupied[]} {
  const {height: H, fps} = plan.format;
  const k = H / 1920;
  const placed = placeClips(plan.clips, fps);
  const occupied: Occupied[] = [];
  const range = (sourceId: string, a: number, b: number) => projectRange(placed, sourceId, a, b);
  const overlays = plan.overlays.map((o) => {
    const r = range(o.sourceId, o.start, o.end);
    if (!r || o.layout !== 'card') return o;
    const hPx = CARD_HEIGHT_PX[o.kind];
    if (!hPx) return o;
    const pos = placeCard(plan, r.start, r.end, hPx);
    const y = pos ? pos.y : 18;
    occupied.push({t0: r.start, t1: r.end, y0: (y / 100) * H, y1: (y / 100) * H + hPx * k});
    return {...o, y: +y.toFixed(2)};
  });
  const broll = plan.broll.map((b) => {
    const r = range(b.sourceId, b.start, b.end);
    if (!r || b.template !== 'card') return b;
    const hPx = CARD_HEIGHT_PX.broll;
    const pos = placeCard(plan, r.start, r.end, hPx);
    const y = pos ? pos.y : 16;
    occupied.push({t0: r.start, t1: r.end, y0: (y / 100) * H, y1: (y / 100) * H + hPx * k});
    return {...b, y: +y.toFixed(2)};
  });
  return {plan: {...plan, overlays, broll}, occupied};
}
