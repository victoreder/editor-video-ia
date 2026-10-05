// Monta e re-monta o EditPlan: cortes → legendas → plano criativo (IA) →
// regras mecânicas (zoom por corte, transições, safezone, SFX).
import type {EditPlan, FaceTrack, Platform, Source, StyleConfig, StyleId, Word} from '../plan/schema';
import {EditPlanSchema, FORMATS, type FormatId} from '../plan/schema';
import {getStyle, isBuiltinStyle, styleOf} from '../styles';
import {placeClips, timelineWords} from '../plan/timeline';
import {autoCut, snapClipsToWords, speechSegments, dropRetakes, mergeClose, segmentsToClips, type Aggressiveness, type Segment} from '../modules/cuts';
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

/** Cortes: autocut mecânico; a IA (se houver) escolhe entre os takes. */
export async function planCuts(
  sources: Source[],
  words: Word[],
  opts: {level: Aggressiveness; director: Director; script?: string; log?: (s: string) => void},
): Promise<EditPlan['clips']> {
  if (opts.director.id === 'heuristic' || !words.length) {
    const {clips, droppedSec} = autoCut(sources, words, opts.level, true);
    if (droppedSec > 0) opts.log?.(`takes repetidos removidos: ${droppedSec.toFixed(1)} s`);
    return snapClipsToWords(clips, words);
  }
  let segs: Segment[] = [];
  for (const s of sources) {
    const sw = words.filter((w) => w.sourceId === s.id);
    if (!sw.length) segs.push({sourceId: s.id, inSec: 0, outSec: s.duration, words: []});
    else segs.push(...speechSegments(sw, s, opts.level));
  }
  try {
    const name = new Map(sources.map((s) => [s.id, s.name]));
    const res = await opts.director.selectTakes(
      segs.map((s, i) => ({i, sourceName: name.get(s.sourceId) ?? s.sourceId, start: s.inSec, end: s.outSec, text: s.words.map((w) => w.text).join(' ') || '(sem fala)'})),
      opts.script,
    );
    const keep = res.keep.filter((i, k, a) => Number.isInteger(i) && segs[i] && a.indexOf(i) === k);
    if (keep.length) {
      opts.log?.(`takes (IA): ${keep.length}/${segs.length} trechos. ${res.notes ?? ''}`);
      return snapClipsToWords(segmentsToClips(mergeClose(keep.map((i) => segs[i]))), words);
    }
  } catch (e) {
    opts.log?.(`escolha de takes pela IA falhou (${String(e).slice(0, 140)}); usando regras`);
  }
  return snapClipsToWords(segmentsToClips(mergeClose(dropRetakes(segs).kept)), words);
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
  script?: string;
  musicKey?: string;
  log?: (s: string) => void;
}): Promise<EditPlan> {
  const plan = emptyPlan({style: input.style, styleConfig: input.styleConfig, platform: input.platform, director: input.director.id, model: input.director.model});
  plan.sources = input.sources;
  plan.words = input.words;
  plan.faceTracks = input.faceTracks;
  plan.clips = await planCuts(input.sources, input.words, {level: input.level, director: input.director, script: input.script, log: input.log});
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
