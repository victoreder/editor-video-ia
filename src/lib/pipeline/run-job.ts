// Executa um job pelo id (chamado pelo worker/cli.ts em qualquer runner).
// Progresso no formato do autobroll (PROGRESS:pct:label) no log + no banco.
import {getDb, type Job} from '../adapters/db';
import {brollJob, previewJob, processProject, replanProject} from './process';
import {renderJob} from './render';
import {referenceJob} from './reference';
import {matteJob, musicJob, postpackJob, shortsJob, thumbnailJob} from './extras';

/** o servidor de processamento tem ffmpeg? (erro claro em vez de "spawn ffmpeg ENOENT" no meio) */
async function ensureFfmpeg() {
  const {run} = await import('../media/ffmpeg');
  const bin = process.env.FFMPEG_PATH ?? 'ffmpeg';
  try {
    await run(bin, ['-version']);
  } catch {
    const {readFile} = await import('node:fs/promises');
    const install = await readFile('/tmp/ff-install.log', 'utf8').then((s) => s.trim().split('\n').slice(-6).join(' | '), () => '');
    throw new Error(`ffmpeg não encontrado no servidor de processamento (${bin}).${install ? ` Log da instalação: ${install}` : ''}`);
  }
}

class CancelledError extends Error {
  constructor() {
    super('cancelado pelo usuário');
  }
}

export async function runJob(jobId: string): Promise<void> {
  const db = getDb();
  const job = await db.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} não existe`);
  const logs: string[] = [];
  const log = (s: string) => {
    logs.push(s);
    console.log(`[${job.type}] ${s}`);
  };
  // cancelado pelo usuário? (o report confere no banco e interrompe o job)
  const cancelled = async () => (await db.getJob(jobId).catch(() => null))?.status === 'cancelled';
  let lastWrite = 0;
  let lastPct = -1;
  const report = async (pct: number, label: string) => {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    console.log(`PROGRESS:${p}:${label}`);
    const now = Date.now();
    // limita escritas no banco (o render reporta muito)
    if (p === lastPct && now - lastWrite < 3000) return;
    if (now - lastWrite < 700 && p < 100) return;
    lastWrite = now;
    lastPct = p;
    if (await cancelled()) throw new CancelledError();
    await db.updateJob(jobId, {progress: p, label, status: 'running'}).catch(() => undefined);
  };
  if (await cancelled()) return;
  await db.updateJob(jobId, {status: 'running', progress: 1, label: 'Iniciando'});
  try {
    await ensureFfmpeg();
    let result: Record<string, unknown>;
    switch (job.type as Job['type']) {
      case 'preview':
        result = await previewJob(job, report, log);
        break;
      case 'process':
        result = await processProject(job, report, log);
        break;
      case 'replan':
        result = await replanProject(job, report, log);
        break;
      case 'broll':
        result = await brollJob(job, report, log);
        break;
      case 'render':
        result = await renderJob(job, report, log);
        break;
      case 'reference':
        result = await referenceJob(job, report, log);
        break;
      case 'shorts':
        result = await shortsJob(job, report, log);
        break;
      case 'postpack':
        result = await postpackJob(job, report, log);
        break;
      case 'thumbnail':
        result = await thumbnailJob(job, report);
        break;
      case 'matte':
        result = await matteJob(job, report, log);
        break;
      case 'music':
        result = await musicJob(job, report, log);
        break;
      default:
        throw new Error(`tipo de job desconhecido: ${job.type}`);
    }
    if (await cancelled()) return;
    await db.updateJob(jobId, {status: 'done', progress: 100, label: 'Concluído', result: {...result, logs}});
  } catch (e) {
    if (e instanceof CancelledError || (await cancelled())) {
      log('cancelado pelo usuário');
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error(e);
    await db.updateJob(jobId, {status: 'error', label: 'Erro', error: msg, result: {logs}});
    if ((job.type === 'process' || job.type === 'render') && job.projectId) await db.updateProject(job.projectId, {status: job.type === 'render' ? 'ready' : 'error', error: msg}).catch(() => undefined);
  }
}
