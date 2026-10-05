// Módulo 13 — "post pack": legenda do post, gancho, hashtags e títulos por plataforma.
// Baseado em EverythingAI/ve_postpack.py (MIT). A IA escreve; sem IA, regras.
import {z} from 'zod';
import type {PostPack} from '../adapters/db/types';
import {normWord, wordScore} from './captions';

export const PostPackSchema = z.object({
  hook: z.string().describe('gancho curto para a capa/primeira linha (até 8 palavras)'),
  caption: z.string().describe('legenda do post em português, 2–4 frases, com 1 CTA no fim'),
  hashtags: z.array(z.string()).describe('5–10 hashtags relevantes, sem #'),
  platforms: z.object({instagram: z.string(), tiktok: z.string(), shorts: z.string()}).describe('texto pronto para colar em cada plataforma (tom e tamanho de cada uma)'),
  titles: z.array(z.string()).describe('3 opções de título para YouTube Shorts (até 60 caracteres)'),
});

export const POSTPACK_SYSTEM = `Você é social media de criadores brasileiros. A partir da transcrição de um vídeo curto, escreva o post que acompanha o vídeo.
Regras:
- Português do Brasil, natural, sem clichês ("você não vai acreditar"), sem prometer o que o vídeo não entrega.
- Gancho: a ideia mais forte do vídeo, em até 8 palavras.
- Instagram: 2–4 frases + CTA + hashtags no fim (5–10). TikTok: 1–2 frases curtas + 3–5 hashtags. Shorts: título forte + 1 frase.
- Use os termos e nomes exatamente como foram ditos.`;

const STOP = new Set('para pelo pela como mais muito isso esse essa este esta você voce vocês nosso nossa sobre quando onde porque então tudo cada fazer ter'.split(' '));

/** sem IA: gancho = frase mais forte; hashtags = palavras de maior peso */
export function heuristicPostPack(text: string): PostPack {
  const sents = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const scored = sents.map((s) => ({s, sc: s.split(/\s+/).reduce((n, w, i) => n + wordScore(w, i), 0) / Math.max(4, s.split(/\s+/).length)}));
  const best = scored.sort((a, b) => b.sc - a.sc)[0]?.s ?? sents[0] ?? '';
  const hook = best.replace(/[.!?]+$/, '').split(/\s+/).slice(0, 8).join(' ');
  const words = text.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w.length > 4 && !STOP.has(normWord(w)));
  const freq = new Map<string, number>();
  for (const w of words) freq.set(normWord(w), (freq.get(normWord(w)) ?? 0) + 1 + wordScore(w, 1) / 5);
  const tags = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([w]) => w);
  const hashtags = [...tags, 'reels', 'dicas'].slice(0, 9);
  const summary = sents.slice(0, 2).join(' ');
  const ht = (n: number) => hashtags.slice(0, n).map((h) => `#${h}`).join(' ');
  return {
    hook,
    caption: `${summary}\n\nSalva esse vídeo e manda pra quem precisa ver. 👇`,
    hashtags,
    platforms: {
      instagram: `${hook} 👇\n\n${summary}\n\nSalva pra ver depois e me segue pra mais.\n\n${ht(8)}`,
      tiktok: `${hook} ${ht(4)}`,
      shorts: `${hook}\n${sents[0] ?? ''}`,
    },
    titles: [hook, sents[0]?.replace(/[.!?]+$/, '') ?? hook, `${hook} (em 1 minuto)`].map((t) => t.slice(0, 60)),
  };
}
