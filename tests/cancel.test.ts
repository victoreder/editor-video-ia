// Parar processamento: o job vira "cancelado", o worker para e o projeto é liberado.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('cancelar libera o projeto e o worker não sobrescreve o status', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-'));
  process.env.DB = 'local';
  const {getDb} = await import('../src/lib/adapters/db');
  const {cancelProjectJobs} = await import('../src/lib/pipeline/jobs');
  const {runJob} = await import('../src/lib/pipeline/run-job');
  const db = getDb();
  const now = new Date().toISOString();
  await db.createProject({id: 'p1', name: 'x', createdAt: now, updatedAt: now, style: 'dynamic', platform: 'instagram', director: 'heuristic', glossary: [], aggressiveness: 'medium', status: 'processing', uploads: [], variants: [], exports: []});
  await db.createJob({id: 'j1', projectId: 'p1', type: 'process', status: 'running', progress: 0, label: 'x', input: {}, createdAt: now, updatedAt: now});
  assert.equal(await cancelProjectJobs('p1'), 1);
  assert.equal((await db.getJob('j1'))?.status, 'cancelled');
  const p = await db.getProject('p1');
  assert.equal(p?.status, 'error');
  assert.match(p?.error ?? '', /cancelado/);
  // o worker que ainda estava vivo não "ressuscita" o job
  await runJob('j1');
  assert.equal((await db.getJob('j1'))?.status, 'cancelled');
  // nada mais ativo
  assert.equal(await cancelProjectJobs('p1'), 0);
});
