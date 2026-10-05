'use client';
import {useEffect, useMemo, useState} from 'react';
import Link from 'next/link';
import {api, type AppConfig, type ProjectView} from '@/lib/client/api';
import type {Project} from '@/lib/adapters/db/types';
import {AppShell, Page, PageHeader} from './ui/AppShell';
import {Icon, Spinner} from './ui/Icon';
import {DIRECTOR_LABEL, STATUS_LABEL, StatusBadge, timeAgo} from './ui/status';

type Filter = 'all' | Project['status'];

export default function Home() {
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    // atualiza sozinho enquanto algum vídeo está processando/exportando
    const load = async () => {
      const r = await api<{projects: ProjectView[]}>('/api/projects').catch(() => ({projects: [] as ProjectView[]}));
      if (stop) return;
      setProjects(r.projects);
      if (r.projects.some((p) => p.status === 'processing' || p.status === 'rendering')) timer = setTimeout(load, 4000);
    };
    load();
    api<AppConfig>('/api/config').then(setCfg).catch(() => undefined);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {all: projects?.length ?? 0};
    for (const p of projects ?? []) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [projects]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (projects ?? [])
      .filter((p) => filter === 'all' || p.status === filter)
      .filter((p) => !term || p.name.toLowerCase().includes(term))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [projects, q, filter]);

  const remove = async (p: ProjectView) => {
    if (!confirm(`Excluir "${p.name}"? O vídeo e as edições serão apagados.`)) return;
    try {
      await api(`/api/projects/${p.id}`, {method: 'DELETE'});
      setProjects((cur) => cur?.filter((x) => x.id !== p.id) ?? null);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <AppShell>
      <Page>
        <PageHeader
          title="Projetos"
          subtitle="Reels, TikTok e Shorts: legendas animadas, zoom, B-roll, gráficos e sons — automáticos e ajustáveis."
          actions={
            <Link href="/projects/new" className="btn-primary btn-lg">
              <Icon name="upload" /> Subir vídeo
            </Link>
          }
        />

        {cfg && <SetupHints cfg={cfg} />}

        {projects === null ? (
          <Grid>
            {Array.from({length: 5}, (_, i) => (
              <div key={i} className="card overflow-hidden">
                <div className="skeleton aspect-[9/16]" />
                <div className="space-y-2 p-3">
                  <div className="skeleton h-3.5 w-3/4 rounded" />
                  <div className="skeleton h-3 w-1/2 rounded" />
                </div>
              </div>
            ))}
          </Grid>
        ) : projects.length === 0 ? (
          <Empty />
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-panel p-1">
                {(['all', 'ready', 'processing', 'draft', 'error'] as const).map((f) =>
                  f !== 'all' && !counts[f] ? null : (
                    <button key={f} className={filter === f ? 'tab-on' : 'tab'} onClick={() => setFilter(f)}>
                      {f === 'all' ? 'Todos' : STATUS_LABEL[f]}
                      <span className="text-xs font-medium text-subtle">{counts[f] ?? 0}</span>
                    </button>
                  ),
                )}
              </div>
              <div className="relative ml-auto w-full sm:w-64">
                <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
                <input className="input pl-9" placeholder="Buscar projeto…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            {shown.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted">Nenhum projeto encontrado.</p>
            ) : (
              <Grid>
                {shown.map((p) => (
                  <ProjectCard key={p.id} p={p} onDelete={() => remove(p)} />
                ))}
              </Grid>
            )}
          </>
        )}
      </Page>
    </AppShell>
  );
}

const Grid = ({children}: {children: React.ReactNode}) => <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{children}</div>;

function ProjectCard({p, onDelete}: {p: ProjectView; onDelete: () => void}) {
  const busy = p.status === 'processing' || p.status === 'rendering';
  return (
    <div className="group relative animate-fade-in">
      <Link href={`/projects/${p.id}`} className="card block overflow-hidden transition hover:-translate-y-0.5 hover:border-line2 hover:shadow-pop">
        <div className="relative aspect-[9/16] bg-panel2">
          {p.thumbUrl ? (
            <img src={p.thumbUrl} alt="" className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-subtle">
              {busy ? <Spinner size={22} className="text-brand" /> : <Icon name="film" size={28} />}
              {busy && <span className="text-xs text-muted">{STATUS_LABEL[p.status]}…</span>}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-2 left-2">
            <StatusBadge status={p.status} />
          </div>
          {p.parentId && <span className="badge absolute top-2 left-2 bg-black/60 text-brand2">Short</span>}
        </div>
        <div className="p-3">
          <div className="truncate text-sm font-semibold">{p.name}</div>
          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
            <span className="truncate">{DIRECTOR_LABEL[p.director]}</span>
            <span className="shrink-0">{timeAgo(p.updatedAt)}</span>
          </div>
        </div>
      </Link>
      <button
        title="Excluir"
        aria-label={`Excluir ${p.name}`}
        className="absolute top-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-black/70 text-red-300 opacity-100 backdrop-blur transition hover:bg-black/90 sm:opacity-0 sm:group-hover:opacity-100"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
      >
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}

function Empty() {
  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/15 text-brand">
        <Icon name="sparkles" size={26} />
      </div>
      <h2 className="text-lg font-bold">Seu primeiro vídeo editado pela IA</h2>
      <p className="mt-2 max-w-md text-sm text-muted">Suba o vídeo cru (um ou vários takes). A IA corta as pausas e os erros, coloca legenda, zoom, B-roll, gráficos e sons. Depois é só ajustar no editor.</p>
      <Link href="/projects/new" className="btn-primary btn-lg mt-6">
        <Icon name="upload" /> Subir o primeiro vídeo
      </Link>
    </div>
  );
}

function SetupHints({cfg}: {cfg: AppConfig}) {
  const missing = missingKeys(cfg);
  if (!missing.length) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warn/25 bg-warn/[0.06] px-4 py-3 text-sm">
      <Icon name="alert" className="text-warn" />
      <span>
        <b className="text-warn">Modo limitado</b> <span className="text-muted">— {missing.length} integração(ões) sem chave. O editor usa regras no lugar da IA.</span>
      </span>
      <Link href="/settings" className="btn-sm btn-ghost ml-auto">
        Ver integrações
      </Link>
    </div>
  );
}

export function missingKeys(cfg: AppConfig) {
  const missing: string[] = [];
  if (!cfg.directors.includes('claude')) missing.push('claude');
  if (!cfg.directors.includes('openai')) missing.push('openai');
  if (!cfg.transcribers.some((t) => t !== 'script')) missing.push('transcriber');
  if (!cfg.pexels) missing.push('pexels');
  return missing;
}
