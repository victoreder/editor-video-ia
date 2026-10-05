// Blob privado: as chaves são URLs. O mapa de mídia precisa incluí-las (link assinado),
// o editor usa a prévia leve e o componente consulta o mapa antes de usar a URL crua.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserMediaMap, mediaMap} from '../src/lib/pipeline/media-map';
import {makeResolver} from '../src/remotion/context';
import {emptyPlan} from '../src/lib/pipeline/plan-builder';
import type {Storage} from '../src/lib/adapters/storage';

const B = 'https://abc.private.blob.vercel-storage.com/projects/p';
const plan = {
  ...emptyPlan({style: 'dynamic', platform: 'instagram', director: 'heuristic', model: 'regras'}),
  sources: [{id: 's1', name: 'a.mov', key: `${B}/uploads/a.mov`, proxyKey: `${B}/proxy/s1.mp4`, duration: 10, width: 1080, height: 1920, fps: 30, hasAudio: true}],
};
const storage = {
  publicUrl: (k: string) => k,
  signedUrl: async (u: string) => `${u}?sig=1`,
} as unknown as Storage;

test('render: chaves-URL do Blob entram no mapa e saem assinadas', async () => {
  const media = mediaMap(plan, (k) => k);
  assert.deepEqual(Object.keys(media), [`${B}/proxy/s1.mp4`]);
});

test('editor: usa a prévia leve assinada no lugar do proxy', async () => {
  const media = await browserMediaMap(plan, storage, {s1: `${B}/preview/s1.mp4`});
  assert.equal(media[`${B}/proxy/s1.mp4`], `${B}/preview/s1.mp4?sig=1`);
  const noPreview = await browserMediaMap(plan, storage);
  assert.equal(noPreview[`${B}/proxy/s1.mp4`], `${B}/proxy/s1.mp4?sig=1`);
});

test('componente: consulta o mapa mesmo quando a chave já é URL', () => {
  const resolve = makeResolver({[`${B}/proxy/s1.mp4`]: 'https://x/assinado'});
  assert.equal(resolve(`${B}/proxy/s1.mp4`), 'https://x/assinado');
  assert.equal(resolve('https://pexels.com/v.mp4'), 'https://pexels.com/v.mp4');
});
