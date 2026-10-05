// Módulo 13 — thumbnail: o frame mais expressivo + título.
// kamgasimo/thumbnail.mjs e openshorts/thumbnail.py (MIT): rosto presente, grande
// e centralizado, longe de cortes e transições, de preferência numa palavra forte.
import type {EditPlan} from '../plan/schema';
import {faceAt} from '../plan/camera';
import {placeClips, timelineToSource, timelineWords} from '../plan/timeline';
import {wordScore} from './captions';

/** melhor instante (segundos do vídeo final) para a capa */
export function bestThumbnailTime(plan: EditPlan): number {
  const placed = placeClips(plan.clips, plan.format.fps);
  const D = placed.at(-1)?.end ?? 0;
  if (D <= 0) return 0;
  const words = timelineWords(plan);
  let best = Math.min(1, D / 2);
  let bs = -Infinity;
  for (let t = 0.4; t < D * 0.85; t += 0.25) {
    const hit = timelineToSource(placed, t);
    if (!hit) continue;
    const cut = Math.min(t - hit.placed.start, hit.placed.end - t);
    if (cut < 0.3) continue; // perto de corte
    const f = faceAt(plan.faceTracks, hit.placed.clip.sourceId, hit.srcSec);
    let s = 0;
    if (f) {
      s += 3 - Math.abs(f.w - 0.32) * 6; // rosto grande, mas não colado
      s += 1.5 - Math.abs(f.cx - 0.5) * 4; // centralizado
      s += f.cy < 0.5 ? 1 : 0; // rosto no alto deixa espaço para o título
    }
    const w = words.find((x) => t >= x.start && t <= x.end + 0.15);
    if (w) s += Math.min(3, wordScore(w.text, 1) / 3); // falando uma palavra forte (boca/expressão)
    s -= t / D; // leve preferência pelo começo
    if (plan.broll.length || plan.overlays.length) {
      // evita momentos com B-roll em tela cheia por cima
      const busy = plan.broll.some((b) => b.template !== 'card' && b.sourceId === hit.placed.clip.sourceId && hit.srcSec >= b.start && hit.srcSec <= b.end);
      if (busy) s -= 5;
    }
    if (s > bs) {
      bs = s;
      best = t;
    }
  }
  return +best.toFixed(2);
}

/** título da capa: gancho do plano, senão a primeira frase (curta, caixa alta) */
export function coverTitle(plan: EditPlan, fallback?: string): string {
  if (fallback) return fallback;
  if (plan.hook?.title) return plan.hook.title;
  const ws = timelineWords(plan).slice(0, 12).map((w) => w.text);
  const firstSentence = ws.join(' ').split(/(?<=[.!?])\s/)[0] ?? '';
  const parts = firstSentence.replace(/[.!?]+$/, '').toUpperCase().split(/\s+/).slice(0, 6);
  const half = Math.ceil(parts.length / 2);
  return parts.length > 3 ? `${parts.slice(0, half).join(' ')}|${parts.slice(half).join(' ')}` : parts.join(' ');
}
