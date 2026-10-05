// Fase 3 — edição por chat: "deixa a legenda maior", "tira o B-roll do começo",
// "coloca um número 87% quando eu falo do resultado"…
// A IA recebe um resumo do plano (itens com id e tempo) e devolve OPERAÇÕES;
// o código aplica cada uma com as mesmas funções do editor (nada de JSON solto).
// Inspirado no servidor MCP do autobroll (mcp/server.mjs, MIT).
import {z} from 'zod';
import type {EditPlan, OverlayKind, SfxKind} from '../plan/schema';
import {addBroll, addOverlay, addSfx, addZoom, cutRange, deleteItem, retimeItem, setCaptionText, splitAt, timelineModel, updateCaption, updateClip, updateOverlay, type ItemKind} from '../../editor/ops';
import {STYLE_LIST} from '../styles';

export const OpSchema = z.object({
  op: z.enum([
    'set_caption_text', 'accent_word', 'caption_preset', 'caption_scale',
    'add_overlay', 'update_overlay', 'remove', 'retime',
    'add_broll', 'add_zoom', 'add_sfx', 'split', 'clip_speed',
    'set_style', 'set_hook', 'set_outro', 'music_volume', 'sfx_volume', 'progress_bar',
    'cut_range', 'caption_position', 'set_grade',
  ]),
  id: z.string().describe('id do item (para set_caption_text, accent_word, update_overlay, remove, retime, clip_speed); senão vazio'),
  start: z.number().describe('segundos do vídeo final (quando a operação precisa de tempo); senão 0'),
  end: z.number().describe('fim em segundos do vídeo final; senão 0'),
  kind: z.string().describe('add_overlay: stat|list|title|quote|strike|chips|compare|steps|chart|lowerthird|confetti|ui|behind|keyword (text = 1 a 3 palavras-chave gigantes na tela); add_zoom: punch|push|shake; add_sfx: whoosh|pop|impact|…; add_broll: takeover (padrão)|split|pip|card; set_grade: none|clean|punchy|film; caption_preset: bold-pop|karaoke|pill|editorial|clean'),
  text: z.string().describe('texto (legenda, título, gancho, CTA, citação, palavra a destacar, busca do B-roll em inglês, id do estilo)'),
  value: z.string().describe('stat: valor (ex.: 87%); senão vazio'),
  label: z.string(),
  items: z.array(z.string()),
  emoji: z.string(),
  number: z.number().describe('escala, velocidade, volume (0–1), multiplicador de tamanho ou, em caption_position, a altura do topo da legenda em % (40–72); senão 0'),
});
export type Op = z.infer<typeof OpSchema>;
export const ChatEditSchema = z.object({reply: z.string().describe('resposta curta em português dizendo o que foi feito'), ops: z.array(OpSchema)});

export function planSummary(plan: EditPlan): string {
  const m = timelineModel(plan);
  const lines = [`duração ${m.duration.toFixed(1)} s · estilo ${plan.style} · legenda ${plan.captions.preset} · gancho "${plan.hook?.title ?? ''}" · CTA "${plan.outro?.title ?? ''}" · música ${plan.audio.music ? `volume ${plan.audio.music.volume}` : 'nenhuma'}`];
  for (const tr of m.tracks) {
    lines.push(`\n[${tr.label}]`);
    for (const it of tr.items) lines.push(`${it.id} ${it.t0.toFixed(2)}–${it.t1.toFixed(2)} ${it.label}${it.sub ? ` (${it.sub})` : ''}`);
  }
  return lines.join('\n');
}

export const CHAT_SYSTEM = `Você edita vídeos curtos dentro de um editor. O usuário pede mudanças em português; você responde com OPERAÇÕES sobre o plano de edição.
- Use os ids e tempos do resumo (tempos em segundos do vídeo final). "No começo" ≈ 0–3 s; "no fim" ≈ últimos 3 s.
- Para "quando eu falo X", ache a legenda com X no resumo e use o tempo dela.
- Prefira poucas operações certeiras. Se o pedido não for possível, explique na resposta e devolva ops vazio.
- Estilos disponíveis: ${STYLE_LIST.map((s) => s.id).join(', ')} (ou ids "custom_…" de estilos próprios).
- Preencha todos os campos de cada operação; use "" / 0 / [] quando não se aplicam.
- "Tira/corta a parte em que eu falo X": ache as legendas desse trecho e use cut_range com start = início da primeira e end = fim da última (corta o vídeo e junta).
- "Sobe/desce a legenda": caption_position com number = altura do topo em % (padrão 64; mais alto = número menor; nunca acima de 72, por causa da interface do Reels).
- Filtro/cor: set_grade com kind none (original, padrão) | clean | punchy | film.
- B-roll é sempre uma cena em tela cheia (add_broll com kind "takeover" e text = busca em inglês da cena). Não use emojis.
- Se alguma parte do pedido não tiver operação correspondente, diga isso claramente na resposta.`;

const kindOfId = (plan: EditPlan, id: string): ItemKind | null => {
  for (const tr of timelineModel(plan).tracks) if (tr.items.some((i) => i.id === id)) return tr.kind;
  if (plan.transitions.some((t) => t.id === id)) return 'transition';
  return null;
};

/** aplica as operações em ordem; ignora as inválidas e conta o que deu certo */
export function applyOps(plan: EditPlan, ops: Op[]): {plan: EditPlan; applied: number; skipped: string[]} {
  let p = plan;
  let applied = 0;
  const skipped: string[] = [];
  const t = (x: number) => Math.max(0, x || 0);
  for (const op of ops) {
    const before = p;
    try {
      switch (op.op) {
        case 'set_caption_text':
          p = setCaptionText(p, op.id, op.text);
          break;
        case 'accent_word': {
          const c = p.captions.chunks.find((x) => x.id === op.id) ?? p.captions.chunks.find((x) => x.words.some((w) => w.text.toLowerCase() === op.text.toLowerCase()));
          if (c) p = updateCaption(p, c.id, {words: c.words.map((w) => (w.text.toLowerCase() === op.text.toLowerCase() ? {...w, accent: !w.accent} : w))});
          break;
        }
        case 'caption_preset':
          if (['bold-pop', 'karaoke', 'pill', 'editorial', 'clean'].includes(op.kind)) p = {...p, captions: {...p.captions, preset: op.kind as EditPlan['captions']['preset']}};
          break;
        case 'caption_scale':
          p = {...p, captions: {...p.captions, chunks: p.captions.chunks.map((c) => ({...c, scale: Math.max(0.5, Math.min(1.8, (c.scale ?? 1) * (op.number || 1)))}))}};
          break;
        case 'add_overlay': {
          const r = addOverlay(p, t(op.start), (op.kind || 'title') as OverlayKind);
          if (!r.id) break;
          p = r.plan;
          const props: Record<string, unknown> = {};
          for (const k of ['text', 'value', 'label', 'emoji'] as const) if (op[k]) props[k] = op[k];
          if (op.items.length) props.items = op.items;
          p = updateOverlay(p, r.id, {props: {...p.overlays.find((o) => o.id === r.id)!.props, ...props}});
          if (op.end > op.start) p = retimeItem(p, 'overlay', r.id, t(op.start), op.end);
          break;
        }
        case 'update_overlay': {
          const o = p.overlays.find((x) => x.id === op.id);
          if (!o) break;
          const props = {...o.props};
          for (const k of ['text', 'value', 'label', 'emoji'] as const) if (op[k]) props[k] = op[k];
          if (op.items.length) props.items = op.items;
          p = updateOverlay(p, o.id, {props});
          break;
        }
        case 'remove': {
          const kind = kindOfId(p, op.id);
          if (kind) p = deleteItem(p, {kind, id: op.id});
          break;
        }
        case 'retime': {
          const kind = kindOfId(p, op.id);
          if (kind && kind !== 'clip' && op.end > op.start) p = retimeItem(p, kind, op.id, t(op.start), op.end);
          break;
        }
        case 'add_broll': {
          // B-roll = cena em tela cheia (só muda se a pessoa pedir outro formato); sem emoji
          if (!op.text) break;
          const template = (['card', 'split', 'takeover', 'pip'].includes(op.kind) ? op.kind : 'takeover') as 'card' | 'split' | 'takeover' | 'pip';
          const r = addBroll(p, t(op.start), {kind: 'video', query: op.text, origin: 'none', alternatives: []}, template);
          p = r.plan;
          if (r.id && op.end > op.start) p = retimeItem(p, 'broll', r.id, t(op.start), op.end);
          break;
        }
        case 'add_zoom': {
          const r = addZoom(p, t(op.start), (['punch', 'push', 'shake'].includes(op.kind) ? op.kind : 'punch') as 'punch' | 'push' | 'shake');
          p = r.plan;
          if (r.id && op.number >= 1) p = {...p, camera: {beats: p.camera.beats.map((b) => (b.id === r.id ? {...b, scale: Math.min(1.6, op.number)} : b))}};
          if (r.id && op.end > op.start) p = retimeItem(p, 'zoom', r.id, t(op.start), op.end);
          break;
        }
        case 'add_sfx':
          p = addSfx(p, t(op.start), (op.kind || 'whoosh') as SfxKind).plan;
          break;
        case 'split':
          p = splitAt(p, t(op.start)).plan;
          break;
        case 'clip_speed':
          if (op.number > 0) p = updateClip(p, op.id, {speed: Math.max(0.25, Math.min(3, op.number))});
          break;
        case 'set_style':
          p = {...p, style: op.text || p.style};
          break;
        case 'set_hook':
          p = {...p, hook: op.text ? {title: op.text, until: p.hook?.until ?? 2} : undefined};
          break;
        case 'set_outro':
          p = {...p, outro: op.text ? {title: op.text, duration: p.outro?.duration ?? 1.6} : undefined};
          break;
        case 'music_volume':
          if (p.audio.music) p = {...p, audio: {...p.audio, music: {...p.audio.music, volume: Math.max(0, Math.min(0.8, op.number))}}};
          break;
        case 'sfx_volume':
          p = {...p, audio: {...p.audio, sfxVolume: Math.max(0, Math.min(1.5, op.number))}};
          break;
        case 'progress_bar':
          p = {...p, progressBar: op.number > 0};
          break;
        case 'cut_range':
          p = cutRange(p, t(op.start), op.end);
          break;
        case 'caption_position': {
          // todas as legendas (ou só a do id) na altura pedida, marcadas como manuais
          const y = Math.max(15, Math.min(72, op.number));
          p = {...p, captions: {...p.captions, chunks: p.captions.chunks.map((c) => (!op.id || c.id === op.id ? {...c, y, manual: true} : c))}};
          break;
        }
        case 'set_grade': {
          const look = (['none', 'clean', 'punchy', 'film'].includes(op.kind) ? op.kind : 'none') as EditPlan['grade']['look'];
          p = {...p, grade: {...p.grade, look, ...(look === 'none' ? {perSource: {}, faceLift: 0} : {})}};
          break;
        }
      }
    } catch {
      p = before;
    }
    if (p !== before) applied++;
    else skipped.push(op.op);
  }
  return {plan: p, applied, skipped};
}

const blank = (op: Op['op'], extra: Partial<Op> = {}): Op => ({op, id: '', start: 0, end: 0, kind: '', text: '', value: '', label: '', items: [], emoji: '', number: 0, ...extra});

/** sem IA: entende alguns comandos comuns */
export function heuristicChat(plan: EditPlan, msg: string): z.infer<typeof ChatEditSchema> {
  const m = msg.toLowerCase();
  const ops: Op[] = [];
  const said: string[] = [];
  if (/legenda.*(maior|aumenta)/.test(m)) ops.push(blank('caption_scale', {number: 1.2})), said.push('aumentei a legenda');
  if (/legenda.*(menor|diminu)/.test(m)) ops.push(blank('caption_scale', {number: 0.85})), said.push('diminuí a legenda');
  for (const preset of ['karaoke', 'pill', 'editorial', 'clean', 'bold-pop']) if (m.includes(preset)) ops.push(blank('caption_preset', {kind: preset})), said.push(`legenda ${preset}`);
  const removeAll = (re: RegExp, kind: ItemKind, label: string) => {
    if (!re.test(m) || !/(tira|remov|apaga|sem )/.test(m)) return;
    const tr = timelineModel(plan).tracks.find((x) => x.kind === kind)!;
    tr.items.forEach((it) => ops.push(blank('remove', {id: it.id})));
    said.push(`removi ${tr.items.length} ${label}`);
  };
  removeAll(/b-?roll/, 'broll', 'B-roll(s)');
  removeAll(/gr[aá]fico/, 'overlay', 'gráfico(s)');
  removeAll(/zoom/, 'zoom', 'zoom(s)');
  removeAll(/(efeito|som|sfx)/, 'sfx', 'som(ns)');
  if (/m[uú]sica.*(alta|aumenta)/.test(m)) ops.push(blank('music_volume', {number: (plan.audio.music?.volume ?? 0.16) * 1.4})), said.push('música mais alta');
  if (/m[uú]sica.*(baixa|diminu)/.test(m)) ops.push(blank('music_volume', {number: (plan.audio.music?.volume ?? 0.16) * 0.6})), said.push('música mais baixa');
  const hook = msg.match(/(?:gancho|t[ií]tulo)\s*[:=]\s*(.+)$/i);
  if (hook) ops.push(blank('set_hook', {text: hook[1].trim().toUpperCase()})), said.push('troquei o gancho');
  const cta = msg.match(/(?:cta|final)\s*[:=]\s*(.+)$/i);
  if (cta) ops.push(blank('set_outro', {text: cta[1].trim().toUpperCase()})), said.push('troquei o CTA');
  for (const s of STYLE_LIST) if (m.includes(s.name.toLowerCase()) || new RegExp(`estilo\\s+${s.id}`).test(m)) ops.push(blank('set_style', {text: s.id})), said.push(`estilo ${s.name}`);
  return {
    reply: ops.length ? `${said.join(', ')}.` : 'Sem IA configurada eu entendo comandos simples: "legenda maior", "tira os B-rolls", "música mais baixa", "gancho: SEU TEXTO", "estilo pop". Configure ANTHROPIC_API_KEY para pedidos livres.',
    ops,
  };
}
