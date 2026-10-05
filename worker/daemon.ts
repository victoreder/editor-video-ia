// Worker em fila (VPS, fase 3): pega jobs "queued" do banco e roda cada um num
// processo próprio (um render pesado não derruba o daemon).
//   RUNNER=queue WORKER_CONCURRENCY=2 tsx worker/daemon.ts
import {spawn} from 'node:child_process';
import path from 'node:path';
import {getDb} from '../src/lib/adapters/db';

const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 1));
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1500);
const running = new Set<string>();
let stopping = false;

function runChild(jobId: string): Promise<number> {
  return new Promise((resolve) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const child = spawn(tsx, [path.join(process.cwd(), 'worker', 'cli.ts'), jobId], {stdio: 'inherit', env: process.env});
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function loop() {
  const db = getDb();
  console.log(`[daemon] concorrência ${CONCURRENCY}, aguardando jobs…`);
  while (!stopping) {
    if (running.size < CONCURRENCY) {
      const job = await db.claimNextJob().catch((e) => {
        console.error('[daemon] erro ao buscar job', e);
        return null;
      });
      if (job) {
        running.add(job.id);
        console.log(`[daemon] ▶ ${job.type} ${job.id}`);
        runChild(job.id).then((code) => {
          running.delete(job.id);
          console.log(`[daemon] ■ ${job.id} (saída ${code})`);
        });
        continue;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    stopping = true;
    console.log(`[daemon] encerrando; ${running.size} job(s) em andamento terminam sozinhos`);
    setTimeout(() => process.exit(0), 500);
  });

loop();
