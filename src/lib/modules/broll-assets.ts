// Módulo 06 — busca de assets para o B-roll.
// Ordem (autobroll/broll-multiclip.mjs): 1) a SUA biblioteca (pasta "library/"
// no storage, com tags), 2) Pexels (vídeo, depois foto), 3) imagem por IA.
// Guarda alternativas para trocar com 1 clique no editor.
import {config} from '../config';
import type {BrollSegment, EditPlan} from '../plan/schema';
import {getStorage} from '../adapters/storage';
import {getImageGen} from '../adapters/imagegen';
import {normWord} from './captions';

export type LibraryAsset = {key: string; kind: 'video' | 'image'; tags: string[]; name: string};

type PexelsVideo = {id: number; width: number; height: number; duration: number; user?: {name: string}; video_files: {link: string; width: number; height: number; quality: string; file_type: string}[]};
type PexelsPhoto = {id: number; width: number; height: number; photographer: string; src: {large2x: string; portrait: string; large: string}};

export async function searchPexelsVideos(query: string, orientation: 'portrait' | 'landscape' | 'square', perPage = 5): Promise<{url: string; credit: string}[]> {
  if (!config.keys.pexels) return [];
  const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}&size=medium`, {
    headers: {Authorization: config.keys.pexels},
  });
  if (!r.ok) return [];
  const j = (await r.json()) as {videos?: PexelsVideo[]};
  return (j.videos ?? [])
    .filter((v) => v.duration >= 3)
    .map((v) => {
      // arquivo mais próximo de 1080 no lado menor, mp4
      const files = v.video_files.filter((f) => f.file_type === 'video/mp4' && f.width && f.height);
      files.sort((a, b) => Math.abs(Math.min(a.width, a.height) - 1080) - Math.abs(Math.min(b.width, b.height) - 1080));
      return files[0] ? {url: files[0].link, credit: `Pexels / ${v.user?.name ?? 'autor'}`} : null;
    })
    .filter((x): x is {url: string; credit: string} => !!x);
}

export async function searchPexelsPhotos(query: string, orientation: 'portrait' | 'landscape' | 'square', perPage = 5): Promise<{url: string; credit: string}[]> {
  if (!config.keys.pexels) return [];
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}`, {
    headers: {Authorization: config.keys.pexels},
  });
  if (!r.ok) return [];
  const j = (await r.json()) as {photos?: PexelsPhoto[]};
  return (j.photos ?? []).map((p) => ({url: orientation === 'portrait' ? p.src.portrait : p.src.large2x, credit: `Pexels / ${p.photographer}`}));
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

/** Preenche src/alternativas de cada B-roll que ainda não tem arquivo. */
export async function resolveBrollAssets(plan: EditPlan, library: LibraryAsset[], projectId: string, opts: {allowAi?: boolean; log?: (s: string) => void} = {}): Promise<EditPlan> {
  const broll: BrollSegment[] = [];
  for (const b of plan.broll) {
    if (b.asset.src || b.asset.kind === 'emoji' || !b.asset.query) {
      broll.push(b);
      continue;
    }
    const query = b.asset.query;
    const own = libraryMatch(library, query).filter((a) => b.asset.kind !== 'image' || a.kind === 'image');
    if (own.length) {
      broll.push({...b, asset: {...b.asset, kind: own[0].kind, src: own[0].key, origin: 'own', alternatives: own.slice(0, 5).map((a) => a.key)}});
      continue;
    }
    const orient = orientationFor(b.template, plan);
    let found = b.asset.kind === 'video' ? await searchPexelsVideos(query, orient) : [];
    let kind: 'video' | 'image' = 'video';
    if (!found.length) {
      found = await searchPexelsPhotos(query, orient);
      kind = 'image';
    }
    if (found.length) {
      broll.push({...b, asset: {...b.asset, kind, src: found[0].url, origin: 'pexels', credit: found[0].credit, alternatives: found.map((f) => f.url)}});
      continue;
    }
    const gen = opts.allowAi ? getImageGen() : null;
    if (gen) {
      try {
        const img = await gen.generate(b.asset.prompt ?? query, plan.format);
        const key = await getStorage().put(`projects/${projectId}/broll/${b.id}.png`, img, 'image/png');
        broll.push({...b, asset: {...b.asset, kind: 'image', src: key, origin: 'ai', alternatives: [key]}});
        continue;
      } catch (e) {
        opts.log?.(`imagem IA falhou para "${query}": ${String(e).slice(0, 120)}`);
      }
    }
    // nada encontrado: vira um card de emoji para não deixar buraco
    broll.push({...b, template: 'card', asset: {...b.asset, kind: 'emoji', emoji: b.asset.emoji || '✨', origin: 'none'}});
  }
  return {...plan, broll};
}
