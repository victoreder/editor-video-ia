// Módulo 14 — QA automático do plano (antes de renderizar):
// legenda sobre o rosto? corte no meio de palavra? tela parada > maxStatic?
// B-roll sem arquivo? gráficos cobrindo demais? Inspirado em kamgasimo/verify.mjs,
// review.md e ghost-editor/qa.py (MIT).
import type {EditPlan} from '../plan/schema';
import {getStyle} from '../styles';
import {placeClips, projectRange} from '../plan/timeline';
import {projectBeats} from '../plan/camera';
import {projectedCaptionTimes} from './captions';
import {makeFaceProbe, spanFace} from './safezone';

export type QaIssue = {level: 'error' | 'warning' | 'info'; code: string; message: string; at?: number};

export function runQa(plan: EditPlan): QaIssue[] {
  const issues: QaIssue[] = [];
  const style = getStyle(plan.style);
  const {fps, height: H} = plan.format;
  const placed = placeClips(plan.clips, fps);
  const D = placed.at(-1)?.end ?? 0;
  if (!plan.clips.length) return [{level: 'error', code: 'no-clips', message: 'O plano não tem clipes.'}];

  // cortes no meio de palavra
  for (const p of placed) {
    for (const w of plan.words) {
      if (w.sourceId !== p.clip.sourceId) continue;
      const midIn = p.clip.inSec > w.start + 0.04 && p.clip.inSec < w.end - 0.04;
      const midOut = p.clip.outSec > w.start + 0.04 && p.clip.outSec < w.end - 0.04;
      if (midIn || midOut) issues.push({level: 'warning', code: 'cut-mid-word', message: `Corte no meio da palavra "${w.text}" (clipe ${p.index + 1}).`, at: midIn ? p.start : p.end});
    }
    if (p.end - p.start < 0.4) issues.push({level: 'warning', code: 'short-clip', message: `Clipe ${p.index + 1} tem só ${(p.end - p.start).toFixed(2)} s.`, at: p.start});
  }

  // legenda sobre o rosto
  const probe = makeFaceProbe(plan);
  const blockH = 0.1 * H;
  for (const {chunk, t0, t1} of projectedCaptionTimes(plan)) {
    if (chunk.hidden || chunk.y === undefined) continue;
    const sp = spanFace(probe, t0, t1);
    if (!sp.seen) continue;
    const y0 = (chunk.y / 100) * H;
    const y1 = y0 + blockH;
    const overlap = Math.min(y1, sp.bottom) - Math.max(y0, sp.top);
    if (overlap > (sp.bottom - sp.top) * 0.35) issues.push({level: 'warning', code: 'caption-on-face', message: `Legenda "${chunk.words.map((w) => w.text).join(' ')}" cobre o rosto.`, at: t0});
  }

  // tela parada: nada muda por mais de maxStatic segundos
  const changes = new Set<number>([0, D]);
  placed.forEach((p) => changes.add(+p.start.toFixed(1)));
  projectBeats(plan, placed).forEach((b) => {
    changes.add(+b.t0.toFixed(1));
    // slow push é movimento contínuo: conta como mudança ao longo de todo o beat
    if (b.style === 'push') for (let t = b.t0; t < b.t1; t += 1) changes.add(+t.toFixed(1));
  });
  const addRange = (sourceId: string, a: number, b: number) => {
    const r = projectRange(placed, sourceId, a, b);
    if (r) {
      changes.add(+r.start.toFixed(1));
      changes.add(+r.end.toFixed(1));
    }
    return r;
  };
  let graphicTime = 0;
  for (const o of plan.overlays) {
    const r = addRange(o.sourceId, o.start, o.end);
    if (r) graphicTime += r.end - r.start;
  }
  for (const b of plan.broll) {
    const r = addRange(b.sourceId, b.start, b.end);
    if (r) graphicTime += r.end - r.start;
    if (b.asset.kind !== 'emoji' && !b.asset.src) issues.push({level: 'warning', code: 'broll-missing', message: `B-roll "${b.asset.query ?? b.id}" ainda sem arquivo (busque ou troque).`, at: r?.start});
  }
  const cs = [...changes].sort((a, b) => a - b);
  for (let i = 1; i < cs.length; i++) {
    if (cs[i] - cs[i - 1] > style.maxStatic + 0.5)
      issues.push({level: 'info', code: 'static', message: `Nada muda na tela por ${(cs[i] - cs[i - 1]).toFixed(1)} s (${cs[i - 1].toFixed(1)}–${cs[i].toFixed(1)} s). O estilo pede no máx. ${style.maxStatic} s.`, at: cs[i - 1]});
  }
  if (D > 0) {
    const cov = graphicTime / D;
    const [lo, hi] = style.graphics.coverage;
    if (cov > hi + 0.25) issues.push({level: 'info', code: 'busy', message: `Gráficos/B-roll cobrem ${(cov * 100).toFixed(0)}% do vídeo — está carregado; deixe algumas frases só com você.`});
    if (cov < lo * 0.5 && D > 15) issues.push({level: 'info', code: 'sparse', message: `Gráficos/B-roll cobrem só ${(cov * 100).toFixed(0)}% do vídeo; o estilo pede ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%.`});
  }
  if (D > 90) issues.push({level: 'info', code: 'long', message: `O vídeo tem ${D.toFixed(0)} s — Reels/TikTok performam melhor abaixo de 60–90 s.`});
  if (!issues.length) issues.push({level: 'info', code: 'ok', message: 'Nenhum problema encontrado.'});
  return issues;
}
