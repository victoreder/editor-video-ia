// Adaptador Postgres (Vercel/Neon/VPS). Roda só quando há um banco de teste:
//   TEST_DATABASE_URL=postgresql://postgres@localhost:5433/postgres npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PostgresDb} from '../src/lib/adapters/db/postgres';
import {emptyPlan} from '../src/lib/pipeline/plan-builder';

const url = process.env.TEST_DATABASE_URL;

test('Postgres: projetos, planos, jobs e fila sem duplicar', {skip: !url && 'defina TEST_DATABASE_URL'}, async () => {
  const {Client} = await import('pg');
  const c = new Client({connectionString: url});
  await c.connect();
  await c.query('drop table if exists plans, jobs, projects cascade');
  await c.end();

  const db = new PostgresDb(url!);
  const now = new Date().toISOString();
  const base = {name: 'P', createdAt: now, updatedAt: now, style: 'dynamic', platform: 'instagram' as const, director: 'heuristic' as const, glossary: [], aggressiveness: 'medium' as const, status: 'draft' as const, uploads: [], variants: [], exports: []};
  await db.createProject({...base, id: 'p1'});
  await db.createProject({...base, id: 'p2', name: 'Segundo'});
  // atualizações simultâneas não se perdem (trava na linha)
  await Promise.all([db.updateProject('p1', {name: 'Novo'}), db.updateProject('p1', {status: 'ready'})]);
  const p1 = await db.getProject('p1');
  assert.equal(p1?.name, 'Novo');
  assert.equal(p1?.status, 'ready');
  assert.equal((await db.listProjects()).length, 2);

  const plan = emptyPlan({style: 'dynamic', platform: 'instagram', director: 'heuristic', model: 'regras'});
  await db.savePlan('p1', 'heuristic', plan);
  await db.savePlan('p1', 'heuristic', {...plan, style: 'pop'});
  assert.equal((await db.getPlan('p1', 'heuristic'))?.style, 'pop');

  for (const id of ['a', 'b', 'c']) await db.createJob({id, projectId: id === 'c' ? '' : 'p1', type: 'render', status: 'queued', progress: 0, label: '', input: {}, createdAt: now, updatedAt: now});
  await db.updateJob('a', {progress: 50});
  assert.equal((await db.getJob('a'))?.progress, 50);
  const claimed = await Promise.all([1, 2, 3, 4, 5].map(() => db.claimNextJob()));
  assert.deepEqual(claimed.filter(Boolean).map((j) => j!.id).sort(), ['a', 'b', 'c']);
  assert.equal((await db.listJobs('p1')).length, 2);

  await db.deleteProject('p1');
  assert.equal(await db.getProject('p1'), null);
  assert.equal(await db.getPlan('p1', 'heuristic'), null);
  await db.close();
});
