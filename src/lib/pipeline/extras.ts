// Jobs das fases 2 e 3: Shorts a partir de vídeo longo, capa, post pack,
// recorte da pessoa e música por IA. Todos reaproveitam o que o "process" já fez
// (proxy, transcrição, rosto) — nada é reprocessado.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getDb, type Job, type PlanVariant, type Project} from '../adapters/db';
import {getStorage, LocalStorage} from '../adapters/storage';
import {bestDirector, getDirector} from '../adapters/director';
import {config} from '../config';
import type {EditPlan} from '../plan/schema';
import {timelineWords} from '../plan/timeline';
import {autoCut, snapClipsToWords} from '../modules/cuts';
import {buildCaptions} from '../modules/captions';
import {findMoments} from '../modules/shorts';
import {POSTPACK_SYSTEM, PostPackSchema, heuristicPostPack} from '../modules/postpack';
import {resolveBrollAssets} from '../modules/broll-assets';
import {startStaticServer} from '../media/static-server';
import {generateMattes} from '../media/matte';
import {uid} from '../util/id';
import {finalize, planCreative} from './plan-builder';
import {loadLibrary, type Reporter} from './process';
import {generateMusic} from './music';
import {mediaMap} from './media-map';
import {renderCover} from './render';

async function planOf(job: Job): Promise<{project: Project; variant: PlanVariant; plan: EditPlan}> {
  const db = getDb();
  const project = await db.getProject(job.projectId);
  if (!project) throw new Error('projeto não encontrado');
  const variant = ((job.input.variant as PlanVariant) ?? project.activeVariant ?? project.variants[0]) as PlanVariant;
  const plan = await db.getPlan(project.id, variant);
  if (!plan) throw new Error('plano não encontrado (processe o vídeo primeiro)');
  return {project, variant, plan};
}

// ---------------------------------------------------------------- vídeo longo → Shorts

export async function shortsJob(job: Job, report: Reporter, log: (s: string) => void) {
  const db = getDb();
  const {project, plan} = await planOf(job);
  const count = Number(job.input.count ?? 3);
  await report(5, 'Procurando os melhores momentos');
  let moments = findMoments(plan.words, {count: count * 2, min: Number(job.input.min ?? 20), max: Number(job.input.max ?? 60)});
  if (!moments.length) throw new Error('nenhum trecho entre 20 e 60 s com frases completas — o vídeo é curto demais para Shorts');
  // a IA escolhe/ordena entre os candidatos e escreve o título de cada um
  const director = bestDirector();
  if (director.id !== 'heuristic') {
    try {
      const {z} = await import('zod');
      const r = await director.json({
        name: 'shorts',
        system: 'Você escolhe os melhores trechos de um vídeo longo para virar Shorts/Reels independentes. Prefira trechos que fazem sentido sem contexto, abrem forte e terminam num ponto. Escreva um título-gancho curto (até 6 palavras, caixa alta) para cada um.',
        user: `CANDIDATOS:\n${moments.map((m, i) => `${i}. [${m.start.toFixed(1)}–${m.end.toFixed(1)} s, nota ${m.score}] ${plan.words.filter((w) => w.sourceId === m.sourceId && w.start >= m.start && w.end <= m.end).map((w) => w.text).join(' ')}`).join('\n\n')}\n\nEscolha os ${count} melhores.`,
        schema: z.object({picks: z.array(z.object({index: z.number(), title: z.string(), why: z.string()}))}),
        effort: 'medium',
      });
      const picked = r.picks.filter((p) => moments[p.index]).map((p) => ({...moments[p.index], title: p.title, why: [p.why, ...moments[p.index].why]}));
      if (picked.length) moments = picked;
    } catch (e) {
      log(`IA dos Shorts falhou (${String(e).slice(0, 120)}); usando a nota das regras`);
    }
  }
  moments = moments.slice(0, count);
  const children: string[] = [];
  for (const [k, m] of moments.entries()) {
    await report(15 + (k / moments.length) * 80, `Editando o Short ${k + 1}/${moments.length}`);
    const words = plan.words.filter((w) => w.sourceId === m.sourceId && w.start >= m.start - 0.05 && w.end <= m.end + 0.05);
    const src = plan.sources.find((s) => s.id === m.sourceId)!;
    let child: EditPlan = {
      ...plan,
      format: {...plan.format, width: 1080, height: 1920},
      sources: [src],
      words,
      faceTracks: plan.faceTracks.filter((f) => f.sourceId === src.id),
      overlays: [],
      broll: [],
      transitions: [],
      camera: {beats: []},
      audio: {...plan.audio, sfx: []},
      hook: {title: m.title.toUpperCase(), until: 2},
    };
    const {clips} = autoCut([{...src, duration: m.end + 0.4}], words, project.aggressiveness, true);
    child.clips = snapClipsToWords(clips.map((c) => ({...c, inSec: Math.max(c.inSec, m.start - 0.12)})), words);
    child.captions = {...child.captions, chunks: buildCaptions(child)};
    const d = getDirector(project.director === 'compare' ? 'claude' : project.director === 'heuristic' ? 'heuristic' : project.director);
    child = await planCreative(child, d, log);
    child.hook = {title: m.title.toUpperCase(), until: 2};
    child = finalize(await resolveBrollAssets(child, await loadLibrary(), project.id, {log}));
    const now = new Date().toISOString();
    const id = uid('prj');
    const variant: PlanVariant = child.meta.director === 'heuristic' ? 'heuristic' : (child.meta.director as PlanVariant);
    await db.createProject({
      ...project,
      id,
      name: `${project.name} — Short ${k + 1}: ${m.title}`,
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      variants: [variant],
      activeVariant: variant,
      exports: [],
      parentId: project.id,
      moment: m,
      shorts: undefined,
      postpack: undefined,
    });
    await db.savePlan(id, variant, child);
    children.push(id);
    log(`Short ${k + 1}: ${m.start.toFixed(1)}–${m.end.toFixed(1)} s "${m.title}" (${m.why.slice(0, 3).join(', ')})`);
  }
  await db.updateProject(project.id, {shorts: [...(project.shorts ?? []), ...children]});
  await report(100, 'Shorts prontos');
  return {shorts: children, moments};
}

// ---------------------------------------------------------------- post pack

export async function postpackJob(job: Job, report: Reporter, log: (s: string) => void) {
  const {project, plan} = await planOf(job);
  await report(20, 'Escrevendo a legenda do post');
  const text = timelineWords(plan).map((w) => w.text).join(' ');
  let pack = heuristicPostPack(text);
  const director = bestDirector();
  if (director.id !== 'heuristic' && text) {
    try {
      pack = await director.json({name: 'postpack', system: POSTPACK_SYSTEM, user: `TRANSCRIÇÃO DO VÍDEO:\n${text}`, schema: PostPackSchema, effort: 'low'});
      pack.hashtags = pack.hashtags.map((h) => h.replace(/^#/, ''));
    } catch (e) {
      log(`post pack pela IA falhou (${String(e).slice(0, 120)}); usando regras`);
    }
  }
  await getDb().updateProject(project.id, {postpack: pack});
  await report(100, 'Pronto');
  return {postpack: pack};
}

// ---------------------------------------------------------------- capa avulsa

export async function thumbnailJob(job: Job, report: Reporter) {
  const {project, plan} = await planOf(job);
  const storage = getStorage();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-'));
  let server: Awaited<ReturnType<typeof startStaticServer>> | null = null;
  try {
    let toUrl = (k: string) => storage.renderUrl(k);
    if (storage instanceof LocalStorage) {
      server = await startStaticServer(path.join(config.dataDir, 'storage'));
      const s = server;
      toUrl = (k) => `${s.url}/${k.split('/').map(encodeURIComponent).join('/')}`;
    }
    await report(20, 'Escolhendo o melhor frame e renderizando a capa');
    const out = path.join(work, 'cover.jpg');
    await renderCover(plan, out, mediaMap(plan, toUrl), (job.input.title as string | undefined) ?? project.postpack?.hook?.toUpperCase());
    const key = await storage.putFile(`projects/${project.id}/cover-${Date.now()}.jpg`, out, 'image/jpeg');
    await getDb().updateProject(project.id, {thumbKey: key});
    await report(100, 'Capa pronta');
    return {coverKey: key, coverUrl: storage.publicUrl(key)};
  } finally {
    await server?.close();
    await fs.rm(work, {recursive: true, force: true}).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- recorte e música

export async function matteJob(job: Job, report: Reporter, log: (s: string) => void) {
  const {project, variant, plan} = await planOf(job);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'matte-'));
  try {
    await report(10, 'Recortando a pessoa (texto atrás)');
    const next = await generateMattes(plan, project.id, work, log);
    await getDb().savePlan(project.id, variant, next);
    await report(100, 'Recorte pronto');
    return {variant};
  } finally {
    await fs.rm(work, {recursive: true, force: true}).catch(() => undefined);
  }
}

export async function musicJob(job: Job, report: Reporter, log: (s: string) => void) {
  const {project, variant, plan} = await planOf(job);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'music-'));
  try {
    await report(10, 'Gerando a trilha');
    const src = await generateMusic(plan, project.id, String(job.input.spec ?? 'ai:'), work, log);
    const style = plan.audio.music?.volume ?? 0.16;
    await getDb().savePlan(project.id, variant, {...plan, audio: {...plan.audio, music: {src, volume: style, startSec: 0, fadeOutSec: 1.5, duck: true, duckLevel: 0.3}}});
    await report(100, 'Trilha pronta');
    return {variant, src};
  } finally {
    await fs.rm(work, {recursive: true, force: true}).catch(() => undefined);
  }
}
