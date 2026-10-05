// Módulo 03 — legendas: correção por glossário, blocos de 2–4 palavras,
// destaques (heurística; a IA pode sobrescrever), emoji ocasional e SRT.
// Baseado em kamgasimo/captions.mjs, autobroll/captions-multiclip.mjs e
// motion-script/correct-captions.mjs (MIT), reescrito para PT-BR.
import type {CaptionChunk, EditPlan, Word} from '../plan/schema';
import {getStyle} from '../styles';
import {placeClips, srcToTimeline, timelineWords} from '../plan/timeline';
import {uid} from '../util/id';

export const normWord = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}%$]/gu, '');

// ---------------------------------------------------------------- correção

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({length: b.length + 1}, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
const similarRatio = (a: string, b: string) => 1 - levenshtein(a, b) / Math.max(a.length, b.length);

/** Substitui sequências que batem com o glossário (inclusive nome quebrado em 2–3 palavras). */
export function applyGlossary(words: Word[], glossary: string[], fixes: Record<string, string> = {}): Word[] {
  const rules = [
    ...glossary.map((g) => ({from: g.split(/\s+/).map(normWord).filter(Boolean), to: g})),
    ...Object.entries(fixes).map(([heard, right]) => ({from: heard.split(/\s+/).map(normWord).filter(Boolean), to: right})),
  ].filter((r) => r.from.length && r.to);
  if (!rules.length) return words;
  const lead = (t: string) => t.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
  const trail = (t: string) => t.match(/[^\p{L}\p{N}%']*$/u)?.[0] ?? '';
  const out: Word[] = [];
  for (let i = 0; i < words.length; ) {
    let hit: {n: number; to: string} | null = null;
    for (const r of rules) {
      const n = r.from.length;
      if (i + n <= words.length && r.from.every((k, j) => normWord(words[i + j].text) === k && words[i + j].sourceId === words[i].sourceId)) {
        hit = {n, to: r.to};
        break;
      }
      // nome quebrado em 2–3 palavras ("super base" → "Supabase") ou quase igual ("cloude" → "Claude")
      const joined = r.from.join('');
      for (let m = r.from.length === 1 ? 1 : 2; m <= 3 && !hit; m++) {
        if (i + m > words.length) break;
        const got = words.slice(i, i + m).map((w) => normWord(w.text)).join('');
        if (got === joined || (joined.length >= 5 && got[0] === joined[0] && similarRatio(got, joined) >= (m > 1 ? 0.75 : 0.8))) hit = {n: m, to: r.to};
      }
      if (hit) break;
    }
    if (!hit) {
      out.push({...words[i]});
      i++;
      continue;
    }
    const first = words[i];
    const last = words[i + hit.n - 1];
    out.push({...first, text: lead(first.text) + hit.to + trail(last.text), end: last.end});
    i += hit.n;
  }
  return out;
}

// ---------------------------------------------------------------- blocos

// palavras "cola" do português: um bloco nunca termina nelas
const GLUE = new Set(
  'a o as os um uma uns umas de do da dos das no na nos nas em e ou mas que se por pra para com sem ao aos à às é foi era meu minha seu sua teu tua nosso nossa eu tu ele ela nós vocês você eles elas me te lhe mais muito como quando onde porque the and of to a an'.split(
    ' ',
  ),
);
const SENT_END = /[.!?…]$/;
const CLAUSE_END = /[,;:]$/;

export function shownText(text: string, upper: boolean) {
  const core = text.replace(/^[^\p{L}\p{N}$#@]+/u, '').replace(/[^\p{L}\p{N}%'?!]+$/u, '');
  return upper ? core.toLocaleUpperCase('pt-BR') : core;
}

/**
 * Agrupa as palavras de UMA fonte em blocos. Quebra em pontuação, em pausas
 * > 0,45 s e ao atingir maxWords (devolvendo a palavra-cola para o próximo bloco).
 */
export function chunkWords(words: Word[], opts: {maxWords: number; upper: boolean; gapSec?: number}): CaptionChunk[] {
  const gap = opts.gapSec ?? 0.45;
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur.length && (w.sourceId !== cur[0].sourceId || w.start - cur[cur.length - 1].end > gap)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
    if (SENT_END.test(w.text) || (CLAUSE_END.test(w.text) && cur.length >= 2)) {
      groups.push(cur);
      cur = [];
    } else if (cur.length >= opts.maxWords) {
      const tail = cur[cur.length - 1];
      const carry = cur.length > 1 && GLUE.has(normWord(tail.text)) ? [cur.pop()!] : [];
      groups.push(cur);
      cur = carry;
    }
  }
  if (cur.length) groups.push(cur);
  return groups
    .map((g) => {
      const ws = g
        .map((w) => ({text: shownText(w.text, opts.upper), start: w.start, end: w.end, accent: false}))
        .filter((w) => w.text);
      return {
        id: uid('cap'),
        sourceId: g[0].sourceId,
        start: g[0].start,
        // o bloco nunca fica mais de 1,2 s depois do início da última palavra
        end: Math.min(g[g.length - 1].end + 0.25, g[g.length - 1].start + 1.2),
        words: ws,
      } satisfies CaptionChunk;
    })
    .filter((c) => c.words.length);
}

// ---------------------------------------------------------------- destaques e emoji

const STOP = new Set(
  'a o as os um uma de do da dos das no na nos nas em e ou mas que se por pra para com sem ao à é foi era ser ter tem tinha vai vou isso isto esse essa este esta aquele aquela eu tu ele ela nós você vocês eles elas me te se lhe meu minha seu sua nosso nossa muito mais menos já não sim também só então aí lá aqui assim tipo né coisa coisas gente cara bem bom'.split(
    ' ',
  ),
);
const POWER = new Set(
  'nunca sempre melhor pior agora hoje novo nova rápido fácil simples enorme único única primeiro último dinheiro lucro vendas clientes erro erros segredo grátis gratuito incrível absurdo resultado resultados crescimento ia inteligência automação viral sucesso milhões milhão mil'.split(
    ' ',
  ),
);

export function wordScore(text: string, index: number): number {
  const n = normWord(text);
  if (!n || n.length < 2 || STOP.has(n)) return 0;
  if (/\d/.test(n)) return 9;
  if (POWER.has(n)) return 7;
  if (index > 0 && /^\p{Lu}/u.test(text.trim()) && n.length > 2) return 6; // nome próprio / marca
  return n.length >= 7 ? 2 + n.length / 10 : 0;
}

export const EMOJI_PT: Record<string, string> = {
  dinheiro: '💰', lucro: '💰', vendas: '📈', venda: '📈', crescimento: '📈', resultado: '📊', resultados: '📊',
  ideia: '💡', ideias: '💡', tempo: '⏰', rapido: '⚡', fogo: '🔥', viral: '🔥', incrivel: '🤯', absurdo: '🤯',
  erro: '❌', erros: '❌', certo: '✅', segredo: '🤫', ia: '🤖', robo: '🤖', automacao: '⚙️', foguete: '🚀',
  sucesso: '🏆', coracao: '❤️', amor: '❤️', clientes: '🤝', cliente: '🤝', celular: '📱', video: '🎬', dica: '👉',
  atencao: '⚠️', cuidado: '⚠️', meta: '🎯', objetivo: '🎯', mundo: '🌍', estudo: '📚', livro: '📚', trabalho: '💼',
  empresa: '🏢', negocio: '💼', grátis: '🎁', gratis: '🎁', presente: '🎁', feliz: '😄', triste: '😢', medo: '😱',
};

/** marca destaques (1 por bloco no máximo, respeitando a taxa do estilo) e emojis espaçados */
export function decorateChunks(chunks: CaptionChunk[], opts: {emphasisRate: number; emojiEvery: number}): CaptionChunk[] {
  const totalWords = chunks.reduce((n, c) => n + c.words.length, 0);
  const budget = Math.max(1, Math.round(totalWords * opts.emphasisRate));
  const scored = chunks
    .map((c, ci) => {
      let best = -1;
      let bs = 0;
      c.words.forEach((w, i) => {
        const s = wordScore(w.text, i + ci);
        if (s > bs) {
          bs = s;
          best = i;
        }
      });
      return {ci, best, bs};
    })
    .filter((x) => x.best >= 0 && x.bs >= 2.6)
    .sort((a, b) => b.bs - a.bs)
    .slice(0, budget);
  const pick = new Map(scored.map((s) => [s.ci, s.best]));
  let lastEmoji = -999;
  return chunks.map((c, ci) => {
    const bi = pick.get(ci);
    const words = c.words.map((w, i) => ({...w, accent: i === bi}));
    let emoji = c.emoji;
    if (!emoji && opts.emojiEvery > 0 && bi !== undefined && ci - lastEmoji >= opts.emojiEvery) {
      const e = EMOJI_PT[normWord(words[bi].text)];
      if (e) {
        emoji = e;
        lastEmoji = ci;
      }
    }
    return {...c, words, emoji};
  });
}

/** Gera as legendas do plano a partir das palavras e dos clipes atuais. */
export function buildCaptions(plan: Pick<EditPlan, 'words' | 'clips' | 'style' | 'format'>): CaptionChunk[] {
  const style = getStyle(plan.style);
  // só palavras que sobrevivem aos cortes (as cortadas não viram legenda)
  const kept = timelineWords(plan).map((tw) => plan.words.find((w) => w.sourceId === tw.sourceId && w.start === tw.srcStart)!);
  const chunks = chunkWords(kept.filter(Boolean), {maxWords: style.captions.maxWords, upper: style.captions.uppercase});
  return decorateChunks(chunks, {emphasisRate: style.captions.emphasisRate, emojiEvery: style.captions.emojiEvery});
}

// ---------------------------------------------------------------- SRT

const srtTime = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** SRT no tempo do vídeo final: frases quebradas em linhas de até 42 caracteres. */
export function toSrt(plan: Pick<EditPlan, 'words' | 'clips' | 'format'>, maxChars = 42): string {
  const words = timelineWords(plan);
  const cues: {start: number; end: number; text: string}[] = [];
  let cur: typeof words = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' ')});
    cur = [];
  };
  for (const w of words) {
    const len = [...cur, w].map((x) => x.text).join(' ').length;
    if (cur.length && (len > maxChars || w.start - cur[cur.length - 1].end > 0.8)) flush();
    cur.push(w);
    if (SENT_END.test(w.text)) flush();
  }
  flush();
  return cues
    .map((c, i) => {
      const next = cues[i + 1]?.start ?? c.end + 1;
      const end = Math.min(next, Math.max(c.end + 0.2, c.start + 0.6));
      return `${i + 1}\n${srtTime(c.start)} --> ${srtTime(end)}\n${c.text}\n`;
    })
    .join('\n');
}

/** legendas projetadas para o vídeo final (usado pelo QA e pelo safezone) */
export function projectedCaptionTimes(plan: Pick<EditPlan, 'captions' | 'clips' | 'format'>) {
  const placed = placeClips(plan.clips, plan.format.fps);
  return plan.captions.chunks.flatMap((c) => {
    const p = placed.find((x) => x.clip.sourceId === c.sourceId && c.start >= x.clip.inSec - 0.05 && c.start < x.clip.outSec);
    if (!p) return [];
    return [{chunk: c, t0: srcToTimeline(p, Math.max(c.start, p.clip.inSec)), t1: srcToTimeline(p, Math.min(c.end, p.clip.outSec)), placed: p}];
  });
}
