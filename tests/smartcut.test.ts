// Corte inteligente: respiros medidos no áudio + erros e repetições.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {Source, Word} from '../src/lib/plan/schema';
import {analyzeAudio, findPauses} from '../src/lib/media/silence';
import {buildCuts, detectMistakes, smartCut} from '../src/lib/modules/smartcut';
import {snapClipsToWords} from '../src/lib/modules/cuts';
import {restoreRange} from '../src/editor/ops';
import {emptyPlan} from '../src/lib/pipeline/plan-builder';

const S = 's1';
/** palavras com tempo; "|0.5" depois de uma palavra = pausa extra de 0,5 s */
function W(text: string, per = 0.3): Word[] {
  let t = 0.2;
  const out: Word[] = [];
  for (const tok of text.split(/\s+/)) {
    const [w, pause] = tok.split('|');
    if (!w) continue;
    out.push({text: w, start: +t.toFixed(3), end: +(t + per * 0.85).toFixed(3), sourceId: S});
    t += per + Number(pause ?? 0);
  }
  return out;
}
const src = (dur: number, pauses?: Source['pauses']): Source => ({id: S, name: 'a.mp4', key: 'k', duration: dur, width: 1080, height: 1920, fps: 30, hasAudio: true, pauses});
const kept = (words: Word[], clips: {inSec: number; outSec: number}[]) =>
  words.filter((w) => clips.some((c) => w.start >= c.inSec - 1e-6 && w.end <= c.outSec + 1e-6)).map((w) => w.text).join(' ');

test('pausas medidas: limiar adaptativo pega silêncio e respiro, não a fala', () => {
  // 1 s fala (-18 dB) · 0,5 s respiro (-45 dB) · 1 s fala · 0,6 s silêncio (-80 dB) · 1 s fala
  const db = [...Array(100).fill(-18), ...Array(50).fill(-45), ...Array(100).fill(-19), ...Array(60).fill(-80), ...Array(100).fill(-18)];
  const r = findPauses(db, 0.01, {minPause: 0.25});
  assert.equal(r.pauses.length, 2, JSON.stringify(r));
  assert.equal(r.pauses[0].kind, 'breath');
  assert.equal(r.pauses[1].kind, 'silence');
  assert.ok(Math.abs(r.pauses[0].start - 1.0) < 0.03 && Math.abs(r.pauses[1].end - 3.1) < 0.03);
});

test('pausas medidas num áudio real (ffmpeg): tom com respiro de ruído baixo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sil-'));
  const f = path.join(dir, 'a.wav');
  // fala = tom 0,4; entre 1,2–1,7 s um "respiro" (ruído baixo); 2,9–3,6 s silêncio
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,1.2,1.7),0.004*(random(0)-0.5),if(between(t,2.9,3.6),0,0.4*sin(2*PI*220*t)))':s=16000:d=4.5", f]);
  const a = await analyzeAudio(f, {minPause: 0.2});
  assert.equal(a.pauses.length, 2, JSON.stringify(a.pauses));
  assert.ok(Math.abs(a.pauses[0].start - 1.2) < 0.05 && Math.abs(a.pauses[0].end - 1.7) < 0.05);
  assert.ok(Math.abs(a.pauses[1].start - 2.9) < 0.05 && Math.abs(a.pauses[1].end - 3.6) < 0.05);
});

test('respiros: corta toda pausa acima do limite, mesmo que a transcrição não veja', () => {
  // respiros de 0,25 s depois de "mostrar" e de "vídeos"…
  const words = W('hoje eu vou mostrar|0.25 como editar seus vídeos|0.25 mais rápido');
  // …que o áudio mede, mas a transcrição "colou" (a palavra anterior vai até a seguinte)
  const pauses = [3, 7].map((i) => ({start: words[i].end, end: words[i + 1].start, kind: 'breath' as const}));
  for (const i of [3, 7]) words[i] = {...words[i], end: words[i + 1].start - 0.01};
  const s = src(6, pauses);
  const tight = buildCuts([s], words, [], {level: 'tight', minPause: 0.2});
  assert.equal(tight.clips.length, 3);
  assert.equal(tight.report.pausesCut, 2);
  // o corte cai no começo do respiro medido, não no fim "esticado" da palavra
  assert.ok(tight.clips[0].outSec <= pauses[0].start + 0.07, JSON.stringify(tight.clips[0]));
  const gentle = buildCuts([s], words, [], {level: 'gentle'});
  assert.equal(gentle.clips.length, 1, 'no suave os respiros curtos ficam');
});

test('erros: gaguejada, palavra refeita, repetição imediata e "éé"', () => {
  const words = W('eu eu fui no mer- mercado éé comprar comprar pão e e leite.');
  const r = smartCut([src(6)], words, {level: 'medium'});
  assert.equal(kept(words, r.clips), 'eu fui no mercado comprar pão e leite.');
});

test('frase dita de novo: fica a última; começo abandonado sai', () => {
  const words = W('o segredo é a constância.|0.6 o segredo é a constância diária.|0.6 hoje eu vou|0.5 hoje eu vou mostrar três dicas.');
  const r = smartCut([src(12)], words, {level: 'medium'});
  assert.equal(kept(words, r.clips), 'o segredo é a constância diária. hoje eu vou mostrar três dicas.');
  assert.ok(r.report.removed.some((x) => /abandonado|repetido/.test(x.reason)));
  assert.ok(r.report.removed.some((x) => /de novo|repetido/.test(x.reason)));
});

test('bastidor sai; anáfora intencional fica', () => {
  const words = W('você precisa de foco.|0.5 pera, vou de novo.|0.6 você precisa de foco.|0.5 você precisa de disciplina.');
  const r = smartCut([src(12)], words, {level: 'medium'});
  assert.equal(kept(words, r.clips), 'você precisa de foco. você precisa de disciplina.');
});

test('sem "remover erros", só os respiros são cortados', () => {
  const words = W('o segredo.|0.8 o segredo é a constância.');
  const r = smartCut([src(6)], words, {level: 'medium', removeMistakes: false});
  assert.equal(kept(words, r.clips), words.map((w) => w.text).join(' '));
  assert.equal(r.clips.length, 2);
});

test('restaurar um trecho removido devolve o clipe na posição certa', () => {
  const words = W('o segredo é a constância.|0.6 o segredo é a constância diária.');
  const r = smartCut([src(6)], words, {level: 'medium'});
  const plan = {...emptyPlan({style: 'dynamic', platform: 'instagram', director: 'heuristic', model: 'regras'}), sources: [src(6)], words, clips: r.clips, cutReport: r.report};
  const x = r.report.removed[0];
  const out = restoreRange(plan, x.sourceId, x.start, x.end);
  assert.equal(out.clips.length, plan.clips.length + 1);
  assert.equal(out.clips[0].label, 'restaurado');
  assert.equal(out.cutReport?.removed.length, r.report.removed.length - 1);
});

test('detectMistakes não mexe em fala limpa', () => {
  const words = W('hoje eu vou te mostrar três formas de crescer no instagram em trinta dias.');
  assert.deepEqual(detectMistakes(words, new Map(), 'medium'), []);
});

test('silêncio que a transcrição "esconde" (palavra esticada, início do vídeo) também sai', () => {
  // fala: "olá pessoal" 1,5–2,3 s · silêncio 2,3–4,6 s (o transcritor esticou "pessoal" até 4,6)
  // · "hoje vamos" 4,6–5,4 · silêncio inicial 0–1,5 s (o transcritor começou "olá" em 0,2)
  const words: Word[] = [
    {text: 'olá', start: 0.2, end: 1.9, sourceId: S},
    {text: 'pessoal', start: 1.9, end: 4.6, sourceId: S},
    {text: 'hoje', start: 4.6, end: 4.95, sourceId: S},
    {text: 'vamos', start: 4.95, end: 5.4, sourceId: S},
  ];
  const pauses: Source['pauses'] = [
    {start: 0, end: 1.5, kind: 'silence'},
    {start: 2.3, end: 4.6, kind: 'silence'},
  ];
  const r = smartCut([src(6, pauses)], words, {level: 'medium', removeMistakes: false});
  const kept = r.clips.reduce((n, c) => n + c.outSec - c.inSec, 0);
  // sobram ~0,8 s + ~0,8 s de fala (+ respiros curtos), não os 5,4 s
  assert.ok(kept < 2.4, JSON.stringify(r.clips));
  for (const p of pauses) for (const c of r.clips) assert.ok(c.outSec <= p.start + 0.1 || c.inSec >= p.end - 0.1, `clipe ${JSON.stringify(c)} cobre o silêncio ${JSON.stringify(p)}`);
  // o encaixe nas palavras não desfaz o corte
  const snapped = snapClipsToWords(r.clips, words, [src(6, pauses)]);
  assert.deepEqual(snapped.map((c) => [c.inSec, c.outSec]), r.clips.map((c) => [c.inSec, c.outSec]));
});

test('fala baixa dentro de um "silêncio" medido não é cortada', () => {
  const words = W('isso aqui é importante');
  const pauses: Source['pauses'] = [{start: words[2].start - 0.1, end: words[2].end + 0.5, kind: 'breath'}];
  const r = smartCut([src(4, pauses)], words, {level: 'gentle', removeMistakes: false});
  assert.equal(kept(words, r.clips), 'isso aqui é importante');
});
