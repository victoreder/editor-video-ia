// Módulo 08 — sound design automático: evento → som, por estilo.
// Vocabulário de kamgasimo/sfx.mjs + sound.md e volumes por papel do ghost-editor
// (ui −14, whoosh −12, impact −8 dB). Regra: um som fraco a menos de 0,15 s de
// um forte é descartado. Os sons são sintetizados (scripts/generate-sfx.ts).
import type {EditPlan, SfxCue, SfxKind} from '../plan/schema';
import {styleOf} from '../styles';
import {placeClips, projectPoint, projectRange} from '../plan/timeline';
import {uid} from '../util/id';

const STRENGTH: Record<SfxKind, number> = {impact: 5, riser: 4, whoosh: 3, glitch: 3, swoosh: 2, sparkle: 2, ding: 2, pop: 1, click: 1, typing: 1};
export const SFX_GAIN_DB: Record<SfxKind, number> = {impact: -8, riser: -10, whoosh: -12, swoosh: -13, glitch: -13, sparkle: -14, ding: -14, pop: -14, click: -16, typing: -18};
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
  const OVERLAY_SFX: Partial<Record<string, SfxKind>> = {strike: 'whoosh', title: 'impact', behind: 'impact', confetti: 'sparkle', ui: 'typing', lowerthird: 'swoosh', chart: 'swoosh'};
  for (const o of plan.overlays) add(o.sourceId, o.start, OVERLAY_SFX[o.kind] ?? style.sfx.enter);
  plan.broll.forEach((b, i) => add(b.sourceId, b.start, b.template === 'takeover' || b.template === 'split' ? pickT(i + 1) : style.sfx.enter));
  if (style.sfx.punch && style.sfx.density !== 'low') for (const z of plan.camera.beats) if (z.style === 'punch') add(z.sourceId, z.start, style.sfx.punch);
  if (style.sfx.density === 'high') for (const c of plan.captions.chunks) if (c.emoji) add(c.sourceId, c.start, 'pop');
  if (plan.hook && style.sfx.hook && placed[0]) add(placed[0].clip.sourceId, placed[0].clip.inSec + 0.01, style.sfx.hook);

  // espaçamento: o mais forte vence numa janela de 0,15 s; no máximo 1 som a cada 0,35 s
  ev.sort((a, b) => a.t - b.t);
  const kept: Ev[] = [];
  for (const e of ev) {
    const near = kept.find((k) => Math.abs(k.t - e.t) < 0.35);
    if (!near) kept.push(e);
    else if (STRENGTH[e.kind] > STRENGTH[near.kind] && Math.abs(near.t - e.t) < 0.15) kept.splice(kept.indexOf(near), 1, e);
  }
  return [
    ...manual,
    ...kept.map((e) => ({id: uid('sfx'), sourceId: e.sourceId, at: e.srcAt, kind: e.kind, gainDb: 0, auto: true})),
  ];
}

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
