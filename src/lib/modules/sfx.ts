// Módulo 08 — sound design automático: evento → som, por estilo.
// Vocabulário de kamgasimo/sfx.mjs + sound.md e volumes por papel do ghost-editor
// (ui −14, whoosh −12, impact −8 dB). Regra: um som fraco a menos de 0,15 s de
// um forte é descartado. Os sons são sintetizados (scripts/generate-sfx.ts).
import type {EditPlan, SfxCue, SfxKind} from '../plan/schema';
import {styleOf} from '../styles';
import {placeClips, projectPoint, projectRange} from '../plan/timeline';
import {uid} from '../util/id';

const STRENGTH: Record<SfxKind, number> = {impact: 5, riser: 4, whoosh: 3, glitch: 3, swoosh: 2, sparkle: 2, ding: 2, pop: 1, click: 1, typing: 1};
// sons de apoio: bem abaixo da voz (o som nunca pode competir com a fala)
export const SFX_GAIN_DB: Record<SfxKind, number> = {impact: -14, riser: -16, whoosh: -15, swoosh: -16, glitch: -17, sparkle: -18, ding: -18, pop: -17, click: -19, typing: -21};
/** onde fica o "pico" de cada arquivo (o som começa antes do evento por esse tanto) */
export const SFX_LEAD: Record<SfxKind, number> = {whoosh: 0.18, swoosh: 0.12, riser: 1.4, impact: 0, pop: 0, click: 0, sparkle: 0, glitch: 0, ding: 0, typing: 0};

export function planSfx(plan: EditPlan): SfxCue[] {
  const style = styleOf(plan);
  const placed = placeClips(plan.clips, plan.format.fps);
  const manual = plan.audio.sfx.filter((s) => !s.auto);
  type Ev = {t: number; sourceId: string; srcAt: number; kind: SfxKind};
  const ev: Ev[] = [];
  const add = (sourceId: string, srcAt: number, kind: SfxKind | null | undefined) => {
    if (!kind) return;
    const t = projectPoint(placed, sourceId, srcAt);
    if (t !== null) ev.push({t, sourceId, srcAt, kind});
  };
  const pickT = (i: number) => style.sfx.transition[i % Math.max(1, style.sfx.transition.length)];
  plan.transitions.forEach((tr, i) => {
    const c = plan.clips.find((x) => x.id === tr.clipId);
    if (c) add(c.sourceId, c.inSec, tr.kind === 'glitch' ? 'glitch' : pickT(i));
  });
  // Som só onde o olho já está mudando de cena (como editor humano faz): whoosh na entrada
  // de cada cena de B-roll e um "pop" discreto nos gráficos de informação. Palavras-chave,
  // zooms e cortes ficam secos (som em todo zoom vira metralhadora), e sem riser no gancho.
  const OVERLAY_SFX: Partial<Record<string, SfxKind>> = {stat: 'pop', list: 'pop', chips: 'pop', steps: 'pop', compare: 'swoosh', chart: 'swoosh', strike: 'swoosh', ui: 'typing', confetti: 'sparkle', lowerthird: 'swoosh'};
  for (const o of plan.overlays) add(o.sourceId, o.start, OVERLAY_SFX[o.kind]);
  plan.broll.forEach((b, i) => add(b.sourceId, b.start, b.template === 'takeover' || b.template === 'split' ? pickT(i + 1) ?? 'whoosh' : style.sfx.enter));

  // espaçamento: o mais forte vence numa janela de 0,15 s; depois, um intervalo mínimo
  // entre sons (pelo estilo) para não virar uma sequência de efeitos
  const minGap = style.sfx.density === 'high' ? 2.0 : style.sfx.density === 'low' ? 3.5 : 2.5;
  ev.sort((a, b) => a.t - b.t);
  const kept: Ev[] = [];
  for (const e of ev) {
    const near = kept.find((k) => Math.abs(k.t - e.t) < minGap);
    if (!near) kept.push(e);
    else if (STRENGTH[e.kind] > STRENGTH[near.kind] && Math.abs(near.t - e.t) < 0.15) kept.splice(kept.indexOf(near), 1, e);
  }
  // variedade: nunca o mesmo som duas vezes seguidas (troca por um "parente") e os tons se revezam
  const used = new Map<SfxKind, number>();
  let prev: SfxKind | null = null;
  const cues = kept.map((e) => {
    let kind = e.kind;
    if (kind === prev) kind = SIBLING[kind] ?? kind;
    const n = used.get(kind) ?? 0;
    used.set(kind, n + 1);
    prev = kind;
    return {id: uid('sfx'), sourceId: e.sourceId, at: e.srcAt, kind, gainDb: 0, auto: true, variant: n % 3};
  });
  return [...manual, ...cues];
}

/** som "parente" para alternar quando o mesmo efeito se repetiria em seguida */
const SIBLING: Partial<Record<SfxKind, SfxKind>> = {whoosh: 'swoosh', swoosh: 'whoosh', pop: 'click', click: 'pop', ding: 'sparkle', sparkle: 'ding'};

/** tom de cada variação (igual a scripts/generate-sfx.ts); o riser quase não muda de duração */
const VARIANT_PITCH = [1, 0.86, 1.16];
/** antecedência do pico, corrigida pela variação (som mais grave = mais longo) */
export const sfxLead = (cue: Pick<SfxCue, 'kind' | 'variant'>) => {
  const f = VARIANT_PITCH[cue.variant ?? 0];
  return SFX_LEAD[cue.kind] / (cue.kind === 'riser' ? 1 + (f - 1) * 0.3 : f);
};

/** arquivo do som (com a variação de tom) */
export const sfxFile = (cue: Pick<SfxCue, 'kind' | 'variant'>) => `sfx/${cue.kind}${cue.variant ? `-${cue.variant + 1}` : ''}.wav`;

export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** SFX projetados no tempo do vídeo (usado pela composição) */
export function projectSfx(plan: Pick<EditPlan, 'audio' | 'clips' | 'format'>) {
  const placed = placeClips(plan.clips, plan.format.fps);
  return plan.audio.sfx.flatMap((s) => {
    const t = projectPoint(placed, s.sourceId, s.at);
    return t === null ? [] : [{cue: s, t}];
  });
}

export {projectRange};
