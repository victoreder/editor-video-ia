// Matemática da timeline: onde cada clipe cai no vídeo final e como projetar
// itens ancorados na fonte (sourceId + segundos da fonte) para o tempo do vídeo.
// Portado e ampliado de autobroll/src/timeline.ts + captions.ts (MIT).
import type {Clip, EditPlan, Keyframe, Word} from './schema';

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const smooth = (f: number) => f * f * (3 - 2 * f);

export const clipDurationSec = (c: Pick<Clip, 'inSec' | 'outSec' | 'speed'>) =>
  Math.max(0, (c.outSec - c.inSec) / (c.speed || 1));

export type PlacedClip = {
  clip: Clip;
  index: number;
  fromFrame: number;
  durFrames: number;
  start: number; // segundos no vídeo final
  end: number;
};

export function placeClips(clips: Clip[], fps: number): PlacedClip[] {
  let acc = 0;
  return clips.map((clip, index) => {
    const durFrames = Math.max(1, Math.round(clipDurationSec(clip) * fps));
    const fromFrame = acc;
    acc += durFrames;
    return {clip, index, fromFrame, durFrames, start: fromFrame / fps, end: (fromFrame + durFrames) / fps};
  });
}

export const totalDurationFrames = (clips: Clip[], fps: number): number =>
  Math.max(1, clips.reduce((sum, c) => sum + Math.max(1, Math.round(clipDurationSec(c) * fps)), 0));

export const planDurationFrames = (plan: Pick<EditPlan, 'clips' | 'format' | 'outro'>): number =>
  totalDurationFrames(plan.clips, plan.format.fps) + Math.round((plan.outro?.duration ?? 0) * plan.format.fps);

/** tempo da fonte → tempo do vídeo final, dentro de um clipe já posicionado */
export const srcToTimeline = (p: PlacedClip, srcSec: number) => p.start + (srcSec - p.clip.inSec) / (p.clip.speed || 1);

/** tempo do vídeo final → {clipe, tempo da fonte} */
export function timelineToSource(placed: PlacedClip[], t: number): {placed: PlacedClip; srcSec: number} | null {
  if (!placed.length) return null;
  const p = placed.find((x) => t >= x.start && t < x.end) ?? (t >= placed[placed.length - 1].end ? placed[placed.length - 1] : placed[0]);
  const srcSec = p.clip.inSec + (Math.min(Math.max(t, p.start), p.end) - p.start) * (p.clip.speed || 1);
  return {placed: p, srcSec};
}

/** Um ponto ancorado na fonte → tempo do vídeo (null se o trecho foi cortado). */
export function projectPoint(placed: PlacedClip[], sourceId: string, srcSec: number): number | null {
  for (const p of placed) {
    if (p.clip.sourceId !== sourceId) continue;
    if (srcSec >= p.clip.inSec - 1e-6 && srcSec < p.clip.outSec) return srcToTimeline(p, srcSec);
  }
  return null;
}

/**
 * Um intervalo ancorado na fonte → intervalo no vídeo. Se o intervalo atravessa
 * clipes consecutivos da mesma fonte (ex.: depois do autocut), ele continua
 * através deles. Retorna null quando todo o intervalo foi cortado.
 */
export function projectRange(
  placed: PlacedClip[],
  sourceId: string,
  start: number,
  end: number,
): {start: number; end: number; clipIndex: number} | null {
  const hits = placed.filter((p) => p.clip.sourceId === sourceId && start < p.clip.outSec && end > p.clip.inSec);
  if (!hits.length) return null;
  const first = hits[0];
  const a = srcToTimeline(first, Math.max(start, first.clip.inSec));
  // percorre os clipes adjacentes na timeline (sem buracos de outra fonte)
  let last = first;
  for (let i = first.index + 1; i < placed.length; i++) {
    const p = placed[i];
    if (!hits.includes(p)) break;
    last = p;
  }
  const b = srcToTimeline(last, Math.min(end, last.clip.outSec));
  if (b - a < 1 / 60) return null;
  return {start: a, end: b, clipIndex: first.index};
}

/** transformação nos keyframes manuais (smoothstep), mantida nas pontas */
export function sampleTransform(kfs: Keyframe[] | undefined, srcSec: number): {scale: number; x: number; y: number} {
  if (!kfs || kfs.length === 0) return {scale: 1, x: 0, y: 0};
  const pick = (k: Keyframe) => ({scale: k.scale, x: k.x, y: k.y});
  if (kfs.length === 1 || srcSec <= kfs[0].t) return pick(kfs[0]);
  const last = kfs[kfs.length - 1];
  if (srcSec >= last.t) return pick(last);
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (srcSec >= a.t && srcSec <= b.t) {
      const f = b.t === a.t ? 0 : smooth((srcSec - a.t) / (b.t - a.t));
      return {scale: lerp(a.scale, b.scale, f), x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f)};
    }
  }
  return pick(last);
}

export type TimelineWord = {text: string; start: number; end: number; sourceId: string; srcStart: number; srcEnd: number; index: number};

/** Palavras que sobrevivem aos cortes, já no tempo do vídeo final (o que a IA "ouve"). */
export function timelineWords(plan: Pick<EditPlan, 'clips' | 'words' | 'format'>): TimelineWord[] {
  const placed = placeClips(plan.clips, plan.format.fps);
  const out: TimelineWord[] = [];
  for (const p of placed) {
    const ws = plan.words.filter(
      (w) => w.sourceId === p.clip.sourceId && w.start >= p.clip.inSec - 0.05 && w.start < p.clip.outSec,
    );
    for (const w of ws) {
      out.push({
        text: w.text,
        start: srcToTimeline(p, Math.max(w.start, p.clip.inSec)),
        end: srcToTimeline(p, Math.min(w.end, p.clip.outSec)),
        sourceId: w.sourceId,
        srcStart: w.start,
        srcEnd: w.end,
        index: out.length,
      });
    }
  }
  return out;
}

/** converte um instante do vídeo final em âncora {sourceId, srcSec} */
export function anchorAt(plan: Pick<EditPlan, 'clips' | 'format'>, t: number): {sourceId: string; srcSec: number} | null {
  const hit = timelineToSource(placeClips(plan.clips, plan.format.fps), t);
  return hit ? {sourceId: hit.placed.clip.sourceId, srcSec: hit.srcSec} : null;
}

/** converte um intervalo do vídeo final em âncora (usa a fonte do início) */
export function anchorRange(plan: Pick<EditPlan, 'clips' | 'format'>, t0: number, t1: number) {
  const placed = placeClips(plan.clips, plan.format.fps);
  const a = timelineToSource(placed, t0);
  if (!a) return null;
  // o fim é medido dentro da mesma fonte, atravessando clipes adjacentes dela
  let remaining = t1 - t0;
  let p = a.placed;
  let src = a.srcSec;
  for (;;) {
    const room = (p.clip.outSec - src) / (p.clip.speed || 1);
    if (remaining <= room + 1e-6) {
      src += remaining * (p.clip.speed || 1);
      break;
    }
    const next = placed[p.index + 1];
    if (!next || next.clip.sourceId !== p.clip.sourceId) {
      src = p.clip.outSec;
      break;
    }
    remaining -= room;
    p = next;
    src = next.clip.inSec;
  }
  return {sourceId: a.placed.clip.sourceId, start: a.srcSec, end: Math.max(src, a.srcSec + 0.05)};
}

export const wordsOf = (words: Word[], sourceId: string) => words.filter((w) => w.sourceId === sourceId);
