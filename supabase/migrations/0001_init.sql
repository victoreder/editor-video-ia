-- Esquema do editor de vídeo com IA (Supabase / Postgres).
-- Projetos, planos de edição (um por IA diretora) e jobs de processamento.
-- O app usa a service role key no servidor; nada é exposto ao navegador.

create table if not exists public.projects (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  project_id text not null references public.projects(id) on delete cascade,
  variant text not null check (variant in ('claude', 'openai', 'heuristic')),
  plan jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (project_id, variant)
);

create table if not exists public.jobs (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists jobs_project_idx on public.jobs (project_id, updated_at desc);
create index if not exists projects_updated_idx on public.projects (updated_at desc);

alter table public.projects enable row level security;
alter table public.plans enable row level security;
alter table public.jobs enable row level security;
-- sem policies: só a service role (servidor) acessa.
