// Job "process" (PLANO.md §7): proxy + áudio → transcrição (cache) → correção →
// rosto → cortes/takes → legendas → plano criativo por IA → assets → SFX → pronto.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type {EditPlan, FaceTrack, Source, Word} from '../plan/schema';
import {getDb, type Job, type PlanVariant, type Project} from '../adapters/db';
import {getStorage} from '../adapters/storage';
import {getTranscriber, type Transcript} from '../adapters/transcriber';
import {getDirector, type Director} from '../adapters/director';
import {extractAudio, frameAt, makeProxy, probe} from '../media/ffmpeg';
import {trackFace} from '../media/face';
import {measureGrade} from '../media/grade';
import {analyzeAudio} from '../media/silence';
import {generateMattes} from '../media/matte';
import {resolveProjectStyle} from '../styles/store';
import {readJsonKey} from '../server/json-store';
import {applyProjectMusic} from './music';
import {applyGlossary} from '../modules/captions';
import {resolveBrollAssets, type LibraryAsset} from '../modules/broll-assets';
import {basePlan, finalize, planCreative} from './plan-builder';

export type Reporter = (pct: number, label: string) => Promise<void>;

export const loadLibrary = () => readJsonKey<LibraryAsset[]>('library/index.json', []);

async function cachedTranscript(audioPath: string, project: Project, duration: number, log: (s: string) => void): Promise<Transcript> {
  const storage = getStorage();
  const transcriber = getTranscriber(project.transcriber);
  const hash = crypto.createHash('sha1').update(await fs.readFile(audioPath)).update(transcriber.id).update(transcriber.id === 'script' ? project.script ?? '' : '').digest('hex').slice(0, 16);
  const key = `cache/transcripts/${hash}.json`;
  const tmp = `${audioPath}.transcript.json`;
  try {
    if (await storage.exists(storage.kind === 'vercel-blob' ? storage.publicUrl(key) : key)) {
      await storage.download(key, tmp);
      log('transcrição em cache');
      return JSON.parse(await fs.readFile(tmp, 'utf8')) as Transcript;
    }
  } catch {
    /* sem cache */
  }
  const t = await transcriber.transcribe(audioPath, {language: process.env.TRANSCRIBE_LANGUAGE ?? 'pt', script: project.script, duration});
  await storage.put(key, JSON.stringify(t), 'application/json').catch(() => undefined);
  return t;
}

/** pré-processa cada upload: proxy, áudio, transcrição, rosto */
export async function prepareSources(project: Project, report: Reporter, workDir: string, log: (s: string) => void) {
  const storage = getStorage();
  const sources: Source[] = [];
  const words: Word[] = [];
  const faces: FaceTrack[] = [];
  const grades: EditPlan['grade']['perSource'] = {};
  const n = project.uploads.length;
  let script = project.script;
  for (const [i, up] of project.uploads.entries()) {
    const base = 5 + (i / n) * 55;
    const step = 55 / n;
    const local = path.join(workDir, `src-${up.id}${path.extname(up.name) || '.mp4'}`);
    await report(base, `Baixando ${up.name}`);
    await storage.download(up.key, local);
    const info = await probe(local);
    const proxy = path.join(workDir, `proxy-${up.id}.mp4`);
    await report(base + step * 0.1, `Gerando proxy de ${up.name}`);
    await makeProxy(local, proxy, info.duration, (f) => void report(base + step * (0.1 + f * 0.3), `Gerando proxy de ${up.name}`));
    const pinfo = await probe(proxy);
    const proxyKey = await storage.putFile(`projects/${project.id}/proxy/${up.id}.mp4`, proxy, 'video/mp4');
    let audioKey: string | undefined;
    const audio = path.join(workDir, `audio-${up.id}.mp3`);
    if (pinfo.hasAudio) {
      await extractAudio(proxy, audio);
      audioKey = await storage.putFile(`projects/${project.id}/audio/${up.id}.mp3`, audio, 'audio/mpeg');
    }
    // pausas e respiros medidos no áudio (guardadas a partir de 0,12 s; o corte escolhe o limite)
    let pauses: Source['pauses'];
    if (pinfo.hasAudio) {
      await report(base + step * 0.42, `Medindo pausas e respiros de ${up.name}`);
      try {
        const a = await analyzeAudio(audio, {minPause: 0.12});
        pauses = a.pauses;
        log(`${up.name}: ${a.pauses.filter((p) => p.end - p.start >= 0.3).length} pausas/respiros acima de 0,3 s (fala ${a.speechDb.toFixed(0)} dB, limiar ${a.threshold.toFixed(0)} dB)`);
      } catch (e) {
        log(`medição de pausas falhou (${String(e).slice(0, 100)}); usando só a transcrição`);
      }
    }
    sources.push({id: up.id, name: up.name, key: up.key, proxyKey, audioKey, duration: pinfo.duration, width: pinfo.width, height: pinfo.height, fps: pinfo.fps, hasAudio: pinfo.hasAudio, pauses});
    if (i === 0) {
      const thumb = path.join(workDir, 'thumb.jpg');
      await frameAt(proxy, Math.min(1, pinfo.duration / 2), thumb, 360).catch(() => undefined);
      const thumbKey = await storage.putFile(`projects/${project.id}/thumb.jpg`, thumb, 'image/jpeg').catch(() => undefined);
      if (thumbKey) await getDb().updateProject(project.id, {thumbKey});
    }
    if (pinfo.hasAudio) {
      await report(base + step * 0.45, `Transcrevendo ${up.name}`);
      // o roteiro colado vale para o primeiro arquivo no alinhador sem API
      const t = await cachedTranscript(audio, {...project, script}, pinfo.duration, log);
      if (t.engine.startsWith('script')) script = undefined;
      log(`${up.name}: ${t.words.length} palavras (${t.engine})`);
      words.push(...t.words.map((w) => ({text: w.text, start: w.start, end: w.end, sourceId: up.id, speaker: w.speaker})));
    }
    await report(base + step * 0.75, `Rastreando o rosto em ${up.name}`);
    const face = await trackFace(proxy, up.id, workDir);
    if (face) faces.push(face);
    log(`${up.name}: rosto ${face ? `${face.samples.length} amostras` : 'não encontrado'}`);
    await report(base + step * 0.9, `Medindo a cor de ${up.name}`);
    const g = await measureGrade(proxy, sources[sources.length - 1], face ?? undefined);
    if (g) {
      grades[up.id] = g;
      if (g.notes.length) log(`${up.name}: cor — ${g.notes.join('; ')}`);
    }
  }
  return {sources, words, faces, grades};
}

export async function correctWords(words: Word[], glossary: string[], director: Director, log: (s: string) => void): Promise<Word[]> {
  let out = applyGlossary(words, glossary);
  if (!glossary.length || director.id === 'heuristic') return out;
  try {
    const fixes = await director.correct(out, glossary);
    const valid = fixes.filter((f) => Number.isInteger(f.i) && out[f.i]);
    out = out.map((w, i) => {
      const f = valid.find((x) => x.i === i);
      return f ? {...w, text: f.text} : w;
    });
    out = out.filter((w) => w.text.trim());
    log(`correção da transcrição: ${valid.length} palavras ajustadas`);
  } catch (e) {
    log(`correção pela IA falhou: ${String(e).slice(0, 140)}`);
  }
  return out;
}

export async function processProject(job: Job, report: Reporter, log: (s: string) => void) {
  const db = getDb();
  const project = await db.getProject(job.projectId);
  if (!project) throw new Error('projeto não encontrado');
  if (!project.uploads.length) throw new Error('nenhum vídeo enviado');
  await db.updateProject(project.id, {status: 'processing', error: undefined});
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `proc-${project.id}-`));
  try {
    const {sources, words: rawWords, faces, grades} = await prepareSources(project, report, workDir, log);
    const styleConfig = await resolveProjectStyle(project.style);
    const variants: PlanVariant[] = project.director === 'compare' ? ['claude', 'openai'] : [project.director === 'heuristic' ? 'heuristic' : project.director];
    const primary = getDirector(variants[0]);
    await report(62, 'Corrigindo a transcrição');
    const words = await correctWords(rawWords, project.glossary, primary, log);
    await report(66, 'Escolhendo takes e cortando silêncios');
    const base = await basePlan({sources, words, faceTracks: faces, style: project.style, styleConfig, platform: project.platform, director: primary, level: project.aggressiveness, minPause: project.cutPause, removeMistakes: project.removeMistakes, script: project.script, log});
    base.grade = {...base.grade, perSource: grades};
    await applyProjectMusic(base, project, workDir, log);
    const library = await loadLibrary();
    const saved: PlanVariant[] = [];
    for (const [k, v] of variants.entries()) {
      const director = getDirector(v);
      const pct = 70 + (k / variants.length) * 25;
      await report(pct, `IA diretora (${director.id}): zoom, B-roll, gráficos e sons`);
      let plan: EditPlan = await planCreative({...base, meta: {...base.meta, director: director.id, model: director.model}}, director, log);
      await report(pct + 12 / variants.length, 'Buscando B-roll');
      plan = finalize(await resolveBrollAssets(plan, library, project.id, {allowAi: process.env.BROLL_AI === '1', log}));
      plan = await generateMattes(plan, project.id, workDir, log);
      // se a IA pedida não tinha chave, o plano foi feito por regras: salva como tal
      const variant: PlanVariant = plan.meta.director === 'heuristic' && v !== 'heuristic' && variants.length === 1 ? 'heuristic' : v;
      await db.savePlan(project.id, variant, plan);
      saved.push(variant);
    }
    await db.updateProject(project.id, {status: 'ready', variants: saved, activeVariant: saved[0]});
    await report(100, 'Pronto');
    return {variants: saved};
  } finally {
    await fs.rm(workDir, {recursive: true, force: true}).catch(() => undefined);
  }
}

/** Job "replan": refaz o plano criativo de um variant (mantendo cortes e legendas editados). */
export async function replanProject(job: Job, report: Reporter, log: (s: string) => void) {
  const db = getDb();
  const variant = (job.input.variant as PlanVariant) ?? 'heuristic';
  const director = getDirector((job.input.director as PlanVariant) ?? variant);
  const plan = await db.getPlan(job.projectId, variant);
  if (!plan) throw new Error('plano não encontrado');
  await report(20, `IA diretora (${director.id}) replanejando`);
  let next = await planCreative({...plan, meta: {...plan.meta, director: director.id, model: director.model}}, director, log);
  await report(70, 'Buscando B-roll');
  next = finalize(await resolveBrollAssets(next, await loadLibrary(), job.projectId, {allowAi: process.env.BROLL_AI === '1', log}));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'replan-'));
  next = await generateMattes(next, job.projectId, work, log).finally(() => fs.rm(work, {recursive: true, force: true}));
  await db.savePlan(job.projectId, variant, next);
  await report(100, 'Pronto');
  return {variant};
}

/** Job "broll": busca arquivos para os B-rolls sem src (ex.: o usuário mudou a busca). */
export async function brollJob(job: Job, report: Reporter, log: (s: string) => void) {
  const db = getDb();
  const variant = job.input.variant as PlanVariant;
  const plan = await db.getPlan(job.projectId, variant);
  if (!plan) throw new Error('plano não encontrado');
  await report(30, 'Buscando B-roll');
  const next = finalize(await resolveBrollAssets(plan, await loadLibrary(), job.projectId, {allowAi: true, log}));
  await db.savePlan(job.projectId, variant, next);
  await report(100, 'Pronto');
  return {variant};
}
