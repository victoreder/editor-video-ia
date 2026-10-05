// Runner: onde o processamento pesado roda.
//  - LocalRunner: processo filho `tsx worker/cli.ts <jobId>` (dev e VPS/Docker)
//  - InlineRunner: no mesmo processo (testes)
//  - VercelSandboxRunner: cria uma Vercel Sandbox com ffmpeg + o repositório e roda o mesmo worker
// O worker é o mesmo código nos três; só muda quem o executa.
import {spawn} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {config} from '../../config';

export interface Runner {
  readonly kind: string;
  start(jobId: string): Promise<void>;
}

export class LocalRunner implements Runner {
  readonly kind = 'local';
  async start(jobId: string) {
    const root = process.cwd();
    const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
    const logDir = path.join(config.dataDir, 'logs');
    fs.mkdirSync(logDir, {recursive: true});
    const out = fs.openSync(path.join(logDir, `${jobId}.log`), 'a');
    const child = spawn(tsx, [path.join(root, 'worker', 'cli.ts'), jobId], {
      cwd: root,
      detached: true,
      stdio: ['ignore', out, out],
      env: process.env,
    });
    child.unref();
  }
}

export class InlineRunner implements Runner {
  readonly kind = 'inline';
  async start(jobId: string) {
    const {runJob} = await import('../../pipeline/run-job');
    void runJob(jobId);
  }
}

/**
 * Vercel Sandbox: VM Linux efêmera. Clona o repositório (GIT_REPO_URL), instala
 * ffmpeg e dependências e roda o worker com as mesmas variáveis de ambiente.
 * Requer DB=supabase e STORAGE=vercel-blob (o sandbox não vê o disco da função).
 */
export class VercelSandboxRunner implements Runner {
  readonly kind = 'vercel-sandbox';
  async start(jobId: string) {
    const {Sandbox} = await import('@vercel/sandbox');
    const repo = process.env.GIT_REPO_URL;
    if (!repo) throw new Error('defina GIT_REPO_URL para o VercelSandboxRunner');
    const sandbox = await Sandbox.create({
      source: {url: repo, type: 'git', revision: process.env.GIT_REVISION ?? 'main'},
      resources: {vcpus: Number(process.env.SANDBOX_VCPUS ?? 4)},
      timeout: Number(process.env.SANDBOX_TIMEOUT_MS ?? 45 * 60 * 1000),
      runtime: 'node22',
    });
    const pass = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => /^(DB|STORAGE|SUPABASE_|BLOB_|ANTHROPIC_|OPENAI_|ELEVENLABS_|GROQ_|PEXELS_|REPLICATE_|DIRECTOR|TRANSCRIBER|REMOTION_)/.test(k)),
    ) as Record<string, string>;
    await sandbox.runCommand({cmd: 'bash', args: ['-lc', 'sudo dnf install -y ffmpeg || true; npm ci'], sudo: true});
    await sandbox.runCommand({cmd: 'npx', args: ['tsx', 'worker/cli.ts', jobId], env: {...pass, RUNNER: 'inline'}, detached: true});
  }
}

/**
 * Fila (VPS, fase 3): o job fica "queued" no banco e um ou mais `worker/daemon.ts`
 * (outro container/serviço) pegam e executam, com concorrência controlada.
 */
export class QueueRunner implements Runner {
  readonly kind = 'queue';
  async start() {
    /* o daemon pega da fila */
  }
}

export function getRunner(): Runner {
  if (config.runner === 'queue') return new QueueRunner();
  if (config.runner === 'vercel-sandbox') return new VercelSandboxRunner();
  if (config.runner === 'inline') return new InlineRunner();
  return new LocalRunner();
}
