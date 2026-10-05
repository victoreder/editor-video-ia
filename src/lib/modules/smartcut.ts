// Módulo 02 — corte inteligente.
// 1) RESPIROS: corta toda pausa/respirada maior que `minPause`, medida no ÁUDIO
//    (media/silence.ts) — a transcrição esconde pausas curtas.
// 2) ERROS E REPETIÇÕES: lê a transcrição e remove
//    - gaguejadas e repetições imediatas ("eu fui eu fui no mercado", "o o o", "mer- mercado");
//    - frases recomeçadas: a mesma frase dita de novo logo depois → fica a ÚLTIMA (mais fluente);
//    - começos abandonados ("Hoje eu vou… Hoje eu vou mostrar X");
//    - falas de bastidor ("pera", "corta", "vou de novo", "errei");
//    - "éé", "ãã", "hum".
//    A IA (quando há chave) revisa essas decisões por intervalo de palavras.
// Regras de take-selection.md / trim-silence.mjs / cutting.md (MIT), reescritas em PT-BR.
import type {Clip, Source, Word} from '../plan/schema';
import {normWord} from './captions';
import {uid} from '../util/id';

export type Aggressiveness = 'gentle' | 'medium' | 'tight';
export type CutOptions = {
  level: Aggressiveness;
  /** pausa mínima (s) cortada; padrão pelo nível (0,6 / 0,35 / 0,2) */
  minPause?: number;
  /** remove erros, repetições e falas de bastidor */
  removeMistakes?: boolean;
};
export type Removal = {from: number; to: number; reason: string}; // índices de palavras (inclusive)
export type CutReport = {
  keptSec: number;
  removedSec: number;
  pausesCut: number;
  pauseSec: number;
  removed: {text: string; start: number; end: number; sourceId: string; reason: string}[];
};

const LEVEL: Record<Aggressiveness, {minPause: number; lead: number; trail: number}> = {
  gentle: {minPause: 0.6, lead: 0.12, trail: 0.22},
  medium: {minPause: 0.35, lead: 0.08, trail: 0.16},
  tight: {minPause: 0.2, lead: 0.05, trail: 0.1},
};

// "é" sozinho é verbo; só conta como hesitação quando alongado ("éé") ou isolado por pausas
const FILLER = /^(éé+|ãã*|ah+|eh+|hum+|hm+|uh+|ahn+|ehn+)$/u;
const META = /\b(pera(í|ai)?|peraí|espera|corta|cortar|de novo|denovo|vou repetir|deixa eu repetir|repete|repetindo|errei|me perdi|ops|opa|calma|começar de novo|recomeça|recomeçar|vamos de novo|mais uma vez|não não não)\b/i;

const key = (w: Word) => normWord(w.text);
const ends = (w: Word) => /[.!?…]$/.test(w.text);

/** pausa (medida ou inferida) entre duas palavras consecutivas da mesma fonte */
function gapPause(a: Word, b: Word, pauses: Source['pauses']): number {
  if (a.sourceId !== b.sourceId) return Infinity;
  const gap = Math.max(0, b.start - a.end);
  if (!pauses?.length) return gap;
  // maior pausa medida dentro do intervalo entre as palavras (com 80 ms de folga)
  // o transcritor "estica" as palavras por cima das pausas: mede do meio de uma palavra ao meio da outra
  const lo = (a.start + a.end) / 2;
  const hi = (b.start + b.end) / 2;
  let best = 0;
  for (const p of pauses) {
    if (p.end <= lo || p.start >= hi) continue;
    best = Math.max(best, Math.min(p.end, hi) - Math.max(p.start, lo));
  }
  return Math.max(best, gap > 1.2 ? gap : 0);
}

export type Phrase = {from: number; to: number};

/** divide em frases: pontuação final, pausa ≥ 0,35 s ou troca de fonte */
export function phrases(words: Word[], pausesBySource: Map<string, Source['pauses']>): Phrase[] {
  const out: Phrase[] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    const brk = !next || ends(words[i]) || gapPause(words[i], next, pausesBySource.get(words[i].sourceId)) >= 0.35 || /,$/.test(words[i].text) && next && META.test(next.text);
    if (brk) {
      out.push({from, to: i});
      from = i + 1;
    }
  }
  return out;
}

const textOf = (words: Word[], p: Phrase) => words.slice(p.from, p.to + 1).map(key).filter(Boolean);

function similarity(a: string[], b: string[]): number {
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
  return inter / Math.min(A.size, B.size);
}

/** remoções por regras (palavra a palavra e frase a frase) */
export function detectMistakes(words: Word[], pausesBySource: Map<string, Source['pauses']>, level: Aggressiveness): Removal[] {
  const rm: Removal[] = [];
  const n = words.length;
  // 1. "éé", "hum" (no nível suave ficam)
  if (level !== 'gentle')
    words.forEach((w, i) => {
      const t = w.text.toLowerCase().replace(/[^\p{L}]/gu, '');
      const isolated = t === 'é' && words[i - 1] && words[i + 1] && w.start - words[i - 1].end >= 0.3 && words[i + 1].start - w.end >= 0.3 && !/[.!?]$/.test(w.text);
      if (FILLER.test(t) || isolated) rm.push({from: i, to: i, reason: 'hesitação ("éé")'});
    });
  // 2. gaguejada de palavra cortada: "mer- mercado", "pro- produto"
  for (let i = 0; i < n - 1; i++) {
    const a = key(words[i]);
    const b = key(words[i + 1]);
    if (a.length >= 2 && a !== b && b.startsWith(a) && (/-$/.test(words[i].text) || a.length <= b.length - 2) && words[i].sourceId === words[i + 1].sourceId)
      rm.push({from: i, to: i, reason: 'palavra começada e refeita'});
  }
  // 3. repetição imediata de 1 a 8 palavras: "eu fui eu fui no mercado" → remove a 1ª cópia
  for (let size = 8; size >= 1; size--) {
    for (let i = 0; i + 2 * size <= n; i++) {
      let same = true;
      for (let k = 0; k < size && same; k++) same = key(words[i + k]) === key(words[i + size + k]) && key(words[i + k]) !== '';
      if (!same || words[i].sourceId !== words[i + size].sourceId) continue;
      // "muito muito", "bem bem" sem pausa são ênfase, não erro
      if (size === 1 && words[i + 1].start - words[i].end < 0.12 && /^(muito|bem|mais|não|nao|sim|tá|ta)$/.test(key(words[i]))) continue;
      rm.push({from: i, to: i + size - 1, reason: size === 1 ? 'gaguejada' : 'trecho repetido'});
    }
  }
  // 4. frases: bastidor, recomeço e repetição (fica a última versão)
  const ps = phrases(words, pausesBySource);
  ps.forEach((p, pi) => {
    const t = textOf(words, p);
    const raw = words.slice(p.from, p.to + 1).map((w) => w.text).join(' ');
    if (META.test(raw) && t.length <= 8) {
      rm.push({from: p.from, to: p.to, reason: 'fala de bastidor ("pera", "de novo"…)'});
      return;
    }
    for (let qi = pi + 1; qi <= Math.min(ps.length - 1, pi + 4); qi++) {
      const q = ps[qi];
      if (words[q.from].sourceId !== words[p.from].sourceId) break;
      const u = textOf(words, q);
      if (!t.length || !u.length) continue;
      const k = Math.min(3, t.length);
      const restart = t.length >= 2 && u.length >= k && t.slice(0, k).every((w, j) => w === u[j]);
      const repeated = t.length >= 3 && similarity(t, u) >= 0.6;
      // começo abandonado: frase curta e sem ponto final, recomeçada logo depois
      const abandoned = !ends(words[p.to]) && t.length <= 6 && u.length > t.length && u.slice(0, Math.min(2, t.length)).every((w, j) => w === t[j]);
      // anáfora intencional ("Você precisa de foco. Você precisa de disciplina."): frases completas
      // que terminam diferente ficam as duas
      const deliberate = ends(words[p.to]) && t.length >= 4 && !u.includes(t[t.length - 1]);
      if ((restart || repeated || abandoned) && !deliberate) {
        rm.push({from: p.from, to: p.to, reason: abandoned ? 'começo abandonado' : 'frase dita de novo (ficou a última)'});
        return;
      }
    }
  });
  return rm;
}

/** aplica as remoções e corta as pausas: devolve os clipes (trechos mantidos) */
export function buildCuts(sources: Source[], words: Word[], removals: Removal[], opts: CutOptions): {clips: Clip[]; report: CutReport} {
  const cfg = {...LEVEL[opts.level], ...(opts.minPause ? {minPause: opts.minPause} : {})};
  const removed = new Map<number, string>();
  for (const r of removals) for (let i = Math.max(0, r.from); i <= Math.min(words.length - 1, r.to); i++) if (!removed.has(i)) removed.set(i, r.reason);
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const pausesBy = new Map(sources.map((s) => [s.id, s.pauses]));
  const clips: Clip[] = [];
  let pausesCut = 0;
  let pauseSec = 0;

  for (const s of sources) {
    const idx = words.map((w, i) => [w, i] as const).filter(([w]) => w.sourceId === s.id);
    if (!idx.length) {
      // sem fala (B-roll gravado, por exemplo) → entra inteiro
      clips.push({id: uid('clip'), sourceId: s.id, inSec: 0, outSec: s.duration, speed: 1, volume: 1, muted: false, baseZoom: 1, label: s.name});
      continue;
    }
    // trechos contínuos de palavras mantidas, quebrando em remoções e em pausas ≥ minPause
    const runs: number[][] = [];
    let cur: number[] = [];
    for (let k = 0; k < idx.length; k++) {
      const [w, i] = idx[k];
      if (removed.has(i)) {
        if (cur.length) runs.push(cur);
        cur = [];
        continue;
      }
      if (cur.length) {
        const prev = words[cur[cur.length - 1]];
        const p = gapPause(prev, w, s.pauses);
        if (p >= cfg.minPause) {
          runs.push(cur);
          cur = [];
          pausesCut++;
          pauseSec += p;
        }
      }
      cur.push(i);
    }
    if (cur.length) runs.push(cur);

    const allWords = idx.map(([w]) => w);
    for (const r of runs) {
      const first = words[r[0]];
      const last = words[r[r.length - 1]];
      // vizinhos (mantidos ou não): o corte nunca invade outra palavra
      const prevWord = allWords.filter((w) => w.end <= first.start + 1e-6 && w !== first).at(-1);
      const nextWord = allWords.find((w) => w.start >= last.end - 1e-6 && w !== last);
      let a = first.start - cfg.lead;
      let b = last.end + cfg.trail;
      // ajuste fino pelo áudio: entra logo no começo do som e sai quando o som acaba
      // (as palavras vêm "esticadas" por cima das pausas, então procura a partir do meio delas)
      const pauses = s.pauses ?? [];
      // uma palavra tem pelo menos ~0,1 s de som; o resto do intervalo dela pode ser pausa
      const before = [...pauses].reverse().find((p) => p.end >= first.start - 0.4 && p.end <= first.end - 0.1 && p.end - p.start >= 0.08);
      const after = pauses.find((p) => p.start >= last.start + 0.1 && p.start <= last.end + 0.5 && p.end - p.start >= 0.08);
      if (before) a = Math.max(before.start, before.end - 0.04);
      else a = Math.max(a, prevWord ? prevWord.end + 0.01 : 0);
      if (after) b = Math.min(after.end, after.start + 0.06);
      else b = Math.min(b, nextWord ? nextWord.start - 0.01 : s.duration);
      a = Math.max(0, a);
      b = Math.min(s.duration, b);
      if (b - a < 0.25) continue;
      const label = r.slice(0, 4).map((i) => words[i].text).join(' ');
      clips.push({id: uid('clip'), sourceId: s.id, inSec: +a.toFixed(3), outSec: +b.toFixed(3), speed: 1, volume: 1, muted: false, baseZoom: 1, label: `${label}…`});
    }
  }
  // junta clipes quase colados da mesma fonte (sem corte visível)
  const merged: Clip[] = [];
  for (const c of clips) {
    const last = merged[merged.length - 1];
    if (last && last.sourceId === c.sourceId && c.inSec - last.outSec >= 0 && c.inSec - last.outSec < 0.06) last.outSec = c.outSec;
    else merged.push({...c});
  }
  merged.forEach((c, i) => (c.label = `${i + 1}. ${c.label?.replace(/^\d+\.\s*/, '') ?? ''}`));

  const keptSec = merged.reduce((n, c) => n + c.outSec - c.inSec, 0);
  const total = sources.reduce((n, s) => n + s.duration, 0);
  // relatório: o que foi removido (frases inteiras agrupadas)
  const removedList: CutReport['removed'] = [];
  let k = 0;
  const sorted = [...removed.keys()].sort((x, y) => x - y);
  while (k < sorted.length) {
    let j = k;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1 && words[sorted[j + 1]].sourceId === words[sorted[k]].sourceId) j++;
    const ws = sorted.slice(k, j + 1).map((i) => words[i]);
    removedList.push({text: ws.map((w) => w.text).join(' '), start: ws[0].start, end: ws[ws.length - 1].end, sourceId: ws[0].sourceId, reason: removed.get(sorted[k])!});
    k = j + 1;
  }
  return {clips: merged, report: {keptSec: +keptSec.toFixed(2), removedSec: +(total - keptSec).toFixed(2), pausesCut, pauseSec: +pauseSec.toFixed(2), removed: removedList}};
}

/** corte completo por regras: respiros + erros/repetições */
export function smartCut(sources: Source[], words: Word[], opts: CutOptions) {
  const pausesBy = new Map(sources.map((s) => [s.id, s.pauses]));
  const removals = opts.removeMistakes === false ? [] : detectMistakes(words, pausesBy, opts.level);
  return {...buildCuts(sources, words, removals, opts), removals};
}

// ---------------------------------------------------------------- IA

/** transcrição numerada com as pausas marcadas, para a IA decidir o que remover */
export function transcriptForCut(words: Word[], sources: Source[]): string {
  const pausesBy = new Map(sources.map((s) => [s.id, s.pauses]));
  const name = new Map(sources.map((s) => [s.id, s.name]));
  const lines: string[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (!prev || prev.sourceId !== w.sourceId) lines.push(`\n=== arquivo ${name.get(w.sourceId) ?? w.sourceId} ===`);
    else {
      const p = gapPause(prev, w, pausesBy.get(w.sourceId));
      if (p >= 0.3) lines.push(`[pausa ${p.toFixed(1)} s]`);
    }
    lines.push(`${i}|${w.text}`);
  });
  return lines.join('\n');
}

export {LEVEL as CUT_LEVELS};
