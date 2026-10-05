// Banco: LocalJsonDb (arquivos JSON em DATA_DIR, para dev/VPS simples) ou
// SupabaseDb (Postgres; esquema em supabase/migrations). Mesma interface.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {config} from '../../config';
import type {EditPlan} from '../../plan/schema';
import type {Db, Job, PlanVariant, Project} from './types';

export * from './types';

const now = () => new Date().toISOString();

async function writeJsonAtomic(file: string, data: unknown) {
  await fsp.mkdir(path.dirname(file), {recursive: true});
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 1));
  await fsp.rename(tmp, file);
}
async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export class LocalJsonDb implements Db {
  constructor(private root = path.join(config.dataDir, 'db')) {}
  private pFile = (id: string) => path.join(this.root, 'projects', id, 'project.json');
  private planFile = (id: string, v: PlanVariant) => path.join(this.root, 'projects', id, `plan.${v}.json`);
  private jFile = (id: string) => path.join(this.root, 'jobs', `${id}.json`);

  async listProjects() {
    const dir = path.join(this.root, 'projects');
    if (!fs.existsSync(dir)) return [];
    const ids = await fsp.readdir(dir);
    const ps = (await Promise.all(ids.map((id) => readJson<Project>(this.pFile(id))))).filter(Boolean) as Project[];
    return ps.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  getProject(id: string) {
    return readJson<Project>(this.pFile(id));
  }
  async createProject(p: Project) {
    await writeJsonAtomic(this.pFile(p.id), p);
    return p;
  }
  async updateProject(id: string, patch: Partial<Project>) {
    const cur = await this.getProject(id);
    if (!cur) throw new Error(`projeto ${id} não existe`);
    const next = {...cur, ...patch, id, updatedAt: now()};
    await writeJsonAtomic(this.pFile(id), next);
    return next;
  }
  async deleteProject(id: string) {
    await fsp.rm(path.join(this.root, 'projects', id), {recursive: true, force: true});
  }
  getPlan(projectId: string, variant: PlanVariant) {
    return readJson<EditPlan>(this.planFile(projectId, variant));
  }
  async savePlan(projectId: string, variant: PlanVariant, plan: EditPlan) {
    await writeJsonAtomic(this.planFile(projectId, variant), plan);
  }
  async createJob(j: Job) {
    await writeJsonAtomic(this.jFile(j.id), j);
    return j;
  }
  async updateJob(id: string, patch: Partial<Job>) {
    const cur = await this.getJob(id);
    if (!cur) throw new Error(`job ${id} não existe`);
    const next = {...cur, ...patch, id, updatedAt: now()};
    await writeJsonAtomic(this.jFile(id), next);
    return next;
  }
  getJob(id: string) {
    return readJson<Job>(this.jFile(id));
  }
  async listJobs(projectId: string) {
    const dir = path.join(this.root, 'jobs');
    if (!fs.existsSync(dir)) return [];
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json'));
    const jobs = (await Promise.all(files.map((f) => readJson<Job>(path.join(dir, f))))).filter((j): j is Job => !!j && j.projectId === projectId);
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async claimNextJob() {
    const dir = path.join(this.root, 'jobs');
    if (!fs.existsSync(dir)) return null;
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json'));
    const queued = (await Promise.all(files.map((f) => readJson<Job>(path.join(dir, f))))).filter((j): j is Job => !!j && j.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const j of queued) {
      try {
        // trava atômica: só um worker consegue criar o .lock
        await fsp.writeFile(path.join(dir, `${j.id}.lock`), String(process.pid), {flag: 'wx'});
        return await this.updateJob(j.id, {status: 'running', label: 'Iniciando'});
      } catch {
        /* outro worker pegou */
      }
    }
    return null;
  }
}

export class SupabaseDb implements Db {
  private clientP = (async () => {
    const {createClient} = await import('@supabase/supabase-js');
    return createClient(config.supabase.url, config.supabase.serviceKey, {auth: {persistSession: false}});
  })();
  private async q() {
    return this.clientP;
  }
  async listProjects() {
    const {data, error} = await (await this.q()).from('projects').select('data').order('updated_at', {ascending: false});
    if (error) throw error;
    return (data ?? []).map((r) => r.data as Project);
  }
  async getProject(id: string) {
    const {data, error} = await (await this.q()).from('projects').select('data').eq('id', id).maybeSingle();
    if (error) throw error;
    return (data?.data as Project) ?? null;
  }
  async createProject(p: Project) {
    const {error} = await (await this.q()).from('projects').insert({id: p.id, data: p, updated_at: p.updatedAt});
    if (error) throw error;
    return p;
  }
  async updateProject(id: string, patch: Partial<Project>) {
    const cur = await this.getProject(id);
    if (!cur) throw new Error(`projeto ${id} não existe`);
    const next = {...cur, ...patch, id, updatedAt: now()};
    const {error} = await (await this.q()).from('projects').update({data: next, updated_at: next.updatedAt}).eq('id', id);
    if (error) throw error;
    return next;
  }
  async deleteProject(id: string) {
    const c = await this.q();
    await c.from('plans').delete().eq('project_id', id);
    await c.from('jobs').delete().eq('project_id', id);
    const {error} = await c.from('projects').delete().eq('id', id);
    if (error) throw error;
  }
  async getPlan(projectId: string, variant: PlanVariant) {
    const {data, error} = await (await this.q()).from('plans').select('plan').eq('project_id', projectId).eq('variant', variant).maybeSingle();
    if (error) throw error;
    return (data?.plan as EditPlan) ?? null;
  }
  async savePlan(projectId: string, variant: PlanVariant, plan: EditPlan) {
    const {error} = await (await this.q()).from('plans').upsert({project_id: projectId, variant, plan, updated_at: now()}, {onConflict: 'project_id,variant'});
    if (error) throw error;
  }
  async createJob(j: Job) {
    const {error} = await (await this.q()).from('jobs').insert({id: j.id, project_id: j.projectId || null, status: j.status, data: j, updated_at: j.updatedAt});
    if (error) throw error;
    return j;
  }
  async updateJob(id: string, patch: Partial<Job>) {
    const cur = await this.getJob(id);
    if (!cur) throw new Error(`job ${id} não existe`);
    const next = {...cur, ...patch, id, updatedAt: now()};
    const {error} = await (await this.q()).from('jobs').update({data: next, status: next.status, updated_at: next.updatedAt}).eq('id', id);
    if (error) throw error;
    return next;
  }
  async getJob(id: string) {
    const {data, error} = await (await this.q()).from('jobs').select('data').eq('id', id).maybeSingle();
    if (error) throw error;
    return (data?.data as Job) ?? null;
  }
  async listJobs(projectId: string) {
    const {data, error} = await (await this.q()).from('jobs').select('data').eq('project_id', projectId).order('updated_at', {ascending: false});
    if (error) throw error;
    return (data ?? []).map((r) => r.data as Job);
  }
  async claimNextJob() {
    const c = await this.q();
    const {data} = await c.from('jobs').select('id, data').eq('status', 'queued').order('updated_at', {ascending: true}).limit(5);
    for (const row of data ?? []) {
      const job = {...(row.data as Job), status: 'running' as const, label: 'Iniciando', updatedAt: now()};
      // só atualiza se ainda estiver na fila (dois workers não pegam o mesmo)
      const {data: upd} = await c.from('jobs').update({data: job, status: 'running', updated_at: job.updatedAt}).eq('id', row.id).eq('status', 'queued').select('id');
      if (upd?.length) return job;
    }
    return null;
  }
}

let instance: Db | null = null;
export function getDb(): Db {
  if (!instance) instance = config.db === 'supabase' ? new SupabaseDb() : new LocalJsonDb();
  return instance;
}
