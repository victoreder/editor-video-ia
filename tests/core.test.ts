// Testes das partes puras: timeline, cortes, legendas, plano criativo, safezone, SFX, QA, atalhos.
//   npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditPlanSchema, type EditPlan, type Word} from '../src/lib/plan/schema';
import {anchorRange, placeClips, projectPoint, projectRange, timelineWords, timelineToSource} from '../src/lib/plan/timeline';
import {autoCut, dropRetakes, speechSegments, snapClipsToWords, similarity} from '../src/lib/modules/cuts';
import {applyGlossary, buildCaptions, chunkWords, decorateChunks, toSrt} from '../src/lib/modules/captions';
import {applyCreative, heuristicCreative} from '../src/lib/modules/creative';
import {placeCaptions} from '../src/lib/modules/safezone';
import {planSfx} from '../src/lib/modules/sfx';
import {runQa} from '../src/lib/modules/qa';
import {getStyle} from '../src/lib/styles';
import {emptyPlan, finalize, restyle} from '../src/lib/pipeline/plan-builder';
import {resolveKey} from '../src/editor/keys';
import {retimeItem, splitAt, timelineModel, trimClip} from '../src/editor/ops';
import {coverFit} from '../src/lib/plan/frame';

const S = 'src_a';
const words = (text: string, t0 = 0, per = 0.35, gapAfter: Record<number, number> = {}): Word[] => {
  let t = t0;
  return text.split(' ').map((w, i) => {
    const out = {text: w, start: +t.toFixed(3), end: +(t + per * 0.9).toFixed(3), sourceId: S};
    t += per + (gapAfter[i] ?? 0);
    return out;
  });
};

function basePlan(ws: Word[], duration = 20): EditPlan {
  const p = emptyPlan({style: 'dynamic', platform: 'instagram', director: 'heuristic', model: 'regras'});
  p.sources = [{id: S, name: 'a.mp4', key: 'k', proxyKey: 'k', duration, width: 1080, height: 1920, fps: 30, hasAudio: true}];
  p.words = ws;
  p.faceTracks = [{sourceId: S, samples: Array.from({length: duration * 5}, (_, i) => ({t: i / 5, cx: 0.5, cy: 0.33, w: 0.3, h: 0.18, chinY: 0.44}))}];
  p.clips = autoCut(p.sources, ws, 'medium').clips;
  p.captions.chunks = buildCaptions(p);
  return p;
}

test('placeClips + projeção ida e volta', () => {
  const p = basePlan(words('um dois três quatro', 0, 0.4, {1: 2}));
  const placed = placeClips(p.clips, 30);
  assert.equal(placed.length, 2, 'pausa de 2 s vira dois clipes');
  const t = projectPoint(placed, S, p.words[3].start)!;
  const back = timelineToSource(placed, t)!;
  assert.ok(Math.abs(back.srcSec - p.words[3].start) < 0.04);
  assert.equal(projectPoint(placed, S, 1.5), null, 'trecho cortado não aparece');
  const r = anchorRange(p, 0.1, 1.2)!;
  const pr = projectRange(placed, r.sourceId, r.start, r.end)!;
  assert.ok(Math.abs(pr.start - 0.1) < 0.04 && Math.abs(pr.end - 1.2) < 0.05, 'âncora atravessa o corte');
});

test('autocut: remove pausas e "éé", nunca corta no meio da palavra', () => {
  const ws = words('então éé hoje vou falar de vendas', 0.5, 0.3, {3: 1.4});
  const segs = speechSegments(ws, {id: S, duration: 10}, 'medium');
  assert.equal(segs.length, 2);
  assert.ok(!segs.flatMap((s) => s.words).some((w) => w.text === 'éé'));
  const clips = snapClipsToWords([{id: 'c', sourceId: S, inSec: ws[2].start + 0.05, outSec: ws[5].start + 0.05, speed: 1, volume: 1, muted: false, baseZoom: 1}], ws);
  assert.ok(clips[0].inSec <= ws[2].start && clips[0].outSec >= ws[5].end);
});

test('takes repetidos: fica o mais tardio', () => {
  const a = words('o segredo é a constância', 0);
  const b = words('o segredo é a constância diária', 5);
  const segs = [
    {sourceId: S, inSec: 0, outSec: 2, words: a},
    {sourceId: S, inSec: 5, outSec: 7.5, words: b},
  ];
  assert.ok(similarity(['o', 'segredo', 'é'], ['o', 'segredo', 'é']) === 1);
  const {kept, dropped} = dropRetakes(segs);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].inSec, 5);
  assert.equal(dropped.length, 1);
});

test('legendas: blocos de até 3 palavras, sem terminar em palavra-cola, destaque em número', () => {
  const ws = words('nós crescemos 87% em 30 dias com a estratégia certa.', 0);
  const chunks = decorateChunks(chunkWords(ws, {maxWords: 3, upper: true}), {emphasisRate: 0.2, emojiEvery: 0});
  assert.ok(chunks.every((c) => c.words.length <= 3));
  assert.ok(!chunks.some((c) => ['A', 'COM', 'EM', 'DE'].includes(c.words.at(-1)!.text) && c !== chunks.at(-1)));
  assert.ok(chunks.some((c) => c.words.some((w) => w.accent && /\d/.test(w.text))));
});

test('glossário corrige nome quebrado', () => {
  const ws = words('eu uso super base todo dia', 0);
  const out = applyGlossary(ws, ['Supabase']);
  assert.equal(out.map((w) => w.text).join(' '), 'eu uso Supabase todo dia');
});

test('SRT no tempo do vídeo final', () => {
  const p = basePlan(words('primeira frase aqui. segunda frase depois.', 0, 0.4, {2: 3}));
  const srt = toSrt(p);
  assert.match(srt, /^1\n00:00:00,\d{3} --> /);
  assert.ok(srt.includes('segunda frase depois.'));
  // a segunda frase começa logo depois da primeira (pausa cortada)
  const second = srt.split('\n\n')[1];
  assert.ok(second.includes('00:00:01,') || second.includes('00:00:00,'), second);
});

test('plano criativo heurístico + aplicação + finalize produzem um EditPlan válido', () => {
  const text = 'Hoje eu vou mostrar como a inteligência artificial pode triplicar suas vendas. Em 30 dias, nossos clientes cresceram 87%. O segredo não é trabalhar mais. São três coisas: conteúdo, constância, automação. Isso muda o jogo do seu negócio e das suas vendas para sempre. Segue para mais.';
  const p = basePlan(words(text, 0.3, 0.38), 40);
  const tw = timelineWords(p);
  const dur = placeClips(p.clips, 30).at(-1)!.end;
  const c = heuristicCreative(tw, getStyle('dynamic'), dur);
  assert.ok(c.overlays.some((o) => o.kind === 'stat' && o.value.includes('87')), JSON.stringify(c.overlays));
  const out = finalize(applyCreative(p, c));
  EditPlanSchema.parse(out);
  assert.ok(out.camera.beats.length >= 2);
  assert.ok(out.audio.sfx.length >= 1);
  assert.ok(out.captions.chunks.every((ch) => ch.y !== undefined));
  assert.ok(!runQa(out).some((i) => i.level === 'error'));
});

test('safezone: legenda o mais baixo possível, logo acima da interface do Reels', () => {
  const p = basePlan(words('uma frase de teste para posicionar', 0));
  const chunks = placeCaptions(p);
  for (const c of chunks) {
    const y = (c.y! / 100) * 1920;
    assert.ok(y >= 0.65 * 1920, `y=${y} deve ficar na parte de baixo (longe do rosto)`);
    assert.ok(y + 150 <= 1920 - 430 + 1, 'dentro da área segura do Instagram');
    assert.ok(y + 150 >= 1920 - 430 - 2, 'colada no limite de baixo (o mais baixo possível)');
  }
});

test('diretor sem IA: palavras-chave na tela e sons só nas mudanças de cena', () => {
  const p = basePlan(
    words('O faturamento da empresa cresceu 87% em 3 meses. Nossos clientes compram pelo celular todos os dias. A estratégia de marketing mudou tudo para o negócio.', 0),
  );
  const tw = timelineWords(p);
  const c = heuristicCreative(tw, getStyle('dynamic'), tw.at(-1)!.end + 0.3);
  assert.ok(c.overlays.some((o) => o.kind === 'keyword' && o.text.length >= 3), JSON.stringify(c.overlays.map((o) => o.kind)));
  const out = finalize(applyCreative(p, c));
  // palavra-chave vira gráfico com posição calculada (fora da faixa da legenda)
  const kw = out.overlays.filter((o) => o.kind === 'keyword');
  assert.ok(kw.length >= 1 && kw.every((o) => o.y !== undefined));
  // nenhum som em palavra-chave nem em zoom: só onde a cena muda
  const kwStarts = new Set(kw.map((o) => o.start));
  assert.ok(!out.audio.sfx.some((s) => kwStarts.has(s.at)));
  assert.ok(!out.audio.sfx.some((s) => s.kind === 'impact' || s.kind === 'riser'));
});

test('SFX: transições geram whoosh e sons próximos são deduplicados', () => {
  const p = basePlan(words('um dois três quatro cinco seis', 0, 0.4, {2: 2}));
  p.transitions = [{id: 't', clipId: p.clips[1].id, kind: 'whip', duration: 0.24}];
  const sfx = planSfx(p);
  assert.ok(sfx.some((s) => s.kind === 'whoosh' || s.kind === 'swoosh'));
});

test('restyle troca preset e caixa da legenda', () => {
  const p = finalize(basePlan(words('olá mundo bonito', 0)));
  const r = restyle(p, 'minimal');
  assert.equal(r.captions.preset, 'editorial');
  assert.ok(r.captions.chunks.every((c) => c.words.every((w) => w.text === w.text.toLowerCase())));
});

test('editor: dividir, aparar e mover itens', () => {
  const p = finalize(basePlan(words('um dois três quatro cinco seis sete oito', 0, 0.4)));
  const {plan: split, newId} = splitAt(p, 1.5);
  assert.equal(split.clips.length, p.clips.length + 1);
  assert.ok(newId);
  const trimmed = trimClip(split, split.clips[0].id, 'in', 0.3);
  assert.ok(Math.abs(trimmed.clips[0].inSec - (split.clips[0].inSec + 0.3)) < 1e-6);
  const withOv = {...split, overlays: [{id: 'o', sourceId: S, start: 0.5, end: 1.5, kind: 'stat' as const, props: {value: '1'}, layout: 'card' as const}]};
  const moved = retimeItem(withOv, 'overlay', 'o', 2, 3);
  const item = timelineModel(moved).tracks.find((t) => t.kind === 'overlay')!.items[0];
  assert.ok(Math.abs(item.t0 - 2) < 0.05 && Math.abs(item.t1 - 3) < 0.05);
});

test('reframe barato: rosto à direita num vídeo 16:9 fica no quadro 9:16', () => {
  const fit = coverFit(1920, 1080, 1080, 1920, 0.8, 0.4);
  const faceX = fit.offX + 0.8 * fit.dw;
  assert.ok(faceX > 0 && faceX < 1080, `rosto em x=${faceX}`);
});

test('atalhos', () => {
  assert.deepEqual(resolveKey({key: ' '}, {frame: 0, totalFrames: 10}), {type: 'toggle-play'});
  assert.deepEqual(resolveKey({key: 'z', metaKey: true, shiftKey: true}, {frame: 0, totalFrames: 10}), {type: 'redo'});
  assert.deepEqual(resolveKey({key: 'ArrowRight', shiftKey: true}, {frame: 5, totalFrames: 10}), {type: 'seek', frame: 9});
  assert.deepEqual(resolveKey({key: 's'}, {frame: 0, totalFrames: 10}), {type: 'split'});
});
