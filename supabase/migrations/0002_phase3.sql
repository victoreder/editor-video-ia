-- Fases 2/3: jobs sem projeto (ex.: estudo de reel de referência) e fila (RUNNER=queue).
alter table public.jobs alter column project_id drop not null;
alter table public.jobs add column if not exists status text not null default 'queued';
create index if not exists jobs_queue_idx on public.jobs (status, updated_at);
