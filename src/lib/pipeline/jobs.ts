import {getDb, type Job, type JobType} from '../adapters/db';
import {getRunner, stopRunner} from '../adapters/runner';
import {uid} from '../util/id';

/** cria o job no banco e dispara no runner configurado */
export async function enqueue(projectId: string, type: JobType, input: Record<string, unknown> = {}): Promise<Job> {
  const now = new Date().toISOString();
  const job: Job = {id: uid('job'), projectId, type, status: 'queued', progress: 0, label: 'Na fila', input, createdAt: now, updatedAt: now};
  await getDb().createJob(job);
  try {
    const ref = await getRunner().start(job.id);
    if (ref) return await getDb().updateJob(job.id, {runnerRef: ref});
  } catch (e) {
    await getDb().updateJob(job.id, {status: 'error', error: `runner falhou: ${String(e)}`});
    throw e;
  }
  return job;
}

export const isActive = (j: Job) => j.status === 'queued' || j.status === 'running';

/**
 * Para tudo o que está na fila ou rodando no projeto: marca os jobs como
 * cancelados (o worker vê e para), desliga a Sandbox/processo e libera o projeto.
 */
export async function cancelProjectJobs(projectId: string): Promise<number> {
  const db = getDb();
  const active = (await db.listJobs(projectId)).filter(isActive);
  for (const j of active) {
    await db.updateJob(j.id, {status: 'cancelled', label: 'Cancelado', error: 'cancelado pelo usuário'});
    await stopRunner(j.runnerRef).catch((e) => console.warn(`não consegui parar ${j.runnerRef}:`, e));
  }
  const project = await db.getProject(projectId);
  if (project && (project.status === 'processing' || project.status === 'draft' || project.status === 'rendering')) {
    const hasPlan = project.variants.length > 0;
    await db.updateProject(projectId, hasPlan ? {status: 'ready'} : {status: 'error', error: 'Processamento cancelado.'});
  }
  return active.length;
}
