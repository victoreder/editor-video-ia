// Monta e re-monta o EditPlan: cortes → legendas → plano criativo (IA) →
// regras mecânicas (zoom por corte, transições, safezone, SFX).
import type {EditPlan, FaceTrack, Platform, Source, StyleConfig, StyleId, Word} from '../plan/schema';
import {EditPlanSchema, FORMATS, type FormatId} from '../plan/schema';
import {getStyle, isBuiltinStyle, styleOf} from '../styles';
import {placeClips, timelineWords} from '../plan/timeline';
import {snapClipsToWords, type Aggressiveness} from '../modules/cuts';
import {buildCuts, detectMistakes, transcriptForCut, type CutReport, type Removal} from '../modules/smartcut';
import {CUT_SYSTEM} from '../adapters/director/prompts';
import {buildCaptions} from '../modules/captions';
import {applyCreative, emptyCreative, heuristicCreative, type Creative} from '../modules/creative';
import {placeCaptions, placeCards} from '../modules/safezone';
import {planSfx} from '../modules/sfx';
import type {Director} from '../adapters/director';

export function emptyPlan(opts: {style: StyleId; styleConfig?: StyleConfig; platform: Platform; format?: FormatId; director: EditPlan['meta']['director']; model: string}): EditPlan {
  const style = opts.styleConfig ?? getStyle(opts.style);
  const f = FORMATS[opts.format ?? 'vertical'];
  return EditPlanSchema.parse({
    version: 1,
    format: {width: f.width, height: f.height, fps: 30},
    style: opts.style,
    styleConfig: opts.styleConfig,
    platform: opts.platform,
    sources: [],
    words: [],
    clips: [],
    camera: {beats: []},
    faceTracks: [],
    captions: {preset: style.captions.preset, uppercase: style.captions.uppercase, chunks: []},
    overlays: [],
    broll: [],
    transitions: [],
    audio: {sfx: []},
    meta: {director: opts.director, model: opts.model, createdAt: new Date().toISOString(), notes: []},
  });
}

/**
 * Cortes: respiros (medidos no áudio) + erros e repetições.
 * Sem IA, tudo por regras. Com IA, a IA decide o que é erro/repetição/bastidor
 * (por intervalo de palavras) e as regras mecânicas (gaguejada, "éé") continuam valendo.
 */
export async function planCuts(
  sources: Source[],
  words: Word[],
  opts: {level: Aggressiveness; director: Director; script?: string; log?: (s: string) => void; minPause?: number; removeMistakes?: boolean},
): Promise<{clips: EditPlan['clips']; report: CutReport}> {
  const removeMistakes = opts.removeMistakes !== false;
  const pausesBy = new Map(sources.map((s) => [s.id, s.pauses]));
  let removals: Removal[] = removeMistakes ? detectMistakes(words, pausesBy, opts.level) : [];
  if (removeMistakes && opts.director.id !== 'heuristic' && words.length) {
    try {
      const {z} = await import('zod');
      const r = await opts.director.json({
        name: 'cuts',
        system: CUT_SYSTEM,
        user: `${opts.script ? `ROTEIRO PRETENDIDO:\n${opts.script}\n\n` : ''}TRANSCRIÇÃO:\n${transcriptForCut(words, sources)}`,
        schema: z.object({remove: z.array(z.object({from: z.number(), to: z.number(), reason: z.string()})), notes: z.string()}),
        effort: 'medium',
      });
      const ai = r.remove.filter((x) => Number.isInteger(x.from) && Number.isInteger(x.to) && x.from >= 0 && x.to < words.length && x.to >= x.from);
      // a IA decide frases; as regras mecânicas de palavra (gaguejada, "éé") somam-se a ela
      const mechanical = removals.filter((x) => /gaguejada|hesitação|palavra começada/.test(x.reason));
      removals = [...ai, ...mechanical];
      opts.log?.(`cortes (IA): ${ai.length} trecho(s) com erro/repetição. ${r.notes ?? ''}`);
    } catch (e) {
      opts.log?.(`revisão dos cortes pela IA falhou (${String(e).slice(0, 140)}); usando regras`);
    }
  }
  const {clips, report} = buildCuts(sources, words, removals, {level: opts.level, minPause: opts.minPause});
  opts.log?.(`cortes: ${report.pausesCut} pausas/respiros (${report.pauseSec.toFixed(1)} s) e ${report.removed.length} trecho(s) com erro/repetição — ficaram ${report.keptSec.toFixed(1)} s de ${(report.keptSec + report.removedSec).toFixed(1)} s`);
  return {clips: snapClipsToWords(clips, words), report};
}

/** Plano criativo (IA ou regras) + regras mecânicas. Mantém clipes/legendas editados. */
export async function planCreative(plan: EditPlan, director: Director, log?: (s: string) => void): Promise<EditPlan> {
  const style = styleOf(plan);
  const words = timelineWords(plan);
  const duration = placeClips(plan.clips, plan.format.fps).at(-1)?.end ?? 0;
  let creative: Creative = emptyCreative();
  let usedDirector: EditPlan['meta']['director'] = director.id;
  if (words.length) {
    try {
      creative = await director.creative({words, style, duration, platform: plan.platform});
    } catch (e) {
      log?.(`IA diretora (${director.id}) falhou: ${String(e).slice(0, 200)} — usando regras`);
      creative = heuristicCreative(words, style, duration);
      usedDirector = 'heuristic';
    }
  }
  let next = applyCreative({...plan, meta: {...plan.meta, director: usedDirector, model: usedDirector === 'heuristic' ? 'regras' : director.model}}, creative);
  next = finalize(next);
  return next;
}

/** passos determinísticos que rodam após qualquer mudança estrutural */
export function finalize(plan: EditPlan): EditPlan {
  const cards = placeCards(plan);
  let next = {...cards.plan, captions: {...plan.captions, chunks: placeCaptions(cards.plan, {occupied: cards.occupied})}};
  next = {...next, audio: {...next.audio, sfx: planSfx(next)}};
  return EditPlanSchema.parse(next);
}

/** plano base a partir das fontes e palavras (antes do criativo) */
export async function basePlan(input: {
  sources: Source[];
  words: Word[];
  faceTracks: FaceTrack[];
  style: StyleId;
  styleConfig?: StyleConfig;
  platform: Platform;
  director: Director;
  level: Aggressiveness;
  minPause?: number;
  removeMistakes?: boolean;
  script?: string;
  musicKey?: string;
  log?: (s: string) => void;
}): Promise<EditPlan> {
  const plan = emptyPlan({style: input.style, styleConfig: input.styleConfig, platform: input.platform, director: input.director.id, model: input.director.model});
  plan.sources = input.sources;
  plan.words = input.words;
  plan.faceTracks = input.faceTracks;
  const cut = await planCuts(input.sources, input.words, {level: input.level, director: input.director, script: input.script, log: input.log, minPause: input.minPause, removeMistakes: input.removeMistakes});
  plan.clips = cut.clips;
  plan.cutReport = cut.report;
  plan.captions.chunks = buildCaptions(plan);
  if (input.musicKey) plan.audio.music = {src: input.musicKey, volume: styleOf(plan).music.volume, startSec: 0, fadeOutSec: 1.5, duck: true, duckLevel: 0.3};
  return plan;
}

/** troca o estilo de um plano existente sem refazer cortes nem a IA */
export function restyle(plan: EditPlan, target: StyleId | StyleConfig): EditPlan {
  const style = typeof target === 'string' ? (isBuiltinStyle(target) ? getStyle(target) : plan.styleConfig?.id === target ? plan.styleConfig : getStyle(target)) : target;
  const styleId = style.id;
  const lv = style.camera.levels;
  const next: EditPlan = {
    ...plan,
    style: styleId,
    styleConfig: isBuiltinStyle(styleId) ? undefined : style,
    clips: plan.clips.map((c, i) => ({...c, baseZoom: lv[i % lv.length]})),
    captions: {
      preset: style.captions.preset,
      uppercase: style.captions.uppercase,
      chunks: plan.captions.chunks.map((c) => ({
        ...c,
        words: c.words.map((w) => ({...w, text: style.captions.uppercase ? w.text.toLocaleUpperCase('pt-BR') : w.text.toLocaleLowerCase('pt-BR')})),
      })),
    },
    progressBar: style.progress,
    grade: {...plan.grade, look: style.grade},
    outro: style.cta ? {title: style.cta, duration: 1.6} : undefined,
    hook: style.hook ? plan.hook : undefined,
  };
  return finalize(next);
}
