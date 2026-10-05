// B-roll: buscas alternativas, sem repetir vídeo, a IA escolhe pela miniatura
// e, quando nada combina, a cena sai (nunca vira emoji).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../src/lib/config';
import {EditPlanSchema, type EditPlan} from '../src/lib/plan/schema';
import {resolveBrollAssets} from '../src/lib/modules/broll-assets';
import {HeuristicDirector, type Director} from '../src/lib/adapters/director';

const plan = (): EditPlan =>
  EditPlanSchema.parse({
    version: 1,
    format: {width: 1080, height: 1920, fps: 30},
    style: 'dynamic',
    platform: 'instagram',
    sources: [{id: 's1', key: 'k', name: 'a.mp4', duration: 20, width: 1080, height: 1920, fps: 30}],
    words: [],
    clips: [{id: 'c1', sourceId: 's1', inSec: 0, outSec: 20, speed: 1}],
    camera: {beats: []},
    faceTracks: [],
    captions: {preset: 'bold-pop', uppercase: true, chunks: []},
    overlays: [],
    broll: [
      {id: 'b1', sourceId: 's1', start: 1, end: 3, template: 'takeover', asset: {kind: 'video', query: 'woman typing laptop cafe', queries: ['laptop work'], scene: 'mulher no notebook'}},
      {id: 'b2', sourceId: 's1', start: 6, end: 8, template: 'takeover', asset: {kind: 'video', query: 'empty store', queries: []}},
    ],
    transitions: [],
    audio: {sfx: []},
    meta: {director: 'claude', model: 'x', createdAt: new Date().toISOString(), notes: []},
  });

function mockPexels() {
  const orig = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const q = new URL(url).searchParams.get('query') ?? '';
    if (url.includes('/videos/search')) {
      // os dois termos da 1ª cena devolvem o mesmo vídeo "v1" (não pode repetir)
      const ids = q.includes('laptop') ? [1, 2] : [3, 4];
      return new Response(
        JSON.stringify({
          videos: ids.map((id) => ({id, width: 1080, height: 1920, duration: 10, image: `https://img/${id}.jpg`, user: {name: 'x'}, video_files: [{link: `https://v/${id}.mp4`, width: 1080, height: 1920, quality: 'hd', file_type: 'video/mp4'}]})),
        }),
      );
    }
    return new Response(JSON.stringify({photos: []}));
  }) as typeof fetch;
  return {calls, restore: () => (globalThis.fetch = orig)};
}

test('B-roll: a IA escolhe pela miniatura e recusa o que não combina (sem emoji)', async () => {
  const prev = config.keys.pexels;
  config.keys.pexels = 'test';
  const m = mockPexels();
  const seen: unknown[] = [];
  const director: Director = Object.assign(new HeuristicDirector(), {
    id: 'claude' as const,
    json: async (task: {images?: unknown[]}) => {
      seen.push(task.images);
      return {picks: [{segment: 0, candidate: 1, why: 'mostra o notebook'}, {segment: 1, candidate: -1, why: 'nada a ver'}]};
    },
  }) as unknown as Director;
  try {
    const out = await resolveBrollAssets(plan(), [], 'p1', {director, allowAi: false});
    assert.equal(out.broll.length, 1, 'a cena recusada sai do plano');
    assert.equal(out.broll[0].id, 'b1');
    assert.equal(out.broll[0].asset.src, 'https://v/2.mp4', 'usa o candidato escolhido pela IA');
    assert.equal(out.broll[0].asset.origin, 'pexels');
    assert.ok(!out.broll.some((b) => b.asset.kind === 'emoji'));
    // miniaturas foram mandadas para a IA, sem vídeo repetido entre as cenas
    const imgs = (seen[0] as Array<{url: string}>).map((i) => i.url);
    assert.deepEqual(imgs, ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg', 'https://img/4.jpg']);
  } finally {
    m.restore();
    config.keys.pexels = prev;
  }
});

test('B-roll sem banco de vídeos nem IA: a cena é removida, não vira emoji', async () => {
  const prev = config.keys.pexels;
  config.keys.pexels = '';
  try {
    const out = await resolveBrollAssets(plan(), [], 'p1', {allowAi: false});
    assert.equal(out.broll.length, 0);
  } finally {
    config.keys.pexels = prev;
  }
});

test('B-roll só com Pixabay (sem Pexels): vertical primeiro, crédito e origem certos', async () => {
  const prev = {pexels: config.keys.pexels, pixabay: config.keys.pixabay};
  config.keys.pexels = '';
  config.keys.pixabay = 'test';
  const orig = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith('https://pixabay.com/api/videos/')) {
      const v = (id: number, w: number, h: number) => ({id, duration: 12, user: 'ana', videos: {large: {url: `https://cdn.pixabay.com/${id}-l.mp4`, width: w, height: h, thumbnail: `https://cdn.pixabay.com/${id}.jpg`}, medium: {url: `https://cdn.pixabay.com/${id}-m.mp4`, width: w / 1.5, height: h / 1.5, thumbnail: `https://cdn.pixabay.com/${id}.jpg`}}});
      // o horizontal vem antes na resposta; o vertical deve ser preferido
      return new Response(JSON.stringify({hits: [v(10, 1920, 1080), v(11, 1080, 1920)]}));
    }
    return new Response(JSON.stringify({hits: []}));
  }) as typeof fetch;
  try {
    const out = await resolveBrollAssets(plan(), [], 'p1', {allowAi: false});
    assert.ok(urls.every((u) => !u.includes('pexels')), 'sem chave do Pexels, não chama o Pexels');
    assert.equal(out.broll.length, 2);
    assert.equal(out.broll[0].asset.src, 'https://cdn.pixabay.com/11-l.mp4', 'vertical em ~1080, primeiro');
    assert.equal(out.broll[0].asset.origin, 'pixabay');
    assert.equal(out.broll[0].asset.credit, 'Pixabay / ana');
    // a segunda cena não repete o vídeo da primeira
    assert.notEqual(out.broll[1].asset.src, out.broll[0].asset.src);
  } finally {
    globalThis.fetch = orig;
    Object.assign(config.keys, prev);
  }
});
