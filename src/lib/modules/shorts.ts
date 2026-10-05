// Módulo 13 — vídeo longo → Shorts: os momentos que funcionam sozinhos, ranqueados.
// Portado de kamgasimo/moments.mjs + rubrica de gancho do ve_shorts.py e o
// "viral score" do ve_virality.py (MIT), com regras em PT-BR. Um momento é uma
// sequência de frases inteiras entre min e max segundos, pontuada por:
//   gancho       a 1ª frase prende (pergunta, número, "você", palavra forte, curta)
//   independente não começa apontando para trás ("e", "mas", "então", "isso"…)
//   desfecho     termina num ponto final/exclamação, de preferência numa conclusão
//   energia      densidade de fala e eventos de áudio (risadas/aplausos)
import type {Moment} from '../adapters/db/types';
import type {Word} from '../plan/schema';
import {normWord} from './captions';

const POWER = /\b(segredo|erro|erros|nunca|sempre|melhor|pior|grátis|gratis|dinheiro|rápido|fácil|simples|verdade|errado|ninguém|todo mundo|pare|como|por que|porque|maior|único|ninguem|mentira|cuidado)\b/i;
const DANGLING = /^(e|mas|então|entao|porque|também|tambem|isso|essa|esse|esses|essas|ele|ela|eles|elas|aí|ai|daí|dai|ou|que)$/i;
const PAYOFF = /\b(por isso|o segredo|lembre|então se você|o ponto|resumindo|no fim|é assim que|foi assim que|a chave|moral da história)\b/i;
const HOOKS = [
  /\?$/, // pergunta
  /\b(você|voce)\b/i, // fala com quem assiste
  /\d/, // número
  /\b(ninguém te conta|ninguem te conta|o que ninguém|pare de|não faça|nao faca|o maior erro)\b/i, // contrarian
];

export type Sentence = {words: Word[]; text: string; start: number; end: number; sourceId: string};

export function sentencesFrom(words: Word[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({words: cur, text: cur.map((w) => w.text).join(' '), start: cur[0].start, end: cur[cur.length - 1].end, sourceId: cur[0].sourceId});
    cur = [];
  };
  for (const w of words) {
    if (cur.length && (w.sourceId !== cur[0].sourceId || w.start - cur[cur.length - 1].end > 1.2)) flush();
    cur.push(w);
    if (/[.?!…]$/.test(w.text)) flush();
  }
  flush();
  return out;
}

export function findMoments(words: Word[], opts: {count?: number; min?: number; max?: number; events?: {start: number; end: number; text: string}[]} = {}): Moment[] {
  const {count = 5, min = 20, max = 60, events = []} = opts;
  const sents = sentencesFrom(words);
  const cands: Moment[] = [];
  for (let i = 0; i < sents.length; i++) {
    for (let j = i; j < sents.length; j++) {
      if (sents[j].sourceId !== sents[i].sourceId) break;
      const start = sents[i].start;
      const end = sents[j].end;
      const d = end - start;
      if (d > max) break;
      if (d < min) continue;
      const first = sents[i].text;
      const last = sents[j].text;
      const n = sents.slice(i, j + 1).reduce((s, x) => s + x.words.length, 0);
      let score = 0;
      const why: string[] = [];
      if (/\?$/.test(first)) (score += 3), why.push('abre com pergunta');
      if (/\d/.test(first)) (score += 2), why.push('número logo de cara');
      if (/\b(você|voce)\b/i.test(first)) (score += 1), why.push('fala com quem assiste');
      if (POWER.test(first)) (score += 1.5), why.push('palavra forte na abertura');
      if (HOOKS[3].test(first)) (score += 1.5), why.push('gancho contrário');
      if (sents[i].words.length <= 12) (score += 1), why.push('primeira frase curta');
      if (DANGLING.test(normWord(sents[i].words[0].text))) (score -= 3), why.push('começa apontando para trás');
      if (/[.!]$/.test(last)) score += 1;
      const whole = sents.slice(i, j + 1).map((s) => s.text).join(' ');
      if (PAYOFF.test(last) || PAYOFF.test(whole)) (score += 1.5), why.push('fecha com conclusão');
      const laughs = events.filter((e) => e.start >= start && e.end <= end && /(ri|laugh|aplau|applause)/i.test(e.text)).length;
      if (laughs) (score += Math.min(2, laughs)), why.push(`${laughs} reação(ões) da plateia`);
      score += Math.min(2, n / d / 1.5); // energia (palavras por segundo)
      score += 1 - Math.min(1, Math.abs(d - 35) / 25); // duração perto de 35 s
      const title = first.replace(/[.!?…]+$/, '').split(/\s+/).slice(0, 7).join(' ');
      cands.push({start: +start.toFixed(2), end: +end.toFixed(2), score: +score.toFixed(2), why, title, sourceId: sents[i].sourceId});
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const picked: Moment[] = [];
  for (const c of cands) {
    if (picked.length >= count) break;
    if (picked.every((p) => p.sourceId !== c.sourceId || c.end <= p.start || c.start >= p.end)) picked.push(c);
  }
  return picked.sort((a, b) => a.start - b.start);
}
