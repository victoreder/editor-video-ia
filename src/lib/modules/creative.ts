// O "plano criativo": tudo que a IA diretora decide sobre o vídeo JÁ CORTADO,
// em segundos do vídeo final (é o que ela "ouve"). Depois `applyCreative`
// ancora cada decisão na fonte e o código aplica as regras mecânicas.
// O mesmo esquema serve para Claude, OpenAI e o diretor heurístico (sem IA).
import {z} from 'zod';
import type {EditPlan, OverlayKind} from '../plan/schema';
import {anchorAt, anchorRange, placeClips, timelineWords, type TimelineWord} from '../plan/timeline';
import {styleOf, type StyleConfig} from '../styles';
import {EMOJI_PT, normWord, wordScore} from './captions';
import {uid} from '../util/id';

export const CreativeSchema = z.object({
  accents: z.array(z.number()).describe('índices das palavras (campo i) que recebem destaque colorido na legenda'),
  emojis: z.array(z.object({word: z.number(), emoji: z.string()})).describe('emoji que aparece junto da legenda da palavra indicada'),
  zoom: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      style: z.enum(['punch', 'push', 'shake']),
      scale: z.number(),
      reason: z.string(),
    }),
  ),
  broll: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      template: z.enum(['card', 'split', 'takeover', 'pip']),
      kind: z.enum(['video', 'image', 'emoji']),
      query: z.string().describe('3 a 5 palavras EM INGLÊS para buscar no banco de vídeos/fotos'),
      emoji: z.string().describe('emoji quando kind = emoji, senão string vazia'),
      caption: z.string().describe('texto curtíssimo opcional (pode ser vazio)'),
      reason: z.string(),
    }),
  ),
  overlays: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      kind: z.enum(['stat', 'list', 'title', 'quote', 'emoji', 'strike', 'chips', 'compare', 'steps', 'chart', 'lowerthird', 'confetti', 'ui', 'behind']),
      value: z.string(),
      label: z.string(),
      title: z.string(),
      items: z.array(z.string()),
      text: z.string(),
      emoji: z.string(),
      reason: z.string(),
    }),
  ),
  transitions: z.array(z.object({at: z.number(), kind: z.enum(['whip', 'zoom', 'flash', 'glitch', 'blur'])})),
  hook: z.string().describe('título do gancho para os 2 primeiros segundos, "LINHA 1|LINHA 2", ou vazio'),
  notes: z.array(z.string()),
});
export type Creative = z.infer<typeof CreativeSchema>;

export const emptyCreative = (): Creative => ({accents: [], emojis: [], zoom: [], broll: [], overlays: [], transitions: [], hook: '', notes: []});

// ---------------------------------------------------------------- diretor heurístico

type Sentence = {words: TimelineWord[]; text: string; start: number; end: number};

export function sentencesOf(words: TimelineWord[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: TimelineWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({words: cur, text: cur.map((w) => w.text).join(' '), start: cur[0].start, end: cur[cur.length - 1].end});
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur.length && w.start - cur[cur.length - 1].end > 0.7) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text) || cur.length >= 22) flush();
  }
  flush();
  return out;
}

const NUM_RE = /(\d[\d.,]*\s*(%|mil|milhões|milhão|bilhões|reais|k|x|horas|dias|anos|minutos)?)|\b(dobro|metade|triplo)\b/i;
const QUERY_PT_EN: Record<string, string> = {
  dinheiro: 'money cash', vendas: 'sales growth chart', clientes: 'happy customers', empresa: 'modern office team',
  negocio: 'small business owner', celular: 'person using smartphone', computador: 'laptop work desk', trabalho: 'people working office',
  tempo: 'clock time lapse', cidade: 'city aerial', ia: 'artificial intelligence technology', inteligencia: 'artificial intelligence technology',
  automacao: 'automation robot arm', dados: 'data dashboard screen', marketing: 'social media marketing', redes: 'social media phone scrolling',
  instagram: 'instagram phone scrolling', video: 'video editing timeline', estudo: 'student studying', academia: 'gym workout',
  seguidores: 'social media followers growth', edicao: 'video editing timeline', legenda: 'subtitles on smartphone screen',
  estrategia: 'strategy planning whiteboard', visualizacoes: 'social media views analytics', conteudo: 'content creator filming',
  comida: 'cooking food', viagem: 'travel landscape', familia: 'family together', saude: 'healthy lifestyle', cafe: 'coffee cup',
  reuniao: 'business meeting', equipe: 'team collaboration', crescimento: 'growth chart rising', sucesso: 'success celebration',
  ideia: 'light bulb idea', foguete: 'rocket launch', mundo: 'earth globe', casa: 'modern house', carro: 'car driving',
};

function brollQuery(s: Sentence): {query: string; emoji: string} | null {
  for (const w of s.words) {
    const n = normWord(w.text);
    // plural/flexão: "vídeos" → video, "clientes" → cliente
    const key = QUERY_PT_EN[n] ? n : Object.keys(QUERY_PT_EN).find((k) => k.length >= 4 && n.startsWith(k) && n.length - k.length <= 2);
    if (key) return {query: QUERY_PT_EN[key], emoji: EMOJI_PT[key] ?? EMOJI_PT[n] ?? ''};
  }
  for (const w of s.words) {
    const n = normWord(w.text);
    if (EMOJI_PT[n]) return {query: '', emoji: EMOJI_PT[n]};
  }
  return null;
}

/** Diretor sem IA: regras de bom gosto dos repos (densidade, variedade, sincronia com a fala). */
export function heuristicCreative(words: TimelineWord[], style: StyleConfig, duration: number): Creative {
  const c = emptyCreative();
  const sents = sentencesOf(words);
  // destaques: deixados para decorateChunks (heurística por bloco)
  // zoom: punch na palavra mais forte, a cada `punchEvery` s; push em frases longas
  let lastPunch = -99;
  sents.forEach((s, i) => {
    const len = s.end - s.start;
    let best: TimelineWord | null = null;
    let bs = 0;
    s.words.forEach((w, k) => {
      const sc = wordScore(w.text, k);
      if (sc > bs) {
        bs = sc;
        best = w;
      }
    });
    const b = best as TimelineWord | null;
    if (b && bs >= 6 && b.start - lastPunch >= style.camera.punchEvery) {
      const [lo, hi] = style.camera.punchScale;
      c.zoom.push({start: Math.max(0, b.start - 0.05), end: Math.min(s.end + 0.2, b.start + 1.4), style: 'punch', scale: +(lo + ((i * 7) % 5) / 4 * (hi - lo)).toFixed(2), reason: `ênfase em "${b.text}"`});
      lastPunch = b.start;
      if (style.camera.shake && bs >= 9) c.zoom.push({start: b.start, end: b.start + 0.3, style: 'shake', scale: 1.04, reason: 'impacto no número'});
    } else if (len > 4.5 && style.camera.push > 0) {
      c.zoom.push({start: s.start, end: s.end, style: 'push', scale: +(1 + style.camera.push * 2.5).toFixed(2), reason: 'trecho longo: slow push'});
    }
  });

  // gráficos: número → stat, lista → list, "não é" → strike
  const perMin = (n: number) => Math.max(1, Math.round((duration / 60) * n));
  const maxGraphics = perMin(style.graphics.perMinute);
  const busy: Array<[number, number]> = [];
  const free = (a: number, b: number, pad = 1.2) => busy.every(([x, y]) => b + pad <= x || a >= y + pad);
  for (const s of sents) {
    if (c.overlays.length >= maxGraphics) break;
    if (s.start < 1.5 || s.end > duration - Math.min(2, duration * 0.08)) continue;
    // o número mais "forte" da frase: %, R$, x, mil… antes de números soltos
    const nums = [...s.text.matchAll(new RegExp(NUM_RE.source, 'gi'))];
    const m = nums.sort((a, b) => Number(/%|R\$|x|mil|milh/i.test(b[0])) - Number(/%|R\$|x|mil|milh/i.test(a[0])))[0] ?? null;
    const end = Math.min(s.end + 0.4, s.start + 4);
    const base = {label: '', title: '', items: [] as string[], text: '', emoji: '', value: ''};
    if (m && free(s.start, end)) {
      const digits = m[0].match(/\d+/)?.[0] ?? '';
      const numWord = s.words.find((w) => digits && w.text.includes(digits)) ?? s.words.find((w) => /\d/.test(w.text)) ?? s.words[0];
      // rótulo: as palavras da frase sem o número e sem a unidade dele
      const inMatch = new Set(nums.flatMap((x) => x[0].toLowerCase().split(/\s+/)).map((x) => x.replace(/[^\p{L}\p{N}%$]/gu, '')));
      const label = s.words
        .filter((w) => w !== numWord && !inMatch.has(w.text.toLowerCase().replace(/[^\p{L}\p{N}%$]/gu, '')) && !/\d/.test(w.text))
        .slice(-4)
        .map((w) => w.text.replace(/[.,!?]$/, ''))
        .join(' ');
      c.overlays.push({...base, start: numWord.start - 0.1, end, kind: 'stat', value: m[0].trim().toUpperCase(), label, reason: 'número dito em voz alta'});
      busy.push([numWord.start, end]);
    } else if ((s.text.match(/,/g) ?? []).length >= 2 && free(s.start, end)) {
      const items = s.text.split(',').map((x) => x.trim().split(/\s+/).slice(-3).join(' ').replace(/[.!?]$/, '')).filter(Boolean).slice(0, 4);
      c.overlays.push({...base, start: s.start, end, kind: 'list', items, reason: 'lista falada'});
      busy.push([s.start, end]);
    } else if (/\b(antes|versus|vs\.?|em vez de|comparado|do que)\b/i.test(s.text) && /\b(depois|agora|hoje|melhor|pior|mais|menos)\b/i.test(s.text) && free(s.start, end)) {
      // comparação: "antes X, depois Y" → dois cartões
      const parts = s.text.split(/,|\b(?:depois|agora|versus|vs\.?|em vez de)\b/i).map((x) => x.trim().split(/\s+/).slice(-3).join(' ').replace(/[.!?]$/, '')).filter(Boolean);
      if (parts.length >= 2) {
        c.overlays.push({...base, start: s.start, end, kind: 'compare', items: [`Antes|${parts[0]}`, `Depois|${parts[1]}*`], reason: 'contraste falado'});
        busy.push([s.start, end]);
      }
    } else if (/\b(primeiro|segundo|terceiro|passo|depois disso|por fim|finalmente)\b/i.test(s.text) && free(s.start, end)) {
      // processo: os passos que a pessoa enumera (até 3, com as palavras de cada trecho)
      const items = s.text.split(/\b(?:primeiro|segundo|terceiro|depois disso|por fim|finalmente)\b,?/i).map((x) => x.trim().split(/\s+/).slice(0, 3).join(' ').replace(/[.,!?]$/, '')).filter((x) => x.length > 1).slice(0, 3);
      if (items.length >= 2) {
        c.overlays.push({...base, start: s.start, end, kind: 'steps', items, reason: 'processo em passos'});
        busy.push([s.start, end]);
      }
    } else if (/\bn[ãa]o (é|são|foi)\b/i.test(s.text) && free(s.start, end)) {
      const after = s.text.split(/n[ãa]o (?:é|são|foi)/i)[1]?.trim().split(/\s+/).slice(0, 3).join(' ') ?? '';
      if (after) {
        c.overlays.push({...base, start: s.start, end, kind: 'strike', text: after.replace(/[.,!?]$/, '').toUpperCase(), reason: 'mito negado'});
        busy.push([s.start, end]);
      }
    }
  }

  // texto atrás da pessoa: a palavra mais forte do vídeo (estilos com gancho), 1 por vídeo
  if (style.hook) {
    let best: TimelineWord | null = null;
    let bs = 0;
    for (const w of words) {
      if (w.start < 1.5 || w.start > duration * 0.7) continue;
      const sc = wordScore(w.text, 1);
      if (sc >= 7 && sc > bs && free(w.start - 0.1, w.start + 1.6, 0.6)) {
        bs = sc;
        best = w;
      }
    }
    const b = best as TimelineWord | null;
    if (b) {
      const text = b.text.replace(/[^\p{L}\p{N}%$]/gu, '').toUpperCase();
      c.overlays.push({label: '', title: '', items: [], emoji: '', value: '', start: b.start - 0.05, end: b.start + 1.6, kind: 'behind', text, reason: 'palavra mais forte, atrás da pessoa'});
      busy.push([b.start, b.start + 1.6]);
    }
  }

  // B-roll: frases com conceito visual, alternando templates, sem colidir com gráficos
  const maxBroll = perMin(style.broll.perMinute);
  let ti = 0;
  for (const s of sents) {
    if (c.broll.length >= maxBroll) break;
    if (s.start < 0.8 || s.end > duration - Math.min(3, duration * 0.12)) continue;
    const q = brollQuery(s);
    if (!q) continue;
    const len = Math.min(4.2, Math.max(2.2, s.end - s.start));
    const a = s.start + 0.1;
    const b = Math.min(duration - Math.min(2.5, duration * 0.08), a + len);
    if (!free(a, b, 1.5)) continue;
    // B-roll = cena ilustrativa em tela cheia (sai o apresentador, entra a cena); sem emoji
    if (!q.query) continue;
    ti++;
    c.broll.push({start: a, end: b, template: 'takeover', kind: 'video', query: q.query, emoji: '', caption: '', reason: 'conceito visual na fala'});
    busy.push([a, b]);
  }

  // gancho: primeira frase vira título (se o estilo usar)
  if (style.hook && sents[0]) {
    const ws = sents[0].words.map((w) => w.text.replace(/[.,!?]$/, '').toUpperCase());
    const half = Math.ceil(Math.min(ws.length, 7) / 2);
    c.hook = ws.length >= 3 ? `${ws.slice(0, half).join(' ')}|${ws.slice(half, 7).join(' ')}` : '';
  }
  c.notes.push(`diretor heurístico: ${c.zoom.length} zooms, ${c.overlays.length} gráficos, ${c.broll.length} B-rolls`);
  return c;
}

// ---------------------------------------------------------------- aplicar

/** nível de zoom por clipe: um enquadramento diferente a cada corte (esconde o jump cut) */
export function assignClipZoom(clips: EditPlan['clips'], style: StyleConfig): EditPlan['clips'] {
  const lv = style.camera.levels;
  return clips.map((c, i) => ({...c, baseZoom: lv[i % lv.length]}));
}

/** transições nos cortes mais próximos de cada pedido, respeitando o espaçamento do estilo */
export function placeTransitions(plan: Pick<EditPlan, 'clips' | 'format'>, wanted: Creative['transitions'], style: StyleConfig): EditPlan['transitions'] {
  if (!style.transitions.set.length || style.transitions.set[0] === 'cut') return [];
  const placed = placeClips(plan.clips, plan.format.fps);
  const cuts = placed.slice(1);
  const out: EditPlan['transitions'] = [];
  let last = -99;
  const req = wanted.length
    ? wanted
    : // sem pedido: uma transição a cada ~minGap segundos, nos cortes
      cuts.filter((_, i) => i % 3 === 2).map((p, i) => ({at: p.start, kind: style.transitions.set[i % style.transitions.set.length] as Creative['transitions'][number]['kind']}));
  for (const r of req.sort((a, b) => a.at - b.at)) {
    const near = cuts.reduce<(typeof cuts)[number] | null>((best, p) => (!best || Math.abs(p.start - r.at) < Math.abs(best.start - r.at) ? p : best), null);
    if (!near || Math.abs(near.start - r.at) > 1.5 || near.start - last < style.transitions.minGap) continue;
    if (out.some((t) => t.clipId === near.clip.id)) continue;
    out.push({id: uid('tr'), clipId: near.clip.id, kind: style.transitions.set.includes(r.kind) ? r.kind : style.transitions.set[0], duration: style.transitions.duration});
    last = near.start;
  }
  return out;
}

/**
 * Regra mecânica do kamgasimo ("maxStatic"): nada pode ficar parado na tela por
 * mais de N segundos. Onde não há corte, zoom, gráfico nem B-roll, entra um slow push.
 */
export function fillStatic(creative: Creative, cuts: number[], duration: number, style: StyleConfig): Creative['zoom'] {
  const marks = new Set<number>([0, duration, ...cuts]);
  for (const z of creative.zoom) {
    marks.add(z.start);
    if (z.style === 'push') for (let t = z.start; t < z.end; t += 1) marks.add(t); // push é movimento contínuo
  }
  for (const x of [...creative.overlays, ...creative.broll]) {
    marks.add(x.start);
    marks.add(x.end);
  }
  const pts = [...marks].filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b);
  const extra: Creative['zoom'] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b - a <= style.maxStatic) continue;
    const scale = +(1 + Math.max(0.04, style.camera.push * 2)).toFixed(2);
    extra.push({start: a + 0.2, end: b - 0.1, style: 'push', scale, reason: `nada mudava por ${(b - a).toFixed(1)} s`});
  }
  return extra;
}

/** Ancora o plano criativo na fonte e preenche o EditPlan. */
export function applyCreative(plan: EditPlan, creative: Creative): EditPlan {
  const style = styleOf(plan);
  const tw = timelineWords(plan);
  const placedAll = placeClips(plan.clips, plan.format.fps);
  const duration = placedAll.at(-1)?.end ?? 0;
  creative = {...creative, zoom: [...creative.zoom, ...fillStatic(creative, placedAll.slice(1).map((p) => p.start), duration, style)]};
  const clampT = (t: number) => Math.max(0, Math.min(duration - 0.05, t));

  const beats: EditPlan['camera']['beats'] = [];
  for (const z of creative.zoom) {
    const r = anchorRange(plan, clampT(z.start), clampT(Math.max(z.end, z.start + 0.3)));
    if (!r) continue;
    const scale = Math.min(style.camera.maxZoom, Math.max(1, z.scale));
    beats.push({id: uid('zb'), sourceId: r.sourceId, start: r.start, end: r.end, style: z.style, scale, reason: z.reason});
  }

  const overlays: EditPlan['overlays'] = [];
  for (const o of creative.overlays) {
    if (o.kind === 'emoji') continue; // sem emojis: só cenas, ilustrações e animações
    const r = anchorRange(plan, clampT(o.start), clampT(Math.max(o.end, o.start + 1.2)));
    if (!r) continue;
    const props: EditPlan['overlays'][number]['props'] = {};
    if (o.value) props.value = o.value;
    if (o.label) props.label = o.label;
    if (o.title) props.title = o.title;
    if (o.items?.length) props.items = o.items.slice(0, 5);
    if (o.text) props.text = o.text;
    const layout = o.kind === 'title' || o.kind === 'confetti' || o.kind === 'behind' ? 'full' : o.kind === 'ui' || o.kind === 'lowerthird' ? 'top' : 'card';
    overlays.push({id: uid('ov'), sourceId: r.sourceId, start: r.start, end: r.end, kind: o.kind as OverlayKind, props, layout, reason: o.reason});
  }

  const broll: EditPlan['broll'] = [];
  for (const b of creative.broll) {
    if (b.kind === 'emoji' || !b.query) continue; // B-roll é cena (vídeo) ou ilustração (imagem)
    const r = anchorRange(plan, clampT(b.start), clampT(Math.max(b.end, b.start + 1.5)));
    if (!r) continue;
    broll.push({
      id: uid('br'),
      sourceId: r.sourceId,
      start: r.start,
      end: r.end,
      template: 'takeover', // tela cheia: sai o apresentador, entra a cena
      asset: {kind: b.kind, query: b.query, origin: 'none', alternatives: []},
      caption: b.caption || undefined,
      reason: b.reason,
    });
  }

  // destaques e emojis vindos da IA (índices das palavras do vídeo cortado)
  let chunks = plan.captions.chunks;
  if (creative.accents.length || creative.emojis.length) {
    const acc = new Set(creative.accents.map((i) => tw[i]).filter(Boolean).map((w) => `${w.sourceId}@${w.srcStart}`));
    chunks = chunks.map((c) => {
      const words = c.words.map((w) => {
        const key = `${c.sourceId}@${w.start}`;
        return {...w, accent: acc.has(key)};
      });
      return {...c, words, emoji: undefined};
    });
  }

  const clips = assignClipZoom(plan.clips, style);
  const next: EditPlan = {
    ...plan,
    clips,
    camera: {beats},
    overlays,
    broll,
    captions: {...plan.captions, chunks},
    hook: creative.hook && style.hook ? {title: creative.hook, until: 2} : undefined,
    outro: style.cta ? {title: style.cta, duration: 1.6} : undefined,
    progressBar: style.progress,
    grade: {...plan.grade, look: 'none'}, // cor original; filtro só se escolhido à mão
    meta: {...plan.meta, notes: [...creative.notes]},
  };
  next.transitions = placeTransitions(next, creative.transitions, style);
  return next;
}

export {anchorAt};
