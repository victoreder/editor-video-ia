// Executa um job pelo id (chamado pelo worker/cli.ts em qualquer runner).
// Progresso no formato do autobroll (PROGRESS:pct:label) no log + no banco.
import {getDb, type Job} from '../adapters/db';
import {brollJob, processProject, replanProject} from './process';
import {renderJob} from './render';

export async function runJob(jobId: string): Promise<void> {
  const db = getDb();
  const job = await db.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} não existe`);
  const logs: string[] = [];
  const log = (s: string) => {
    logs.push(s);
    console.log(`[${job.type}] ${s}`);
  };
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
    await db.updateJob(jobId, {progress: p, label, status: 'running'}).catch(() => undefined);
  };
  await db.updateJob(jobId, {status: 'running', progress: 1, label: 'Iniciando'});
  try {
    let result: Record<string, unknown>;
    switch (job.type as Job['type']) {
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
      default:
        throw new Error(`tipo de job desconhecido: ${job.type}`);
    }
    await db.updateJob(jobId, {status: 'done', progress: 100, label: 'Concluído', result: {...result, logs}});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(e);
    await db.updateJob(jobId, {status: 'error', label: 'Erro', error: msg, result: {logs}});
    if (job.type === 'process' || job.type === 'render') await db.updateProject(job.projectId, {status: job.type === 'render' ? 'ready' : 'error', error: msg}).catch(() => undefined);
  }
}
