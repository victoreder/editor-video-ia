// Operações de edição (puras): recebem um EditPlan e devolvem outro.
// Tempos de entrada em segundos do VÍDEO FINAL; aqui são convertidos para âncoras na fonte.
import type {BrollSegment, CaptionChunk, Clip, EditPlan, Overlay, OverlayKind, SfxKind, ZoomBeat} from '../lib/plan/schema';
import {anchorAt, anchorRange, placeClips, projectPoint, projectRange, sampleTransform, srcToTimeline, timelineToSource} from '../lib/plan/timeline';
import {projectedCaptionTimes} from '../lib/modules/captions';
import {styleOf} from '../lib/styles';
import {uid} from '../lib/util/id';

export type ItemKind = 'clip' | 'caption' | 'overlay' | 'broll' | 'zoom' | 'sfx' | 'transition';
export type Selection = {kind: ItemKind; id: string} | null;

export type TimelineItem = {id: string; kind: ItemKind; t0: number; t1: number; label: string; sub?: string};
export type TimelineModel = {duration: number; tracks: {kind: ItemKind; label: string; items: TimelineItem[]}[]};

export function timelineModel(plan: EditPlan): TimelineModel {
  const placed = placeClips(plan.clips, plan.format.fps);
  const duration = placed.at(-1)?.end ?? 0;
  const range = (sourceId: string, a: number, b: number) => projectRange(placed, sourceId, a, b);
  const clips: TimelineItem[] = placed.map((p) => ({id: p.clip.id, kind: 'clip', t0: p.start, t1: p.end, label: p.clip.label ?? `Clipe ${p.index + 1}`, sub: p.clip.speed !== 1 ? `${p.clip.speed}x` : undefined}));
  const capTimes = projectedCaptionTimes(plan).sort((a, b) => a.t0 - b.t0);
  // na timeline, cada bloco termina onde o próximo começa (sem sobreposição visual)
  const captions: TimelineItem[] = capTimes.map(({chunk, t0, t1}, i) => ({id: chunk.id, kind: 'caption', t0, t1: Math.max(t0 + 0.05, Math.min(t1, capTimes[i + 1]?.t0 ?? t1)), label: (chunk.emoji ? `${chunk.emoji} ` : '') + chunk.words.map((w) => w.text).join(' ')}));
  const overlays: TimelineItem[] = plan.overlays.flatMap((o) => {
    const r = range(o.sourceId, o.start, o.end);
    return r ? [{id: o.id, kind: 'overlay' as const, t0: r.start, t1: r.end, label: overlayLabel(o)}] : [];
  });
  const broll: TimelineItem[] = plan.broll.flatMap((b) => {
    const r = range(b.sourceId, b.start, b.end);
    return r ? [{id: b.id, kind: 'broll' as const, t0: r.start, t1: r.end, label: b.asset.kind === 'emoji' ? `${b.asset.emoji ?? '✨'} card` : b.asset.query ?? 'b-roll', sub: b.template}] : [];
  });
  const zoom: TimelineItem[] = plan.camera.beats.flatMap((z) => {
    const r = range(z.sourceId, z.start, z.end);
    return r ? [{id: z.id, kind: 'zoom' as const, t0: r.start, t1: r.end, label: `${z.style} ${z.scale.toFixed(2)}x`}] : [];
  });
  const sfx: TimelineItem[] = plan.audio.sfx.flatMap((s) => {
    const t = projectPoint(placed, s.sourceId, s.at);
    return t === null ? [] : [{id: s.id, kind: 'sfx' as const, t0: t, t1: t + 0.35, label: s.kind}];
  });
  return {
    duration,
    tracks: [
      {kind: 'clip', label: 'Vídeo', items: clips},
      {kind: 'caption', label: 'Legendas', items: captions},
      {kind: 'overlay', label: 'Gráficos', items: overlays},
      {kind: 'broll', label: 'B-roll', items: broll},
      {kind: 'zoom', label: 'Câmera', items: zoom},
      {kind: 'sfx', label: 'Sons', items: sfx},
    ],
  };
}

export function overlayLabel(o: Overlay): string {
  const p = o.props;
  switch (o.kind) {
    case 'stat':
      return `${p.value ?? ''} ${p.label ?? ''}`.trim();
    case 'list':
    case 'chips':
      return (p.items ?? []).join(' · ');
    case 'emoji':
      return p.emoji ?? '🙂';
    default:
      return p.text ?? o.kind;
  }
}

// ---------------------------------------------------------------- mover / redimensionar

/** move/redimensiona um item ancorado para [t0, t1] no vídeo final */
export function retimeItem(plan: EditPlan, kind: ItemKind, id: string, t0: number, t1: number): EditPlan {
  const dur = placeClips(plan.clips, plan.format.fps).at(-1)?.end ?? 0;
  const a = Math.max(0, Math.min(t0, dur - 0.1));
  const b = Math.max(a + 0.1, Math.min(t1, dur));
  if (kind === 'sfx') {
    const at = anchorAt(plan, a);
    if (!at) return plan;
    return {...plan, audio: {...plan.audio, sfx: plan.audio.sfx.map((s) => (s.id === id ? {...s, sourceId: at.sourceId, at: at.srcSec, auto: false} : s))}};
  }
  const r = anchorRange(plan, a, b);
  if (!r) return plan;
  const upd = <T extends {id: string; sourceId: string; start: number; end: number}>(arr: T[]) => arr.map((x) => (x.id === id ? {...x, sourceId: r.sourceId, start: r.start, end: r.end} : x));
  switch (kind) {
    case 'overlay':
      return {...plan, overlays: upd(plan.overlays)};
    case 'broll':
      return {...plan, broll: upd(plan.broll)};
    case 'zoom':
      return {...plan, camera: {beats: upd(plan.camera.beats)}};
    case 'caption':
      return {
        ...plan,
        captions: {
          ...plan.captions,
          chunks: plan.captions.chunks.map((c) => {
            if (c.id !== id) return c;
            // re-distribui as palavras no novo intervalo, mantendo as proporções
            const span = c.end - c.start || 1;
            const k = (r.end - r.start) / span;
            return {...c, sourceId: r.sourceId, start: r.start, end: r.end, words: c.words.map((w) => ({...w, start: r.start + (w.start - c.start) * k, end: r.start + (w.end - c.start) * k}))};
          }),
        },
      };
    default:
      return plan;
  }
}

/** apara um clipe pela borda (dt em segundos do vídeo final) */
export function trimClip(plan: EditPlan, id: string, side: 'in' | 'out', dt: number): EditPlan {
  const src = (sid: string) => plan.sources.find((s) => s.id === sid);
  return {
    ...plan,
    clips: plan.clips.map((c) => {
      if (c.id !== id) return c;
      const dur = src(c.sourceId)?.duration ?? c.outSec;
      const d = dt * (c.speed || 1);
      if (side === 'in') return {...c, inSec: +Math.max(0, Math.min(c.outSec - 0.2, c.inSec + d)).toFixed(3)};
      return {...c, outSec: +Math.min(dur, Math.max(c.inSec + 0.2, c.outSec + d)).toFixed(3)};
    }),
  };
}

export function moveClip(plan: EditPlan, id: string, toIndex: number): EditPlan {
  const i = plan.clips.findIndex((c) => c.id === id);
  if (i < 0) return plan;
  const without = plan.clips.filter((c) => c.id !== id);
  const idx = Math.max(0, Math.min(toIndex, without.length));
  return {...plan, clips: [...without.slice(0, idx), plan.clips[i], ...without.slice(idx)]};
}

/** corta o clipe sob a agulha em dois (S) */
export function splitAt(plan: EditPlan, t: number): {plan: EditPlan; newId?: string} {
  const placed = placeClips(plan.clips, plan.format.fps);
  const hit = timelineToSource(placed, t);
  if (!hit) return {plan};
  const {placed: p, srcSec} = hit;
  const clip = p.clip;
  if (srcSec - clip.inSec < 0.2 || clip.outSec - srcSec < 0.2) return {plan};
  const newId = uid('clip');
  const kfs = clip.transform;
  let aK = kfs?.filter((k) => k.t < srcSec);
  let bK = kfs?.filter((k) => k.t >= srcSec);
  if (kfs?.length) {
    const pin = {t: srcSec, ...sampleTransform(kfs, srcSec)};
    aK = [...(aK ?? []), pin];
    bK = [{...pin}, ...(bK ?? [])];
  }
  const a: Clip = {...clip, outSec: +srcSec.toFixed(3), transform: aK};
  const b: Clip = {...clip, id: newId, inSec: +srcSec.toFixed(3), transform: bK, label: clip.label ? `${clip.label} (2)` : undefined};
  return {plan: {...plan, clips: plan.clips.flatMap((c) => (c.id === clip.id ? [a, b] : [c]))}, newId};
}

export function deleteItem(plan: EditPlan, sel: Selection): EditPlan {
  if (!sel) return plan;
  const id = sel.id;
  switch (sel.kind) {
    case 'clip':
      return {...plan, clips: plan.clips.filter((c) => c.id !== id), transitions: plan.transitions.filter((t) => t.clipId !== id)};
    case 'caption':
      return {...plan, captions: {...plan.captions, chunks: plan.captions.chunks.filter((c) => c.id !== id)}};
    case 'overlay':
      return {...plan, overlays: plan.overlays.filter((o) => o.id !== id)};
    case 'broll':
      return {...plan, broll: plan.broll.filter((b) => b.id !== id)};
    case 'zoom':
      return {...plan, camera: {beats: plan.camera.beats.filter((b) => b.id !== id)}};
    case 'sfx':
      return {...plan, audio: {...plan.audio, sfx: plan.audio.sfx.filter((s) => s.id !== id)}};
    case 'transition':
      return {...plan, transitions: plan.transitions.filter((t) => t.id !== id)};
  }
}

// ---------------------------------------------------------------- adicionar

export function addOverlay(plan: EditPlan, t: number, kind: OverlayKind): {plan: EditPlan; id?: string} {
  const r = anchorRange(plan, t, t + 2.5);
  if (!r) return {plan};
  const DEFAULTS: Partial<Record<OverlayKind, Overlay['props']>> = {
    stat: {value: '100%', label: 'resultado'},
    list: {items: ['Item 1', 'Item 2', 'Item 3']},
    chips: {items: ['Item 1', 'Item 2', 'Item 3']},
    emoji: {emoji: '🔥'},
    quote: {text: 'Uma frase marcante', label: 'Alguém'},
    compare: {items: ['Antes|10', 'Depois|50*']},
    steps: {items: ['Grave', 'Edite', 'Publique']},
    chart: {title: 'Crescimento', items: ['Jan:10', 'Fev:25', 'Mar:60']},
    lowerthird: {text: 'Seu Nome', label: 'Sua função'},
    ui: {title: 'terminal', items: ['$ npm run editar', '[IA] analisando o vídeo…', '✓ reel pronto']},
    confetti: {emoji: '🎉'},
    sticker: {emoji: '😂', text: ''},
    behind: {text: 'UAU'},
  };
  const props: Overlay['props'] = DEFAULTS[kind] ?? {text: 'TEXTO'};
  const layout = kind === 'title' || kind === 'confetti' || kind === 'behind' ? 'full' : kind === 'ui' || kind === 'lowerthird' ? 'top' : 'card';
  const dur = kind === 'behind' ? 1.6 : kind === 'confetti' ? 2 : 2.5;
  const r2 = dur !== 2.5 ? anchorRange(plan, t, t + dur) ?? r : r;
  const o: Overlay = {id: uid('ov'), sourceId: r2.sourceId, start: r2.start, end: r2.end, kind, props, layout};
  return {plan: {...plan, overlays: [...plan.overlays, o]}, id: o.id};
}

export function addBroll(plan: EditPlan, t: number, asset?: Partial<BrollSegment['asset']>, template: BrollSegment['template'] = 'takeover'): {plan: EditPlan; id?: string} {
  const r = anchorRange(plan, t, t + 3);
  if (!r) return {plan};
  const b: BrollSegment = {
    id: uid('br'),
    sourceId: r.sourceId,
    start: r.start,
    end: r.end,
    template,
    asset: {kind: 'video', origin: 'none', alternatives: [], ...asset},
  };
  return {plan: {...plan, broll: [...plan.broll, b]}, id: b.id};
}

export function addZoom(plan: EditPlan, t: number, style: ZoomBeat['style'] = 'punch'): {plan: EditPlan; id?: string} {
  const s = styleOf(plan);
  const r = anchorRange(plan, t, t + (style === 'push' ? 3 : style === 'shake' ? 0.3 : 1.2));
  if (!r) return {plan};
  const z: ZoomBeat = {id: uid('zb'), sourceId: r.sourceId, start: r.start, end: r.end, style, scale: style === 'punch' ? s.camera.punchScale[0] : style === 'push' ? 1 + s.camera.push * 2.5 : 1.04};
  return {plan: {...plan, camera: {beats: [...plan.camera.beats, z]}}, id: z.id};
}

export function addSfx(plan: EditPlan, t: number, kind: SfxKind): {plan: EditPlan; id?: string} {
  const a = anchorAt(plan, t);
  if (!a) return {plan};
  const id = uid('sfx');
  return {plan: {...plan, audio: {...plan.audio, sfx: [...plan.audio.sfx, {id, sourceId: a.sourceId, at: a.srcSec, kind, gainDb: 0, auto: false}]}}, id};
}

// ---------------------------------------------------------------- legendas

/** troca o texto de um bloco: re-tokeniza e distribui o tempo pelas palavras */
export function setCaptionText(plan: EditPlan, id: string, text: string): EditPlan {
  return {
    ...plan,
    captions: {
      ...plan.captions,
      chunks: plan.captions.chunks.map((c) => {
        if (c.id !== id) return c;
        const tokens = text.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return c;
        const accented = new Set(c.words.filter((w) => w.accent).map((w) => w.text.toLowerCase()));
        const weight = (s: string) => Math.max(2, s.length);
        const total = tokens.reduce((n, s) => n + weight(s), 0);
        let t = c.start;
        const span = Math.max(0.2, Math.min(c.end, c.words.at(-1)?.end ?? c.end) - c.start);
        return {
          ...c,
          words: tokens.map((tok) => {
            const d = (span * weight(tok)) / total;
            const w = {text: tok, start: t, end: t + d, accent: accented.has(tok.toLowerCase())};
            t += d;
            return w;
          }),
        };
      }),
    },
  };
}

export const updateCaption = (plan: EditPlan, id: string, patch: Partial<CaptionChunk>): EditPlan => ({
  ...plan,
  captions: {...plan.captions, chunks: plan.captions.chunks.map((c) => (c.id === id ? {...c, ...patch} : c))},
});

export const updateOverlay = (plan: EditPlan, id: string, patch: Partial<Overlay>): EditPlan => ({...plan, overlays: plan.overlays.map((o) => (o.id === id ? {...o, ...patch} : o))});
export const updateBroll = (plan: EditPlan, id: string, patch: Partial<BrollSegment>): EditPlan => ({...plan, broll: plan.broll.map((b) => (b.id === id ? {...b, ...patch} : b))});
export const updateZoom = (plan: EditPlan, id: string, patch: Partial<ZoomBeat>): EditPlan => ({...plan, camera: {beats: plan.camera.beats.map((b) => (b.id === id ? {...b, ...patch} : b))}});
export const updateClip = (plan: EditPlan, id: string, patch: Partial<Clip>): EditPlan => ({...plan, clips: plan.clips.map((c) => (c.id === id ? {...c, ...patch} : c))});

/** instante (vídeo final) onde um item começa — para posicionar a agulha ao selecionar */
export function itemStart(plan: EditPlan, sel: Selection): number | null {
  if (!sel) return null;
  const m = timelineModel(plan);
  for (const tr of m.tracks) for (const it of tr.items) if (it.id === sel.id) return it.t0;
  return null;
}

export {srcToTimeline};

/**
 * Restaura um trecho que o corte automático removeu: volta como clipe, na posição
 * certa (depois do último clipe da mesma fonte que vem antes dele).
 */
export function restoreRange(plan: EditPlan, sourceId: string, start: number, end: number): EditPlan {
  const inSec = Math.max(0, +(start - 0.06).toFixed(3));
  const outSec = +(end + 0.12).toFixed(3);
  const clip: Clip = {id: uid('clip'), sourceId, inSec, outSec, speed: 1, volume: 1, muted: false, baseZoom: 1, label: 'restaurado'};
  let at = plan.clips.length;
  for (let i = 0; i < plan.clips.length; i++) {
    const c = plan.clips[i];
    if (c.sourceId === sourceId && c.inSec >= inSec) {
      at = i;
      break;
    }
  }
  // sobreposição com clipes vizinhos da mesma fonte: aparar para não repetir áudio
  const clips = [...plan.clips.slice(0, at), clip, ...plan.clips.slice(at)].map((c, i, arr) => {
    if (c !== clip) return c;
    const prev = arr[i - 1];
    const next = arr[i + 1];
    return {
      ...c,
      inSec: prev && prev.sourceId === sourceId ? Math.max(c.inSec, prev.outSec) : c.inSec,
      outSec: next && next.sourceId === sourceId ? Math.min(c.outSec, next.inSec) : c.outSec,
    };
  });
  return {
    ...plan,
    clips,
    cutReport: plan.cutReport ? {...plan.cutReport, removed: plan.cutReport.removed.filter((r) => !(r.sourceId === sourceId && r.start === start && r.end === end))} : undefined,
  };
}
