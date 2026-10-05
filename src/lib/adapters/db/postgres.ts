// PostgresDb: qualquer Postgres — o da Vercel (Storage → Neon, que cria DATABASE_URL),
// Neon direto, Supabase, ou um Postgres na VPS. As tabelas são criadas sozinhas
// na primeira conexão (não precisa rodar migration à mão).
import type {Pool, PoolClient} from 'pg';
import type {EditPlan} from '../../plan/schema';
import type {Db, Job, PlanVariant, Project} from './types';

const now = () => new Date().toISOString();

const SCHEMA = `
create table if not exists projects (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists plans (project_id text not null references projects(id) on delete cascade, variant text not null, plan jsonb not null, updated_at timestamptz not null default now(), primary key (project_id, variant));
create table if not exists jobs (id text primary key, project_id text, status text not null default 'queued', data jsonb not null, updated_at timestamptz not null default now());
create index if not exists jobs_project_idx on jobs (project_id, updated_at desc);
create index if not exists jobs_queue_idx on jobs (status, updated_at);
create index if not exists projects_updated_idx on projects (updated_at desc);
`;

export class PostgresDb implements Db {
  private poolP: Promise<Pool> | null = null;
  constructor(private url: string) {}

  private pool(): Promise<Pool> {
    this.poolP ??= (async () => {
      const {Pool} = await import('pg');
      const local = /localhost|127\.0\.0\.1|\/tmp|host=\//.test(this.url) || /sslmode=disable/.test(this.url);
      // funções serverless: poucas conexões por instância
      const pool = new Pool({connectionString: this.url, max: Number(process.env.DB_POOL_MAX ?? 3), ssl: local ? undefined : {rejectUnauthorized: false}});
      await pool.query(SCHEMA);
      return pool;
    })();
    return this.poolP;
  }
  private async q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await (await this.pool()).query(text, params)).rows as T[];
  }

  async listProjects() {
    return (await this.q<{data: Project}>('select data from projects order by updated_at desc')).map((r) => r.data);
  }
  async getProject(id: string) {
    return (await this.q<{data: Project}>('select data from projects where id = $1', [id]))[0]?.data ?? null;
  }
  async createProject(p: Project) {
    await this.q('insert into projects (id, data, updated_at) values ($1, $2, $3)', [p.id, p, p.updatedAt]);
    return p;
  }
  async updateProject(id: string, patch: Partial<Project>) {
    // leitura + escrita na mesma transação, com trava na linha (dois jobs não se atropelam)
    return this.tx(async (c) => {
      const cur = (await c.query('select data from projects where id = $1 for update', [id])).rows[0]?.data as Project | undefined;
      if (!cur) throw new Error(`projeto ${id} não existe`);
      const next = {...cur, ...patch, id, updatedAt: now()};
      await c.query('update projects set data = $2, updated_at = $3 where id = $1', [id, next, next.updatedAt]);
      return next;
    });
  }
  async deleteProject(id: string) {
    await this.q('delete from jobs where project_id = $1', [id]);
    await this.q('delete from projects where id = $1', [id]);
  }
  async getPlan(projectId: string, variant: PlanVariant) {
    return (await this.q<{plan: EditPlan}>('select plan from plans where project_id = $1 and variant = $2', [projectId, variant]))[0]?.plan ?? null;
  }
  async savePlan(projectId: string, variant: PlanVariant, plan: EditPlan) {
    await this.q(
      'insert into plans (project_id, variant, plan, updated_at) values ($1, $2, $3, now()) on conflict (project_id, variant) do update set plan = excluded.plan, updated_at = now()',
      [projectId, variant, plan],
    );
  }
  async createJob(j: Job) {
    await this.q('insert into jobs (id, project_id, status, data, updated_at) values ($1, $2, $3, $4, $5)', [j.id, j.projectId || null, j.status, j, j.updatedAt]);
    return j;
  }
  async updateJob(id: string, patch: Partial<Job>) {
    return this.tx(async (c) => {
      const cur = (await c.query('select data from jobs where id = $1 for update', [id])).rows[0]?.data as Job | undefined;
      if (!cur) throw new Error(`job ${id} não existe`);
      const next = {...cur, ...patch, id, updatedAt: now()};
      await c.query('update jobs set data = $2, status = $3, updated_at = $4 where id = $1', [id, next, next.status, next.updatedAt]);
      return next;
    });
  }
  async getJob(id: string) {
    return (await this.q<{data: Job}>('select data from jobs where id = $1', [id]))[0]?.data ?? null;
  }
  async listJobs(projectId: string) {
    return (await this.q<{data: Job}>('select data from jobs where project_id = $1 order by updated_at desc', [projectId])).map((r) => r.data);
  }
  async claimNextJob() {
    // SKIP LOCKED: vários workers pegam jobs diferentes sem brigar
    return this.tx(async (c) => {
      const row = (await c.query("select data from jobs where status = 'queued' order by updated_at limit 1 for update skip locked")).rows[0] as {data: Job} | undefined;
      if (!row) return null;
      const next = {...row.data, status: 'running' as const, label: 'Iniciando', updatedAt: now()};
      await c.query('update jobs set data = $2, status = $3, updated_at = $4 where id = $1', [next.id, next, next.status, next.updatedAt]);
      return next;
    });
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await (await this.pool()).connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async close() {
    if (this.poolP) await (await this.poolP).end();
  }
}
