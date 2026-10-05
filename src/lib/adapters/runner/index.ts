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
  /** dispara o job; devolve uma referência para poder parar depois (pid, nome da Sandbox) */
  start(jobId: string): Promise<string | void>;
}

/** apaga todas as snapshots da Sandbox deste projeto (o editor não usa nenhuma) */
export async function cleanupSandboxSnapshots(): Promise<{deleted: number; bytes: number; sandboxes: number}> {
  const {Sandbox, Snapshot} = await import('@vercel/sandbox');
  let deleted = 0;
  let bytes = 0;
  let sandboxes = 0;
  // máquinas antigas paradas (persistentes) seguram as snapshots: apaga as que não estão rodando
  for await (const s of await Sandbox.list()) {
    if (s.status === 'running' || s.status === 'pending' || s.status === 'snapshotting') continue;
    try {
      await (await Sandbox.get({name: s.name})).delete({deleteOrphanSnapshots: true});
      sandboxes++;
    } catch (e) {
      console.warn(`sandbox ${s.name} não apagada:`, String(e).slice(0, 120));
    }
  }
  for await (const s of await Snapshot.list()) {
    if (s.status === 'deleted') continue;
    try {
      await (await Snapshot.get({snapshotId: s.id})).delete();
      deleted++;
      bytes += s.sizeBytes ?? 0;
    } catch (e) {
      console.warn(`snapshot ${s.id} não apagada:`, String(e).slice(0, 120));
    }
  }
  return {deleted, bytes, sandboxes};
}

/** para um job em execução pela referência devolvida no start (melhor esforço) */
export async function stopRunner(ref: string | undefined): Promise<void> {
  if (!ref) return;
  const [kind, id] = ref.split(':');
  if (kind === 'pid') {
    try {
      process.kill(-Number(id), 'SIGTERM'); // grupo do processo (detached)
    } catch {
      /* já terminou */
    }
  } else if (kind === 'sandbox') {
    const {Sandbox} = await import('@vercel/sandbox');
    const sb = await Sandbox.get({name: id});
    await sb.delete({deleteOrphanSnapshots: true}).catch(() => sb.stop());
  }
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
    return child.pid ? `pid:${child.pid}` : undefined;
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
    // padrão: o próprio repositório do deploy (variáveis de sistema da Vercel)
    const repo =
      process.env.GIT_REPO_URL ||
      (process.env.VERCEL_GIT_PROVIDER === 'github' && process.env.VERCEL_GIT_REPO_OWNER ? `https://github.com/${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}.git` : '');
    if (!repo) throw new Error('defina GIT_REPO_URL para o VercelSandboxRunner');
    // repositório privado: usuário + token do GitHub (permissão de leitura)
    const auth = process.env.GIT_TOKEN ? {username: process.env.GIT_USERNAME ?? 'x-access-token', password: process.env.GIT_TOKEN} : {};
    // cada job começa do zero: sem snapshot do disco (persistent: false). As snapshots que
    // as versões anteriores deixaram são apagadas antes (elas lotam a cota do plano Hobby).
    await cleanupSandboxSnapshots().catch((e) => console.warn('limpeza de snapshots falhou:', String(e).slice(0, 200)));
    const create = () =>
      Sandbox.create({
        source: {url: repo, type: 'git', revision: process.env.GIT_REVISION ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'main', ...auth},
        resources: {vcpus: Number(process.env.SANDBOX_VCPUS ?? 4)},
        timeout: Number(process.env.SANDBOX_TIMEOUT_MS ?? 45 * 60 * 1000),
        runtime: 'node22',
        persistent: false,
      });
    const sandbox = await create().catch((e) => {
      if (/402|snapshot/i.test(String(e))) {
        throw new Error(
          `A Vercel Sandbox bloqueou: limite do plano Hobby de "Snapshots Storage" (as snapshots antigas já foram apagadas; a cota volta no início do mês). Para não depender disso, rode o processamento no seu servidor (RUNNER=queue — veja docs/worker-vps.md). Detalhe: ${String(e).slice(0, 300)}`,
        );
      }
      throw e;
    });
    const pass = Object.fromEntries(
      Object.entries(process.env).filter(([k]) =>
        /^(DB|DATABASE_URL|POSTGRES_URL|STORAGE|SUPABASE_|BLOB_|ANTHROPIC_|OPENAI_|ELEVENLABS_|GROQ_|PEXELS_|REPLICATE_|DIRECTOR|TRANSCRIBER|TRANSCRIBE_|REMOTION_|RENDERER|BROLL_|MUSIC_|S3_)/.test(k),
      ),
    ) as Record<string, string>;
    // Blob no modo sem chave: a Sandbox não recebe OIDC sozinha, então leva o token desta função
    if (process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
      const {getVercelOidcToken} = await import('@vercel/oidc');
      pass.VERCEL_OIDC_TOKEN = await getVercelOidcToken();
    }
    // Tudo num único comando destacado: a função da Vercel só dispara e responde na hora;
    // a instalação (minutos) e o job rodam dentro da Sandbox. O progresso vai para o banco.
    const setup = [
      'set -e',
      // ffmpeg + ffprobe estáticos (3 fontes, só aceita binário que roda — worker/install-ffmpeg.sh).
      // Se falhar, segue: o worker confere o ffmpeg e grava o erro (com este log) no projeto
      'export PATH=/tmp/ff:$PATH FFMPEG_PATH=/tmp/ff/ffmpeg FFPROBE_PATH=/tmp/ff/ffprobe',
      '(bash worker/install-ffmpeg.sh /tmp/ff > /tmp/ff-install.log 2>&1 || true)',
      // bibliotecas do Chromium do Remotion e Python do rosto/recorte (opcionais: sem eles o app usa o enquadramento padrão)
      'sudo dnf install -y -q nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXfixes libXrandr mesa-libgbm pango alsa-lib python3-pip mesa-libGL >/dev/null 2>&1 || true',
      'pip3 install -q -r worker/requirements.txt >/dev/null 2>&1 || true',
      'npm ci --no-audit --no-fund',
      `npx tsx worker/cli.ts ${jobId}`,
    ].join(' && ');
    // roda o job e, dando certo ou não, desliga e apaga a própria Sandbox
    const script = `(${setup}); status=$?; npx tsx worker/sandbox-stop.ts || true; exit $status`;
    const {getVercelOidcToken} = await import('@vercel/oidc');
    const oidc = pass.VERCEL_OIDC_TOKEN ?? (await getVercelOidcToken().catch(() => ''));
    await sandbox.runCommand({cmd: 'bash', args: ['-lc', script], env: {...pass, RUNNER: 'inline', SANDBOX_NAME: sandbox.name, ...(oidc ? {VERCEL_OIDC_TOKEN: oidc} : {})}, detached: true});
    return `sandbox:${sandbox.name}`;
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
