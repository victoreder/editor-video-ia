// Módulo 11 — copiar o estilo de um reel de referência.
// A IA vê frames do reel (1 a cada ~0,5–1 s) + a transcrição + medições objetivas
// (ritmo de cortes, paleta, cor) e devolve um ESTILO nosso (StyleConfig), não um
// texto. Prompt adaptado de ghost-editor/reference-study-prompt.md (MIT).
// Sem IA, o estilo sai só das medições.
import {z} from 'zod';
import type {StyleConfig} from '../plan/schema';
import {STYLES} from '../styles';

export type RefMeasures = {
  duration: number;
  cuts: number[];
  avgShot: number;
  cutsPerMin: number;
  colors: string[];
  luma: number;
  sat: number;
  wordsPerMin?: number;
};

export const ReferenceSchema = z.object({
  name: z.string().describe('nome curto do estilo, em português'),
  summary: z.string().describe('1–2 frases descrevendo o estilo'),
  editLog: z.string().describe('log de edição resumido: o que acontece na tela ao longo do tempo (cortes, zooms, gráficos, legendas, transições, sons)'),
  fiveThings: z.array(z.string()).describe('as 5 coisas que mais definem este estilo'),
  palette: z.object({text: z.string(), accent: z.string(), key: z.string(), panel: z.string(), bg: z.string()}).describe('cores em hex (#RRGGBB); key = cor da palavra destacada na legenda'),
  fonts: z.object({display: z.enum(['Montserrat', 'Inter', 'Anton']), body: z.enum(['Montserrat', 'Inter', 'Anton']), weight: z.number()}).describe('a fonte disponível mais parecida'),
  captions: z.object({
    preset: z.enum(['bold-pop', 'karaoke', 'pill', 'editorial', 'clean']),
    uppercase: z.boolean(),
    maxWords: z.number(),
    sizeOfWidth: z.number().describe('altura da letra como fração da largura do vídeo, ex.: 0.07'),
    emphasisRate: z.number().describe('fração das palavras com destaque, 0–0.3'),
    emojiEvery: z.number().describe('1 emoji a cada N blocos de legenda (0 = nunca)'),
  }),
  camera: z.object({intensity: z.enum(['none', 'subtle', 'medium', 'strong']), punchEverySec: z.number(), shake: z.boolean()}),
  transitions: z.object({kinds: z.array(z.enum(['whip', 'zoom', 'flash', 'glitch', 'blur'])), everySec: z.number()}),
  graphicsPerMinute: z.number(),
  brollPerMinute: z.number(),
  brollTemplates: z.array(z.enum(['card', 'split', 'takeover', 'pip'])),
  maxStaticSec: z.number(),
  sfxDensity: z.enum(['low', 'medium', 'high']),
  music: z.object({mood: z.enum(['upbeat', 'calm', 'cinematic']), level: z.enum(['low', 'medium', 'high'])}),
  grade: z.enum(['punchy', 'clean', 'film', 'none']),
  hook: z.boolean().describe('abre com um título grande nos primeiros segundos?'),
  cta: z.string().describe('texto do CTA no final, ou vazio'),
  progressBar: z.boolean(),
});
export type ReferenceStudy = z.infer<typeof ReferenceSchema>;

export const REFERENCE_SYSTEM = `Você é um motion designer sênior fazendo a engenharia reversa de um reel vertical para reproduzir o ESTILO de edição dele em outros vídeos (talking-head, PT-BR).
Você recebe frames do reel em ordem (com o segundo de cada um), a transcrição e medições objetivas feitas por código (ritmo de cortes, cores dominantes, brilho).
Seja literal: descreva o que VÊ (cortes, enquadramento e zooms do apresentador, sistema de legendas — fonte, caixa, cor, posição, palavras por bloco, como destacam palavras —, gráficos, B-roll, transições, ritmo, paleta) e mapeie para os parâmetros do nosso editor.
Regras:
- As medições de código são confiáveis para ritmo e cor: use-as (ex.: média de plano 1,8 s → algo muda a cada ~2 s → maxStaticSec baixo, câmera forte).
- Escolha o preset de legenda mais próximo: bold-pop (caixa alta grossa com contorno, palavra-chave colorida), karaoke (caixa colorida atrás da palavra falada), pill (fundo escuro arredondado), editorial (minúsculas suaves, palavra falada em negrito), clean (texto simples com sombra).
- Cores sempre em hex. Nunca invente o que não dá para ver; quando estimar, escolha o valor mais conservador.`;

export const referenceUser = (m: RefMeasures, transcript: string) =>
  `MEDIÇÕES (código):\n- duração ${m.duration.toFixed(1)} s · ${m.cuts.length} cortes · plano médio ${m.avgShot.toFixed(2)} s · ${m.cutsPerMin.toFixed(1)} cortes/min\n- cores vivas dominantes: ${m.colors.join(', ') || '(nenhuma marcante)'}\n- brilho médio ${m.luma.toFixed(0)}/255 · saturação ${m.sat.toFixed(0)}${m.wordsPerMin ? `\n- fala: ${m.wordsPerMin.toFixed(0)} palavras/min` : ''}\n\nTRANSCRIÇÃO:\n${transcript || '(sem fala ou sem transcrição)'}\n\nAnalise os frames e devolva o estilo.`;

const CAMERA: Record<ReferenceStudy['camera']['intensity'], Pick<StyleConfig['camera'], 'levels' | 'push' | 'punchScale' | 'maxZoom'>> = {
  none: {levels: [1], push: 0, punchScale: [1.08, 1.12], maxZoom: 1.12},
  subtle: {levels: [1, 1.06], push: 0.03, punchScale: [1.12, 1.2], maxZoom: 1.22},
  medium: {levels: [1, 1.1, 1.16], push: 0.05, punchScale: [1.22, 1.32], maxZoom: 1.36},
  strong: {levels: [1, 1.15, 1.25], push: 0.06, punchScale: [1.32, 1.46], maxZoom: 1.5},
};
const clampN = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const isHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s);

/** estudo (IA) → StyleConfig nosso, com tudo dentro de limites seguros */
export function studyToStyle(id: string, r: ReferenceStudy, origin: string): StyleConfig {
  const base = STYLES.dynamic;
  const c = CAMERA[r.camera.intensity] ?? CAMERA.medium;
  const color = (v: string, d: string) => (isHex(v) ? v.toUpperCase() : d);
  return {
    id,
    name: r.name || 'Meu estilo',
    summary: r.summary,
    origin,
    palette: {
      text: color(r.palette.text, '#FFFFFF'),
      accent: color(r.palette.accent, base.palette.accent),
      key: color(r.palette.key, base.palette.key),
      panel: color(r.palette.panel, base.palette.panel),
      panelText: '#FFFFFF',
      bg: color(r.palette.bg, base.palette.bg),
      muted: '#C8C8D0',
    },
    fonts: {display: r.fonts.display, body: r.fonts.body, displayWeight: clampN(r.fonts.weight, 400, 900, 800)},
    captions: {
      preset: r.captions.preset,
      uppercase: r.captions.uppercase,
      maxWords: Math.round(clampN(r.captions.maxWords, 1, 6, 3)),
      sizePx: Math.round(clampN(r.captions.sizeOfWidth, 0.04, 0.11, 0.075) * 1080),
      emphasisRate: clampN(r.captions.emphasisRate, 0, 0.3, 0.1),
      emojiEvery: Math.round(clampN(r.captions.emojiEvery, 0, 20, 0)),
    },
    camera: {...c, punchEvery: clampN(r.camera.punchEverySec, 2, 30, 6), shake: r.camera.shake},
    transitions: {set: r.transitions.kinds.length ? r.transitions.kinds : ['cut'], minGap: clampN(r.transitions.everySec, 4, 60, 10), duration: 0.24},
    graphics: {coverage: [0.1, 0.6], perMinute: clampN(r.graphicsPerMinute, 0, 15, 4)},
    broll: {perMinute: clampN(r.brollPerMinute, 0, 15, 4), templates: r.brollTemplates.length ? r.brollTemplates : ['card', 'split']},
    maxStatic: clampN(r.maxStaticSec, 1.5, 12, 4),
    sfx: {
      density: r.sfxDensity,
      transition: r.sfxDensity === 'low' ? ['swoosh'] : ['whoosh', 'swoosh'],
      enter: r.sfxDensity === 'low' ? 'click' : 'pop',
      punch: r.sfxDensity === 'high' ? 'impact' : null,
      hook: r.hook ? 'riser' : null,
    },
    music: {mood: r.music.mood, volume: r.music.level === 'high' ? 0.22 : r.music.level === 'low' ? 0.1 : 0.16},
    grade: r.grade,
    hook: r.hook,
    cta: r.cta?.trim() ? r.cta.trim().toUpperCase() : null,
    progress: r.progressBar,
  };
}

/** sem IA: estilo deduzido só das medições (ritmo → câmera/estáticos; cor → paleta/look) */
export function measuresToStyle(id: string, m: RefMeasures, name: string): StyleConfig {
  const fast = m.avgShot < 2.2;
  const slow = m.avgShot > 5;
  const base = fast ? STYLES.dynamic : slow ? STYLES.minimal : STYLES.clean;
  const [k1, k2] = m.colors;
  return {
    ...structuredClone(base),
    id,
    name,
    origin: 'medições do reel (sem IA)',
    summary: `Deduzido do reel: plano médio de ${m.avgShot.toFixed(1)} s (${m.cutsPerMin.toFixed(0)} cortes/min)${m.colors.length ? `, cores ${m.colors.slice(0, 3).join(', ')}` : ''}.`,
    palette: {...base.palette, key: k1 ?? base.palette.key, accent: k2 ?? k1 ?? base.palette.accent},
    maxStatic: +Math.max(1.5, Math.min(10, m.avgShot * 1.6)).toFixed(1),
    grade: m.sat > 70 ? 'punchy' : m.sat < 30 ? 'film' : 'clean',
  };
}
