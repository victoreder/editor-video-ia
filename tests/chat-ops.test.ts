// Operações novas do chat: cortar um trecho, posição da legenda e filtro de cor.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyOps, type Op} from '../src/lib/modules/chat-edit';
import {emptyPlan} from '../src/lib/pipeline/plan-builder';
import {placeClips} from '../src/lib/plan/timeline';

const base = () => ({
  ...emptyPlan({style: 'dynamic', platform: 'instagram', director: 'heuristic', model: 'regras'}),
  sources: [{id: 's1', name: 'a.mp4', key: 'k', duration: 20, width: 1080, height: 1920, fps: 30, hasAudio: true}],
  clips: [{id: 'c1', sourceId: 's1', inSec: 0, outSec: 10, speed: 1, volume: 1, muted: false, baseZoom: 1}],
  captions: {preset: 'bold-pop' as const, uppercase: true, chunks: [{id: 'k1', sourceId: 's1', start: 1, end: 2, words: [{text: 'OI', start: 1, end: 2, accent: false}], y: 64}]},
});
const op = (o: Partial<Op>): Op => ({op: 'remove', id: '', start: 0, end: 0, kind: '', text: '', value: '', label: '', items: [], emoji: '', number: 0, ...o}) as Op;

test('cut_range: tira 3–5 s e junta (vídeo fica 2 s menor)', () => {
  const r = applyOps(base(), [op({op: 'cut_range', start: 3, end: 5})]);
  assert.equal(r.applied, 1);
  const placed = placeClips(r.plan.clips, 30);
  assert.ok(Math.abs(placed.at(-1)!.end - 8) < 0.05);
  assert.deepEqual(r.plan.clips.map((c) => [c.inSec, c.outSec]), [[0, 3], [5, 10]]);
});

test('caption_position: legenda sobe e fica manual (o posicionamento automático não mexe)', () => {
  const r = applyOps(base(), [op({op: 'caption_position', number: 55})]);
  assert.equal(r.plan.captions.chunks[0].y, 55);
  assert.equal(r.plan.captions.chunks[0].manual, true);
  assert.equal(applyOps(base(), [op({op: 'caption_position', number: 90})]).plan.captions.chunks[0].y, 72, 'nunca na área da interface');
});

test('set_grade: aplica e tira o filtro', () => {
  const r = applyOps(base(), [op({op: 'set_grade', kind: 'film'})]);
  assert.equal(r.plan.grade.look, 'film');
  assert.equal(applyOps(r.plan, [op({op: 'set_grade', kind: 'none'})]).plan.grade.look, 'none');
});
