// Módulo 02 — corte inteligente e escolha de takes.
// Parte mecânica: autocut por pausas (autobroll/trim-silence.mjs), detecção de
// takes repetidos (o mesmo trecho falado duas vezes → fica o mais tardio e
// fluente, regra do talking-head-reel/take-selection.md) e validação para nunca
// cortar no meio de uma palavra. A IA pode substituir a escolha de takes.
import type {Clip, Source, Word} from '../plan/schema';
import {normWord} from './captions';
import {uid} from '../util/id';

export type Aggressiveness = 'gentle' | 'medium' | 'tight';

const LEVELS: Record<Aggressiveness, {gap: number; lead: number; trail: number; inner: number}> = {
  gentle: {gap: 0.9, lead: 0.15, trail: 0.35, inner: 0.15},
  medium: {gap: 0.6, lead: 0.12, trail: 0.3, inner: 0.1},
  tight: {gap: 0.35, lead: 0.08, trail: 0.22, inner: 0.06},
};

const FILLERS = new Set(['é', 'éé', 'ééé', 'ã', 'ãã', 'hum', 'hmm', 'ahn', 'ah', 'eh', 'uh', 'um', 'tipo', 'né']);
const isFiller = (t: string) => {
  const n = t.toLowerCase().replace(/[^\p{L}]/gu, '');
  return FILLERS.has(n) || /^(e|a|ã|h)\1{1,}$/u.test(n) || /^h+m+$/u.test(n);
};

export type Segment = {sourceId: string; inSec: number; outSec: number; words: Word[]};

/** separa a fala de uma fonte em trechos contínuos, cortando pausas e "éé" */
export function speechSegments(words: Word[], source: Pick<Source, 'id' | 'duration'>, level: Aggressiveness = 'medium'): Segment[] {
  const cfg = LEVELS[level];
  const ws = words.filter((w) => w.sourceId === source.id && !(level !== 'gentle' && isFiller(w.text)));
  if (!ws.length) return [];
  const runs: Word[][] = [];
  let cur: Word[] = [ws[0]];
  for (let i = 1; i < ws.length; i++) {
    if (ws[i].start - ws[i - 1].end > cfg.gap) {
      runs.push(cur);
      cur = [];
    }
    cur.push(ws[i]);
  }
  runs.push(cur);
  return runs
    .map((r, i) => {
      const prevEnd = i > 0 ? runs[i - 1][runs[i - 1].length - 1].end : 0;
      const nextStart = i < runs.length - 1 ? runs[i + 1][0].start : source.duration;
      const lead = i === 0 ? cfg.lead : cfg.inner;
      const trail = i === runs.length - 1 ? cfg.trail : cfg.inner;
      return {
        sourceId: source.id,
        // nunca entra na palavra vizinha
        inSec: Math.max(0, prevEnd, r[0].start - lead),
        outSec: Math.min(source.duration, nextStart, r[r.length - 1].end + trail),
        words: r,
      };
    })
    .filter((s) => s.outSec - s.inSec >= 0.35);
}

// ---------------------------------------------------------------- takes repetidos

const sentenceKey = (ws: Word[]) => ws.map((w) => normWord(w.text)).filter(Boolean);

/** similaridade de Jaccard por bigramas de palavras (robusta a pequenas variações) */
export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const grams = (x: string[]) => {
    const s = new Set<string>();
    if (x.length === 1) s.add(x[0]);
    for (let i = 0; i < x.length - 1; i++) s.add(`${x[i]} ${x[i + 1]}`);
    return s;
  };
  const A = grams(a);
  const B = grams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** começo abandonado: o trecho é o início de um trecho seguinte ("Hoje eu vou..." → "Hoje eu vou mostrar X") */
const isFalseStart = (a: string[], b: string[]) => a.length >= 2 && a.length < b.length && a.every((w, i) => b[i] === w);

/**
 * Detecta takes repetidos: quando um trecho se repete (similaridade > 0,5) ou é
 * um começo abandonado de um trecho logo depois, fica o MAIS TARDIO (as pessoas
 * esquentam) — ou o mais fluente, quando o tardio tem muito mais pausas.
 */
export function dropRetakes(segments: Segment[], lookahead = 4): {kept: Segment[]; dropped: Segment[]} {
  const drop = new Set<number>();
  for (let i = 0; i < segments.length; i++) {
    if (drop.has(i)) continue;
    const a = sentenceKey(segments[i].words);
    for (let j = i + 1; j < Math.min(segments.length, i + 1 + lookahead); j++) {
      const b = sentenceKey(segments[j].words);
      if (similarity(a, b) > 0.5 || isFalseStart(a, b)) {
        drop.add(i);
        break;
      }
    }
  }
  return {kept: segments.filter((_, i) => !drop.has(i)), dropped: segments.filter((_, i) => drop.has(i))};
}

/** junta trechos muito próximos da mesma fonte (mantém "runs" contínuas: um corte em vez de quatro) */
export function mergeClose(segments: Segment[], maxGap = 0.25): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.sourceId === s.sourceId && s.inSec - last.outSec <= maxGap && s.inSec >= last.inSec) {
      last.outSec = s.outSec;
      last.words = [...last.words, ...s.words];
    } else out.push({...s, words: [...s.words]});
  }
  return out;
}

export function segmentsToClips(segments: Segment[]): Clip[] {
  return segments.map((s, i) => ({
    id: uid('clip'),
    sourceId: s.sourceId,
    inSec: +s.inSec.toFixed(3),
    outSec: +s.outSec.toFixed(3),
    speed: 1,
    volume: 1,
    muted: false,
    baseZoom: 1,
    label: `${i + 1}. ${s.words.slice(0, 4).map((w) => w.text).join(' ')}…`,
  }));
}

/** Corte automático completo: pausas + takes repetidos, fonte por fonte na ordem enviada. */
export function autoCut(sources: Source[], words: Word[], level: Aggressiveness = 'medium', removeRetakes = true): {clips: Clip[]; droppedSec: number} {
  let segs: Segment[] = [];
  for (const s of sources) {
    const sw = words.filter((w) => w.sourceId === s.id);
    if (!sw.length) {
      // sem fala (ex.: B-roll gravado) → entra inteiro
      segs.push({sourceId: s.id, inSec: 0, outSec: s.duration, words: []});
      continue;
    }
    segs.push(...speechSegments(sw, s, level));
  }
  let dropped: Segment[] = [];
  if (removeRetakes) ({kept: segs, dropped} = dropRetakes(segs));
  segs = mergeClose(segs);
  const droppedSec = dropped.reduce((n, s) => n + s.outSec - s.inSec, 0);
  return {clips: segmentsToClips(segs), droppedSec};
}

/** Garante que nenhum corte cai no meio de uma palavra (move a borda para fora da palavra). */
export function snapClipsToWords(clips: Clip[], words: Word[]): Clip[] {
  return clips.map((c) => {
    const ws = words.filter((w) => w.sourceId === c.sourceId);
    let inSec = c.inSec;
    let outSec = c.outSec;
    for (const w of ws) {
      if (inSec > w.start && inSec < w.end) inSec = Math.max(0, w.start - 0.08);
      if (outSec > w.start && outSec < w.end) outSec = w.end + 0.12;
    }
    return {...c, inSec: +inSec.toFixed(3), outSec: +Math.max(outSec, inSec + 0.2).toFixed(3)};
  });
}
