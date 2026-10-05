// Módulo 06 — busca de assets para o B-roll.
// Ordem (autobroll/broll-multiclip.mjs): 1) a SUA biblioteca (pasta "library/"
// no storage, com tags), 2) Pexels (vídeo, depois foto), 3) imagem por IA.
// Guarda alternativas para trocar com 1 clique no editor.
import {z} from 'zod';
import {config} from '../config';
import type {BrollSegment, EditPlan} from '../plan/schema';
import {getStorage} from '../adapters/storage';
import {getImageGen} from '../adapters/imagegen';
import {getVideoGen} from '../adapters/videogen';
import {normWord} from './captions';
import type {Director} from '../adapters/director';

export type LibraryAsset = {key: string; kind: 'video' | 'image'; tags: string[]; name: string};

type PexelsVideo = {id: number; width: number; height: number; duration: number; image?: string; user?: {name: string}; video_files: {link: string; width: number; height: number; quality: string; file_type: string}[]};
type PexelsPhoto = {id: number; width: number; height: number; photographer: string; src: {large2x: string; portrait: string; large: string}};

export type Candidate = {url: string; credit: string; thumb?: string; kind: 'video' | 'image'};

export async function searchPexelsVideos(query: string, orientation: 'portrait' | 'landscape' | 'square', perPage = 5, minDuration = 3): Promise<Candidate[]> {
  if (!config.keys.pexels) return [];
  const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}&size=medium`, {
    headers: {Authorization: config.keys.pexels},
  });
  if (!r.ok) return [];
  const j = (await r.json()) as {videos?: PexelsVideo[]};
  return (j.videos ?? [])
    .filter((v) => v.duration >= minDuration)
    .map((v): Candidate | null => {
      // arquivo mais próximo de 1080 no lado menor, mp4
      const files = v.video_files.filter((f) => f.file_type === 'video/mp4' && f.width && f.height);
      files.sort((a, b) => Math.abs(Math.min(a.width, a.height) - 1080) - Math.abs(Math.min(b.width, b.height) - 1080));
      return files[0] ? {url: files[0].link, credit: `Pexels / ${v.user?.name ?? 'autor'}`, thumb: v.image, kind: 'video'} : null;
    })
    .filter((x): x is Candidate => !!x);
}

export async function searchPexelsPhotos(query: string, orientation: 'portrait' | 'landscape' | 'square', perPage = 5): Promise<Candidate[]> {
  if (!config.keys.pexels) return [];
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}`, {
    headers: {Authorization: config.keys.pexels},
  });
  if (!r.ok) return [];
  const j = (await r.json()) as {photos?: PexelsPhoto[]};
  return (j.photos ?? []).map((p) => ({url: orientation === 'portrait' ? p.src.portrait : p.src.large2x, credit: `Pexels / ${p.photographer}`, thumb: p.src.large, kind: 'image' as const}));
}

/** pontua um asset da biblioteca contra a busca (tags + nome) */
export function libraryMatch(lib: LibraryAsset[], query: string): LibraryAsset[] {
  const q = query.split(/\s+/).map(normWord).filter((w) => w.length > 2);
  if (!q.length) return [];
  return lib
    .map((a) => {
      const hay = new Set([...a.tags.map(normWord), ...a.name.split(/[\s_\-.]+/).map(normWord)]);
      return {a, score: q.filter((w) => hay.has(w)).length / q.length};
    })
    .filter((x) => x.score >= 0.5)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}

const orientationFor = (template: BrollSegment['template'], plan: EditPlan): 'portrait' | 'landscape' | 'square' => {
  if (template === 'card') return 'square';
  if (template === 'split') return 'landscape';
  return plan.format.height > plan.format.width ? 'portrait' : 'landscape';
};

const PickSchema = z.object({picks: z.array(z.object({segment: z.number(), candidate: z.number().describe('índice do candidato escolhido, ou -1 se nenhum combina'), why: z.string()}))});

const PICK_SYSTEM = `Você é editor de vídeos curtos e escolhe o B-roll (cena em tela cheia) que ilustra a fala.
Para cada segmento você recebe: a fala/cena desejada e as miniaturas numeradas dos vídeos candidatos do banco de imagens.
Escolha o candidato que MELHOR mostra a cena desejada: assunto certo, ação certa, visual bonito e atual, sem texto/logo/marca d'água grande.
Se NENHUM combina de verdade com o que a pessoa fala (assunto diferente, cena aleatória, genérica demais), devolva -1 — B-roll errado é pior que nenhum.`;

/** a IA (com visão) escolhe, por miniatura, o melhor candidato de cada segmento; -1 = nenhum serve */
async function pickWithVision(director: Director, items: Array<{seg: number; scene: string; cands: Candidate[]}>, log?: (s: string) => void): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const withThumbs = items.filter((x) => x.cands.length && x.cands.every((c) => c.thumb));
  // até ~40 imagens por pedido
  for (let i = 0; i < withThumbs.length; i += 8) {
    const batch = withThumbs.slice(i, i + 8);
    const images: Array<{url: string; label: string}> = [];
    for (const it of batch) it.cands.forEach((c, ci) => images.push({url: c.thumb!, label: `segmento ${it.seg} · candidato ${ci}`}));
    try {
      const r = await director.json({
        name: 'broll_pick',
        system: PICK_SYSTEM,
        user: `SEGMENTOS:\n${batch.map((it) => `segmento ${it.seg}: ${it.scene} (${it.cands.length} candidatos: 0–${it.cands.length - 1})`).join('\n')}\n\nEscolha um candidato por segmento.`,
        schema: PickSchema,
        images,
        effort: 'low',
      });
      for (const p of r.picks) if (batch.some((b) => b.seg === p.segment)) out.set(p.segment, p.candidate);
    } catch (e) {
      log?.(`escolha do B-roll pela IA falhou (${String(e).slice(0, 140)}); usando o primeiro resultado`);
    }
  }
  return out;
}

/** Preenche src/alternativas de cada B-roll que ainda não tem arquivo. */
export async function resolveBrollAssets(
  plan: EditPlan,
  library: LibraryAsset[],
  projectId: string,
  opts: {allowAi?: boolean; director?: Director; log?: (s: string) => void} = {},
): Promise<EditPlan> {
  const used = new Set(plan.broll.map((b) => b.asset.src).filter(Boolean) as string[]);
  type Pending = {b: BrollSegment; seg: number; cands: Candidate[]};
  const done = new Map<string, BrollSegment>();
  const pending: Pending[] = [];
  let seg = 0;
  for (const b of plan.broll) {
    if (b.asset.src || b.asset.kind === 'emoji' || !b.asset.query) {
      done.set(b.id, b);
      continue;
    }
    const queries = [b.asset.query, ...(b.asset.queries ?? [])].filter((q, i, a) => q && a.indexOf(q) === i);
    const own = queries.flatMap((q) => libraryMatch(library, q)).filter((a) => b.asset.kind !== 'image' || a.kind === 'image');
    if (own.length) {
      done.set(b.id, {...b, asset: {...b.asset, kind: own[0].kind, src: own[0].key, origin: 'own', alternatives: own.slice(0, 5).map((a) => a.key)}});
      continue;
    }
    const orient = orientationFor(b.template, plan);
    const need = Math.max(2, b.end - b.start);
    // candidatos de vídeo das buscas em ordem (a 1ª é a mais específica), sem repetir vídeo já usado no reel
    const cands: Candidate[] = [];
    if (b.asset.kind === 'video') {
      for (const q of queries) {
        if (cands.length >= 5) break;
        let found = await searchPexelsVideos(q, orient, 6, need);
        // vertical tem pouco acervo: horizontal também serve (tela cheia corta no centro)
        if (found.length < 2 && orient === 'portrait') found = [...found, ...(await searchPexelsVideos(q, 'landscape', 6, need))];
        for (const c of found) if (!used.has(c.url) && !cands.some((x) => x.url === c.url) && cands.length < 5) cands.push(c);
      }
    }
    if (!cands.length) {
      for (const q of queries) {
        for (const c of await searchPexelsPhotos(q, orient, 5)) if (!used.has(c.url) && cands.length < 4) cands.push(c);
        if (cands.length) break;
      }
    }
    cands.forEach((c) => used.add(c.url));
    pending.push({b, seg: seg++, cands});
  }

  // com IA: ela olha as miniaturas e escolhe a cena certa (ou recusa todas)
  const vision = opts.director && opts.director.id !== 'heuristic' && config.keys.pexels ? opts.director : null;
  const picks = vision ? await pickWithVision(vision, pending.map((p) => ({seg: p.seg, scene: `${p.b.asset.scene ?? ''} [${p.b.asset.query}] ${p.b.reason ?? ''}`.trim(), cands: p.cands})), opts.log) : new Map<number, number>();

  for (const p of pending) {
    const {b} = p;
    const pick = picks.get(p.seg);
    const chosen = pick === undefined ? p.cands[0] : pick >= 0 ? p.cands[pick] : undefined;
    if (chosen) {
      const rest = p.cands.filter((c) => c !== chosen);
      done.set(b.id, {...b, asset: {...b.asset, kind: chosen.kind, src: chosen.url, origin: 'pexels', credit: chosen.credit, alternatives: [chosen, ...rest].map((c) => c.url)}});
      continue;
    }
    if (pick === -1) opts.log?.(`B-roll "${b.asset.query}": nenhum vídeo do banco combinava com a fala`);
    const orient = orientationFor(b.template, plan);
    const prompt = b.asset.prompt ?? (b.asset.scene ? `${b.asset.scene} (${b.asset.query})` : b.asset.query!);
    // vídeo por IA (fase 3) para tela cheia/split, quando habilitado
    const vgen = b.template !== 'card' ? getVideoGen() : null;
    if (vgen) {
      try {
        const aspect = orient === 'portrait' ? '9:16' : orient === 'square' ? '1:1' : '16:9';
        const vid = await vgen.generate(prompt, aspect, b.end - b.start);
        const key = await getStorage().put(`projects/${projectId}/broll/${b.id}.mp4`, vid, 'video/mp4');
        done.set(b.id, {...b, asset: {...b.asset, kind: 'video', src: key, origin: 'ai', alternatives: [key]}});
        continue;
      } catch (e) {
        opts.log?.(`vídeo IA falhou para "${b.asset.query}": ${String(e).slice(0, 120)}`);
      }
    }
    const gen = opts.allowAi ? getImageGen() : null;
    if (gen) {
      try {
        const img = await gen.generate(prompt, plan.format);
        const key = await getStorage().put(`projects/${projectId}/broll/${b.id}.png`, img, 'image/png');
        done.set(b.id, {...b, asset: {...b.asset, kind: 'image', src: key, origin: 'ai', alternatives: [key]}});
        continue;
      } catch (e) {
        opts.log?.(`imagem IA falhou para "${b.asset.query}": ${String(e).slice(0, 120)}`);
      }
    }
    // nada que combine: sem cena (melhor que um emoji ou um vídeo aleatório)
    opts.log?.(`B-roll "${b.asset.query}" removido: nada encontrado${config.keys.pexels ? '' : ' (falta PEXELS_API_KEY)'}`);
  }
  const broll = plan.broll.flatMap((b) => (done.has(b.id) ? [done.get(b.id)!] : []));
  return {...plan, broll};
}
