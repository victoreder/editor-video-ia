// Testes das fases 2 e 3 (partes puras).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EditPlanSchema, type EditPlan, type Word} from '../src/lib/plan/schema';
import {autoCut} from '../src/lib/modules/cuts';
import {buildCaptions} from '../src/lib/modules/captions';
import {applyCreative, heuristicCreative} from '../src/lib/modules/creative';
import {findMoments} from '../src/lib/modules/shorts';
import {applyOps, heuristicChat, planSummary, type Op} from '../src/lib/modules/chat-edit';
import {toFcpxml} from '../src/lib/modules/fcpxml';
import {gradeFromStats} from '../src/lib/media/grade';
import {cameraPath} from '../src/lib/media/face';
import {measuresToStyle, studyToStyle, type ReferenceStudy} from '../src/lib/modules/reference';
import {heuristicPostPack} from '../src/lib/modules/postpack';
import {bestThumbnailTime, coverTitle} from '../src/lib/modules/thumbnail';
import {emptyPlan, finalize, restyle} from '../src/lib/pipeline/plan-builder';
import {placeClips, timelineWords} from '../src/lib/plan/timeline';
import {styleOf, STYLES} from '../src/lib/styles';
import {timelineModel} from '../src/editor/ops';

const S = 'src_a';
function words(text: string, t0 = 0, per = 0.36): Word[] {
  let t = t0;
  return text.split(/\s+/).map((w) => {
    const o = {text: w, start: +t.toFixed(3), end: +(t + per * 0.9).toFixed(3), sourceId: S};
    t += per + (/[.!?]$/.test(w) ? 0.3 : 0);
    return o;
  });
}
function plan(ws: Word[], duration = 120): EditPlan {
  const p = emptyPlan({style: 'dynamic', platform: 'instagram', director: 'heuristic', model: 'regras'});
  p.sources = [{id: S, name: 'a.mp4', key: 'projects/x/a.mp4', proxyKey: 'k', duration, width: 1080, height: 1920, fps: 30, hasAudio: true}];
  p.words = ws;
  p.faceTracks = [{sourceId: S, samples: Array.from({length: duration * 2}, (_, i) => ({t: i / 2, cx: 0.5, cy: 0.33, w: 0.3, h: 0.18, chinY: 0.44}))}];
  p.clips = autoCut(p.sources, ws, 'medium').clips;
  p.captions.chunks = buildCaptions(p);
  return p;
}

const LONG = [
  'Você sabe qual é o maior erro de quem começa no Instagram?',
  'A maioria posta todo dia sem estratégia nenhuma e depois desiste.',
  'Eu fiz isso por dois anos e não cresci nada.',
  'Então eu mudei uma coisa simples e em 30 dias ganhei 10 mil seguidores.',
  'O segredo é a constância com intenção, não a quantidade.',
  'Por isso eu sempre digo: planeje antes de gravar.',
  'E aí tem outra coisa que pouca gente fala.',
  'Por que os seus vídeos não passam de 200 visualizações?',
  'Porque os três primeiros segundos não prendem ninguém.',
  'Comece com uma pergunta, um número ou uma promessa clara.',
  'Primeiro grave o gancho, depois o conteúdo, por fim o CTA.',
  'É assim que você transforma visualização em seguidor.',
].join(' ');

test('Shorts: momentos de 20–60 s, sem sobreposição, abrindo com gancho', () => {
  const ws = words(LONG);
  const ms = findMoments(ws, {count: 3, min: 8, max: 30});
  assert.ok(ms.length >= 2, JSON.stringify(ms));
  for (let i = 1; i < ms.length; i++) assert.ok(ms[i].start >= ms[i - 1].end - 1e-6);
  for (const m of ms) assert.ok(m.end - m.start >= 8 && m.end - m.start <= 30);
  assert.ok(ms.some((m) => m.why.some((w) => /pergunta|número|fala com/.test(w))));
  assert.ok(!ms.some((m) => /^E aí/.test(m.title)), 'não abre apontando para trás');
});

test('chat: operações aplicadas com as funções do editor', () => {
  const p = finalize(plan(words(LONG), 80));
  const cap = p.captions.chunks[2];
  const blank = (o: Partial<Op>): Op => ({op: 'remove', id: '', start: 0, end: 0, kind: '', text: '', value: '', label: '', items: [], emoji: '', number: 0, ...o});
  const {plan: out, applied} = applyOps(p, [
    blank({op: 'add_overlay', kind: 'stat', start: 3, end: 6, value: '87%', label: 'crescimento'}),
    blank({op: 'set_caption_text', id: cap.id, text: 'TEXTO NOVO'}),
    blank({op: 'set_hook', text: 'PARE DE POSTAR|SEM ESTRATÉGIA'}),
    blank({op: 'caption_scale', number: 1.2}),
    blank({op: 'remove', id: 'nao-existe'}),
  ]);
  assert.equal(applied, 4);
  assert.ok(out.overlays.some((o) => o.kind === 'stat' && o.props.value === '87%'));
  assert.equal(out.captions.chunks.find((c) => c.id === cap.id)!.words.map((w) => w.text).join(' '), 'TEXTO NOVO');
  assert.equal(out.hook?.title, 'PARE DE POSTAR|SEM ESTRATÉGIA');
  EditPlanSchema.parse(finalize(out));
  assert.match(planSummary(out), /\[Legendas\]/);
  const h = heuristicChat(out, 'tira os gráficos e deixa a legenda maior');
  const r = applyOps(out, h.ops);
  assert.equal(r.plan.overlays.length, 0);
});

test('FCPXML: um asset-clip por clipe, tempos em frames, marcadores', () => {
  const p = finalize(plan(words(LONG), 80));
  const xml = toFcpxml(p, {name: 'Teste', mediaUrl: (_k, n) => `file://./${n}`});
  assert.match(xml, /<fcpxml version="1.9">/);
  assert.equal((xml.match(/<asset-clip /g) ?? []).length, p.clips.length);
  assert.match(xml, /frameDuration="100\/3000s"/);
  assert.match(xml, /<marker .*LEGENDA:/);
});

test('cor: rosto escuro contra fundo claro é levantado; nunca escurece', () => {
  const dark = gradeFromStats({luma: 170, u: 128, v: 128, sat: 40}, {luma: 70, u: 128, v: 130, sat: 30});
  assert.ok(dark.brightness > 1.1, JSON.stringify(dark));
  const bright = gradeFromStats({luma: 120, u: 128, v: 128, sat: 40}, {luma: 200, u: 128, v: 128, sat: 30});
  assert.equal(bright.brightness, 1);
  const cold = gradeFromStats({luma: 120, u: 145, v: 120, sat: 40}, null);
  assert.ok(cold.warmth > 0);
});

test('reenquadramento "cinegrafista": zona morta e movimento suave', () => {
  const s = Array.from({length: 40}, (_, i) => ({t: i / 5, cx: i < 20 ? 0.5 + (i % 2 ? 0.01 : -0.01) : 0.7, cy: 0.3, w: 0.2, h: 0.2, chinY: 0.4}));
  const out = cameraPath(s);
  assert.ok(out.slice(0, 20).every((x) => Math.abs(x.fx! - 0.5) < 0.02), 'tremidinha não move a câmera');
  assert.ok(out[21].fx! < 0.7 && out[39].fx! > 0.68, 'anda até o novo lugar com suavidade');
});

test('estilo de referência: medições → estilo válido; estudo da IA → limites seguros', () => {
  const m = measuresToStyle('custom_x', {duration: 30, cuts: Array.from({length: 18}, (_, i) => i * 1.6), avgShot: 1.6, cutsPerMin: 36, colors: ['#FF3366', '#22CCEE'], luma: 110, sat: 80}, 'Rápido');
  assert.equal(m.palette.key, '#FF3366');
  assert.ok(m.maxStatic <= 3);
  const study: ReferenceStudy = {
    name: 'Ref', summary: 's', editLog: '', fiveThings: [],
    palette: {text: '#fff', accent: 'roxo', key: '#ffd400', panel: '#111111', bg: '#000000'},
    fonts: {display: 'Anton', body: 'Inter', weight: 2000},
    captions: {preset: 'karaoke', uppercase: true, maxWords: 99, sizeOfWidth: 0.5, emphasisRate: 2, emojiEvery: 3},
    camera: {intensity: 'strong', punchEverySec: 0.5, shake: true},
    transitions: {kinds: ['whip'], everySec: 1},
    graphicsPerMinute: 99, brollPerMinute: 5, brollTemplates: [], maxStaticSec: 0.2, sfxDensity: 'high',
    music: {mood: 'upbeat', level: 'high'}, grade: 'punchy', hook: true, cta: 'siga', progressBar: true,
  };
  const st = studyToStyle('custom_y', study, 'teste');
  assert.equal(st.palette.accent, STYLES.dynamic.palette.accent, 'cor inválida cai no padrão');
  assert.ok(st.captions.maxWords <= 6 && st.captions.sizePx <= 120 && st.fonts.displayWeight <= 900 && st.maxStatic >= 1.5);
  // o plano com estilo próprio usa a cópia embutida
  const p = restyle(finalize(plan(words(LONG), 80)), st);
  assert.equal(p.style, 'custom_y');
  assert.equal(styleOf(p).captions.preset, 'karaoke');
  EditPlanSchema.parse(p);
});

test('post pack sem IA, capa e texto atrás da pessoa', () => {
  const pp = heuristicPostPack(LONG);
  assert.ok(pp.hook.length > 5 && pp.hashtags.length >= 5 && pp.platforms.instagram.includes('#'));
  const p0 = plan(words(LONG), 80);
  const tw = timelineWords(p0);
  const dur = placeClips(p0.clips, 30).at(-1)!.end;
  const c = heuristicCreative(tw, STYLES.dynamic, dur);
  assert.ok(c.overlays.some((o) => o.kind === 'behind'), 'palavra forte vira texto atrás');
  const p = finalize(applyCreative(p0, c));
  const t = bestThumbnailTime(p);
  assert.ok(t > 0 && t < dur);
  assert.ok(coverTitle(p).length > 3);
  assert.ok(timelineModel(p).tracks.find((x) => x.kind === 'overlay')!.items.length >= 1);
});

test('fila: o JSON local entrega cada job a um worker só', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'));
  const {LocalJsonDb} = await import('../src/lib/adapters/db');
  const db = new LocalJsonDb(dir);
  const now = new Date().toISOString();
  for (const id of ['a', 'b']) await db.createJob({id, projectId: 'p', type: 'render', status: 'queued', progress: 0, label: '', input: {}, createdAt: now + id, updatedAt: now});
  const got = await Promise.all([db.claimNextJob(), db.claimNextJob(), db.claimNextJob()]);
  const ids = got.filter(Boolean).map((j) => j!.id).sort();
  assert.deepEqual(ids, ['a', 'b']);
  assert.equal(await db.claimNextJob(), null);
});
