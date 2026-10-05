import {getDb, type Job, type JobType} from '../adapters/db';
import {getRunner} from '../adapters/runner';
import {uid} from '../util/id';

/** cria o job no banco e dispara no runner configurado */
export async function enqueue(projectId: string, type: JobType, input: Record<string, unknown> = {}): Promise<Job> {
  const now = new Date().toISOString();
  const job: Job = {id: uid('job'), projectId, type, status: 'queued', progress: 0, label: 'Na fila', input, createdAt: now, updatedAt: now};
  await getDb().createJob(job);
  try {
    await getRunner().start(job.id);
  } catch (e) {
    await getDb().updateJob(job.id, {status: 'error', error: `runner falhou: ${String(e)}`});
    throw e;
  }
  return job;
}
