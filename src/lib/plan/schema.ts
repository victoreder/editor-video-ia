// EditPlan: um único JSON que descreve a edição inteira (PLANO.md §3).
// O preview (@remotion/player) e o render final leem exatamente este objeto.
//
// Convenção de tempo: tudo que é "ancorado" (palavras, legendas, B-roll, gráficos,
// zoom, SFX) guarda {sourceId, tempo em segundos DA FONTE}. Assim, cortar,
// reordenar ou acelerar um clipe faz tudo acompanhar (modelo do autobroll).
// O arquivo usa só imports relativos porque também é empacotado pelo Remotion.
import {z} from 'zod';

export const FORMATS = {
  vertical: {width: 1080, height: 1920},
  square: {width: 1080, height: 1080},
  landscape: {width: 1920, height: 1080},
} as const;
export type FormatId = keyof typeof FORMATS;

// estilos prontos: dynamic | clean | pop | minimal; estilos próprios têm id "custom_…"
export const StyleIdSchema = z.string().min(1);
export type StyleId = string;

export const CaptionPresetSchema = z.enum(['bold-pop', 'karaoke', 'pill', 'editorial', 'clean']);
export type CaptionPreset = z.infer<typeof CaptionPresetSchema>;

export const TransitionKindSchema = z.enum(['cut', 'whip', 'zoom', 'flash', 'glitch', 'blur']);
export type TransitionKind = z.infer<typeof TransitionKindSchema>;

export const SfxKindSchema = z.enum(['whoosh', 'swoosh', 'pop', 'click', 'impact', 'riser', 'sparkle', 'glitch', 'ding', 'typing']);
export type SfxKind = z.infer<typeof SfxKindSchema>;

/** módulo 10: um estilo é um JSON (paleta, fontes, legenda, câmera, transições, densidade, som, música, cor) */
export const StyleConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  palette: z.object({text: z.string(), accent: z.string(), key: z.string(), panel: z.string(), panelText: z.string(), bg: z.string(), muted: z.string()}),
  fonts: z.object({display: z.string(), body: z.string(), displayWeight: z.number()}),
  captions: z.object({
    preset: CaptionPresetSchema,
    uppercase: z.boolean(),
    maxWords: z.number(),
    sizePx: z.number(),
    emphasisRate: z.number(),
    emojiEvery: z.number(),
  }),
  camera: z.object({
    levels: z.array(z.number()),
    push: z.number(),
    punchScale: z.tuple([z.number(), z.number()]),
    punchEvery: z.number(),
    maxZoom: z.number(),
    shake: z.boolean(),
  }),
  transitions: z.object({set: z.array(TransitionKindSchema), minGap: z.number(), duration: z.number()}),
  graphics: z.object({coverage: z.tuple([z.number(), z.number()]), perMinute: z.number()}),
  broll: z.object({perMinute: z.number(), templates: z.array(z.enum(['card', 'split', 'takeover', 'pip']))}),
  maxStatic: z.number(),
  sfx: z.object({
    density: z.enum(['low', 'medium', 'high']),
    transition: z.array(SfxKindSchema),
    enter: SfxKindSchema,
    punch: SfxKindSchema.nullable(),
    hook: SfxKindSchema.nullable(),
  }),
  music: z.object({mood: z.enum(['upbeat', 'calm', 'cinematic']), volume: z.number()}),
  grade: z.enum(['punchy', 'clean', 'film', 'none']),
  hook: z.boolean(),
  cta: z.string().nullable(),
  progress: z.boolean(),
  /** de onde veio (ex.: "reel de referência X") */
  origin: z.string().optional(),
});
export type StyleConfig = z.infer<typeof StyleConfigSchema>;

export const PlatformSchema = z.enum(['instagram', 'tiktok', 'shorts', 'all']);
export type Platform = z.infer<typeof PlatformSchema>;

export const SourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  // chave no Storage (Blob/S3/local). O proxy é o arquivo usado no preview e no render.
  key: z.string(),
  proxyKey: z.string().optional(),
  audioKey: z.string().optional(),
  duration: z.number(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  hasAudio: z.boolean().default(true),
  // pausas e respiros medidos no áudio (media/silence.ts), em segundos da fonte
  pauses: z.array(z.object({start: z.number(), end: z.number(), kind: z.enum(['silence', 'breath'])})).optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const WordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  sourceId: z.string(),
  speaker: z.string().optional(),
});
export type Word = z.infer<typeof WordSchema>;

export const KeyframeSchema = z.object({
  t: z.number(), // tempo da fonte
  scale: z.number(),
  x: z.number(), // deslocamento em % da largura
  y: z.number(), // deslocamento em % da altura
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const ClipSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  inSec: z.number(),
  outSec: z.number(),
  speed: z.number().default(1),
  volume: z.number().default(1),
  muted: z.boolean().default(false),
  // nível de enquadramento do clipe: um zoom diferente a cada corte esconde o jump cut
  baseZoom: z.number().default(1),
  transform: z.array(KeyframeSchema).optional(), // keyframes manuais (editor)
  label: z.string().optional(),
});
export type Clip = z.infer<typeof ClipSchema>;

export const ZoomBeatSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  start: z.number(),
  end: z.number(),
  style: z.enum(['static', 'punch', 'push', 'shake']),
  scale: z.number(), // escala alvo (1 = sem zoom)
  reason: z.string().optional(),
});
export type ZoomBeat = z.infer<typeof ZoomBeatSchema>;

export const FaceSampleSchema = z.object({
  t: z.number(), // tempo da fonte
  cx: z.number(), // centro do rosto, 0..1
  cy: z.number(),
  w: z.number(), // largura/altura do rosto, 0..1
  h: z.number(),
  chinY: z.number(), // queixo, 0..1
  fx: z.number().optional(), // enquadramento horizontal suavizado ("cinegrafista"), 0..1
});
export const FaceTrackSchema = z.object({
  sourceId: z.string(),
  samples: z.array(FaceSampleSchema),
  method: z.string().optional(),
});
export type FaceSample = z.infer<typeof FaceSampleSchema>;
export type FaceTrack = z.infer<typeof FaceTrackSchema>;

export const CaptionWordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  accent: z.boolean().default(false),
});
export type CaptionWord = z.infer<typeof CaptionWordSchema>;

export const CaptionChunkSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  start: z.number(),
  end: z.number(),
  words: z.array(CaptionWordSchema),
  emoji: z.string().optional(),
  // posição vertical do topo do bloco em % da altura; calculada pela safezone, editável
  y: z.number().optional(),
  manual: z.boolean().optional(), // y ajustado à mão: o safezone não mexe
  scale: z.number().optional(),
  hidden: z.boolean().optional(),
});
export type CaptionChunk = z.infer<typeof CaptionChunkSchema>;

export const OverlayKindSchema = z.enum([
  'stat', 'list', 'title', 'quote', 'emoji', 'strike', 'chips',
  // fase 2: biblioteca completa (kamgasimo/components + talking-head-reel/overlays)
  'compare', 'steps', 'chart', 'lowerthird', 'confetti', 'ui', 'sticker',
  // fase 3: texto ATRÁS da pessoa (precisa do recorte, job "matte")
  'behind',
  // palavra-chave da fala, gigante na tela (estilo TikTok)
  'keyword',
]);
export type OverlayKind = z.infer<typeof OverlayKindSchema>;

export const OverlaySchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  start: z.number(),
  end: z.number(),
  kind: OverlayKindSchema,
  // stat: value/label · list/chips: title/items · title: text/sub · quote: text/author
  // emoji: emoji · strike: text
  props: z.object({
    value: z.string().optional(),
    label: z.string().optional(),
    title: z.string().optional(),
    items: z.array(z.string()).optional(),
    text: z.string().optional(),
    sub: z.string().optional(),
    author: z.string().optional(),
    emoji: z.string().optional(),
    src: z.string().optional(), // sticker/meme: imagem do storage ou URL
    matteSrc: z.string().optional(), // behind: vídeo com alfa só da pessoa (recorte)
    matteStart: z.number().optional(), // behind: segundo da FONTE em que o recorte começa
  }),
  layout: z.enum(['card', 'full', 'top']).default('card'),
  y: z.number().optional(),
  reason: z.string().optional(),
});
export type Overlay = z.infer<typeof OverlaySchema>;

export const BrollAssetSchema = z.object({
  kind: z.enum(['video', 'image', 'emoji']),
  src: z.string().optional(), // chave do storage OU URL http(s)
  query: z.string().optional(), // termos de busca (inglês) para o banco de vídeos (Pexels/Pixabay)
  queries: z.array(z.string()).optional(), // buscas alternativas (inglês), tentadas em ordem
  scene: z.string().optional(), // a cena ideal, descrita pela IA (usada para escolher entre os candidatos)
  emoji: z.string().optional(),
  prompt: z.string().optional(), // geração por IA (F2)
  origin: z.enum(['own', 'pexels', 'pixabay', 'ai', 'none']).default('none'),
  alternatives: z.array(z.string()).default([]),
  credit: z.string().optional(),
});
export type BrollAsset = z.infer<typeof BrollAssetSchema>;

export const BrollSegmentSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  start: z.number(),
  end: z.number(),
  template: z.enum(['card', 'split', 'takeover', 'pip']),
  asset: BrollAssetSchema,
  caption: z.string().optional(), // texto curto opcional sobre o B-roll
  y: z.number().optional(), // topo do card em % da altura (template card)
  reason: z.string().optional(),
});
export type BrollSegment = z.infer<typeof BrollSegmentSchema>;

export const TransitionSchema = z.object({
  id: z.string(),
  clipId: z.string(), // a transição acontece na ENTRADA deste clipe
  kind: TransitionKindSchema,
  duration: z.number().default(0.24),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const SfxCueSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  at: z.number(),
  kind: SfxKindSchema,
  gainDb: z.number().default(0),
  auto: z.boolean().default(true), // gerado pelo planner (re-planejar substitui)
  variant: z.number().int().min(0).max(2).optional(), // 0 = original, 1/2 = outro tom (sfx/<kind>-2|3.wav)
});
export type SfxCue = z.infer<typeof SfxCueSchema>;

export const MusicBedSchema = z.object({
  src: z.string(),
  name: z.string().optional(),
  volume: z.number().default(0.18),
  startSec: z.number().default(0),
  fadeOutSec: z.number().default(1.5),
  duck: z.boolean().default(true),
  duckLevel: z.number().default(0.3),
});
export type MusicBed = z.infer<typeof MusicBedSchema>;

export const EndCardSchema = z.object({
  title: z.string(),
  line: z.string().optional(),
  duration: z.number().default(2),
});

export const HookSchema = z.object({
  title: z.string(), // "LINHA UM|LINHA DOIS"
  until: z.number().default(2), // segundos do timeline
});

export const EditPlanSchema = z.object({
  version: z.literal(1),
  format: z.object({width: z.number(), height: z.number(), fps: z.number()}),
  style: StyleIdSchema,
  styleConfig: StyleConfigSchema.optional(), // cópia do estilo próprio (o plano fica autossuficiente)
  platform: PlatformSchema.default('instagram'),
  sources: z.array(SourceSchema),
  words: z.array(WordSchema),
  clips: z.array(ClipSchema),
  camera: z.object({beats: z.array(ZoomBeatSchema).default([])}),
  faceTracks: z.array(FaceTrackSchema).default([]),
  captions: z.object({
    preset: CaptionPresetSchema,
    uppercase: z.boolean().default(true),
    chunks: z.array(CaptionChunkSchema),
  }),
  overlays: z.array(OverlaySchema).default([]),
  broll: z.array(BrollSegmentSchema).default([]),
  transitions: z.array(TransitionSchema).default([]),
  audio: z.object({
    music: MusicBedSchema.optional(),
    sfx: z.array(SfxCueSchema).default([]),
    sfxVolume: z.number().default(0.7),
  }),
  grade: z
    .object({
      look: z.enum(['punchy', 'clean', 'film', 'none']),
      faceLift: z.number().default(0),
      // módulo 09: correção medida por fonte, com o rosto primeiro (o rosto nunca fica mais escuro)
      perSource: z.record(z.string(), z.object({brightness: z.number(), contrast: z.number(), saturate: z.number(), warmth: z.number().default(0), notes: z.array(z.string()).default([])})).default({}),
    })
    .default({look: 'none', faceLift: 0, perSource: {}}),
  hook: HookSchema.optional(),
  outro: EndCardSchema.optional(),
  progressBar: z.boolean().default(false),
  /** o que o corte automático removeu (respiros, erros, repetições) — para conferir e restaurar */
  cutReport: z
    .object({
      keptSec: z.number(),
      removedSec: z.number(),
      pausesCut: z.number(),
      pauseSec: z.number(),
      removed: z.array(z.object({text: z.string(), start: z.number(), end: z.number(), sourceId: z.string(), reason: z.string()})),
    })
    .optional(),
  meta: z.object({
    director: z.enum(['claude', 'openai', 'heuristic']),
    model: z.string(),
    createdAt: z.string(),
    notes: z.array(z.string()).default([]),
  }),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;
export type EditPlanInput = z.input<typeof EditPlanSchema>;

export const parseEditPlan = (data: unknown): EditPlan => EditPlanSchema.parse(data);
