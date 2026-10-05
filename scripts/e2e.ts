// Teste ponta a ponta sem servidor: cria um projeto, sobe um vídeo, roda o job
// "process" e (opcional) o "render" no mesmo processo.
//   DATA_DIR=/tmp/x npx tsx scripts/e2e.ts <video.mp4> [--render] [--director heuristic|claude|openai|compare]
import fs from 'node:fs';
import path from 'node:path';
import {getDb, type Project} from '../src/lib/adapters/db';
import {getStorage} from '../src/lib/adapters/storage';
import {runJob} from '../src/lib/pipeline/run-job';
import {uid} from '../src/lib/util/id';
import {runQa} from '../src/lib/modules/qa';

const video = process.argv[2];
const doRender = process.argv.includes('--render');
const dIdx = process.argv.indexOf('--director');
const director = (dIdx > 0 ? process.argv[dIdx + 1] : 'heuristic') as Project['director'];
if (!video || !fs.existsSync(video)) {
  console.error('uso: tsx scripts/e2e.ts <video.mp4> [--render]');
  process.exit(1);
}

const SCRIPT = `Hoje eu vou te mostrar como a inteligência artificial pode triplicar suas vendas. Em 30 dias, nossos clientes cresceram 87%. O segredo não é trabalhar mais. São três coisas: conteúdo, constância, automação. Isso muda o jogo do seu negócio. Segue para mais dicas!`;

async function main() {
  const db = getDb();
  const storage = getStorage();
  const id = uid('prj');
  const upId = uid('src');
  const key = `projects/${id}/uploads/${upId}${path.extname(video)}`;
  await storage.putFile(key, video, 'video/mp4');
  const now = new Date().toISOString();
  await db.createProject({
    id, name: 'Teste E2E', createdAt: now, updatedAt: now, style: 'dynamic', platform: 'instagram', director, transcriber: 'script',
    glossary: [], script: SCRIPT, aggressiveness: 'medium', status: 'draft', uploads: [{id: upId, name: path.basename(video), key, size: fs.statSync(video).size, contentType: 'video/mp4'}],
    variants: [], exports: [], musicKey: 'builtin:music/upbeat.mp3',
  });
  const jobId = uid('job');
  await db.createJob({id: jobId, projectId: id, type: 'process', status: 'queued', progress: 0, label: '', input: {}, createdAt: now, updatedAt: now});
  console.time('process');
  await runJob(jobId);
  console.timeEnd('process');
  const job = await db.getJob(jobId);
  console.log('job:', job?.status, job?.error ?? '', (job?.result?.logs as string[] | undefined)?.join('\n  '));
  const project = await db.getProject(id);
  const variant = project!.variants[0];
  const plan = await db.getPlan(id, variant);
  if (!plan) throw new Error('sem plano');
  console.log(`plano ${variant}: ${plan.clips.length} clipes, ${plan.words.length} palavras, ${plan.captions.chunks.length} legendas, ${plan.camera.beats.length} zooms, ${plan.overlays.length} gráficos, ${plan.broll.length} b-rolls, ${plan.transitions.length} transições, ${plan.audio.sfx.length} sfx`);
  for (const q of runQa(plan)) console.log(`  QA[${q.level}] ${q.message}`);
  if (doRender) {
    const rj = uid('job');
    await db.createJob({id: rj, projectId: id, type: 'render', status: 'queued', progress: 0, label: '', input: {variant, formats: ['vertical']}, createdAt: now, updatedAt: now});
    console.time('render');
    await runJob(rj);
    console.timeEnd('render');
    const r = await db.getJob(rj);
    console.log('render:', r?.status, r?.error ?? '', JSON.stringify(r?.result?.exports ?? null));
  }
  console.log('projeto:', id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
