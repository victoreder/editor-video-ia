// Teste ponta a ponta dos jobs das fases 2/3 num projeto já processado:
//   DATA_DIR=… npx tsx scripts/e2e-extras.ts <projectId> [<reel-de-referencia.mp4>]
import fs from 'node:fs';
import {getDb, type JobType} from '../src/lib/adapters/db';
import {getStorage} from '../src/lib/adapters/storage';
import {runJob} from '../src/lib/pipeline/run-job';
import {uid} from '../src/lib/util/id';

const [projectId, refVideo] = process.argv.slice(2);

async function job(type: JobType, input: Record<string, unknown>, pid = projectId) {
  const db = getDb();
  const id = uid('job');
  const now = new Date().toISOString();
  await db.createJob({id, projectId: pid, type, status: 'queued', progress: 0, label: '', input, createdAt: now, updatedAt: now});
  console.time(type);
  await runJob(id);
  console.timeEnd(type);
  const j = await db.getJob(id);
  console.log(`[${type}] ${j?.status} ${j?.error ?? ''}`);
  return j;
}

async function main() {
  const pp = await job('postpack', {});
  console.log(JSON.stringify((pp?.result as {postpack: unknown})?.postpack, null, 1).slice(0, 600));
  const th = await job('thumbnail', {});
  console.log('capa:', (th?.result as {coverKey?: string})?.coverKey);
  const sh = await job('shorts', {count: 2});
  const r = sh?.result as {moments?: {start: number; end: number; title: string; why: string[]}[]; shorts?: string[]} | undefined;
  for (const m of r?.moments ?? []) console.log(`  momento ${m.start}–${m.end}: ${m.title} (${m.why.join(', ')})`);
  for (const id of r?.shorts ?? []) {
    const p = await getDb().getProject(id);
    const plan = await getDb().getPlan(id, p!.activeVariant!);
    console.log(`  short ${id}: ${p?.name} · ${plan?.clips.length} clipes · ${plan?.captions.chunks.length} legendas · gancho ${plan?.hook?.title}`);
  }
  if (refVideo && fs.existsSync(refVideo)) {
    const key = 'styles/ref/teste.mp4';
    await getStorage().putFile(key, refVideo, 'video/mp4');
    const ref = await job('reference', {key, name: 'Estilo de teste'}, '');
    const st = (ref?.result as {style?: {id: string; name: string; summary: string; palette: unknown; maxStatic: number}})?.style;
    console.log('estilo:', st?.id, st?.name, st?.summary, JSON.stringify(st?.palette), 'maxStatic', st?.maxStatic);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
