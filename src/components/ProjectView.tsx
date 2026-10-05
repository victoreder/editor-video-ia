'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {Player, type PlayerRef} from '@remotion/player';
import {Reel} from '@/remotion/Reel';
import {planDurationFrames} from '@/lib/plan/timeline';
import {api, getPlan, runProjectJob, type ProjectView as PV} from '@/lib/client/api';
import type {Job} from '@/lib/adapters/db/types';
import type {EditPlan} from '@/lib/plan/schema';
import {Editor} from '@/editor/Editor';
import {useEditor} from '@/editor/store';
import {AppShell, Page, PageHeader} from './ui/AppShell';
import {Icon, Spinner} from './ui/Icon';
import {DIRECTOR_LABEL, PLATFORM_LABEL, StatusBadge, timeAgo} from './ui/status';

type Loaded = {project: PV; jobs: Job[]};
const LABEL: Record<string, string> = {claude: 'Claude', openai: 'OpenAI', heuristic: 'Regras (sem IA)'};

export default function ProjectView({id}: {id: string}) {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const loadedVariant = useEditor((s) => (s.projectId === id ? s.variant : null));

  const load = useCallback(async () => {
    try {
      const r = await api<Loaded>(`/api/projects/${id}`);
      setData(r);
      return r;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [id]);

  // acompanha o processamento
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await load();
      if (stop || !r) return;
      if (r.project.status === 'processing' || r.project.status === 'draft') setTimeout(tick, 1500);
      else if (r.project.status === 'ready' && r.project.variants.length > 1 && !variant) setComparing(true);
    };
    tick();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const [previewMsg, setPreviewMsg] = useState<string | null>(null);
  const previewStarted = useRef(false);
  /** troca só as URLs de mídia (sem mexer no plano que está sendo editado) */
  const refreshMedia = useCallback(async (v: string) => {
    const r = await getPlan(id, v);
    useEditor.getState().setMedia({...useEditor.getState().media, ...r.media});
    return r;
  }, [id]);

  const openVariant = useCallback(async (v: string) => {
    const {plan, media, missingPreview} = await getPlan(id, v);
    useEditor.getState().init(id, v, plan, media);
    setVariant(v);
    setComparing(false);
    await api(`/api/projects/${id}`, {method: 'PATCH', json: {activeVariant: v}}).catch(() => undefined);
    // projeto processado antes da prévia leve: gera agora, em segundo plano, e troca o vídeo quando ficar pronta
    if (missingPreview && !previewStarted.current) {
      previewStarted.current = true;
      setPreviewMsg('Gerando prévia leve para o vídeo carregar rápido…');
      runProjectJob(id, 'preview', {}, (j) => setPreviewMsg(j.status === 'done' ? null : `Gerando prévia leve… ${j.progress}%`))
        .then(async (j) => {
          if (j.status === 'done') await refreshMedia(v);
          setPreviewMsg(j.status === 'done' ? null : `Prévia leve falhou: ${j.error ?? ''}`);
        })
        .catch(() => setPreviewMsg(null));
    }
  }, [id, refreshMedia]);

  // os links assinados do Blob expiram: renova enquanto o editor está aberto (o link só
  // muda quando o token gira, então o player não recarrega à toa)
  useEffect(() => {
    if (!variant) return;
    const t = setInterval(() => void refreshMedia(variant).catch(() => undefined), 15 * 60e3);
    return () => clearInterval(t);
  }, [variant, refreshMedia]);

  useEffect(() => {
    if (!data || data.project.status !== 'ready' || comparing || variant) return;
    const v = data.project.activeVariant ?? data.project.variants[0];
    if (v) openVariant(v);
  }, [data, comparing, variant, openVariant]);

  if (err) return <Centered><Icon name="alert" className="text-danger" /><p className="text-red-300">{err}</p></Centered>;
  if (!data) return <Centered><Spinner className="text-brand" /> Carregando…</Centered>;
  const {project, jobs} = data;
  const job = jobs.find((j) => j.type === 'process');
  const stop = async () => {
    if (!confirm('Parar o processamento deste vídeo?')) return;
    await api(`/api/projects/${id}/cancel`, {method: 'POST'}).catch((e) => alert(e instanceof Error ? e.message : String(e)));
    load();
  };
  const remove = async () => {
    if (!confirm(`Excluir "${project.name}"? O vídeo e as edições serão apagados.`)) return;
    try {
      await api(`/api/projects/${id}`, {method: 'DELETE'});
      router.push('/');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  if (project.status === 'processing' || project.status === 'draft' || (project.status === 'error' && !project.variants.length)) {
    const failed = project.status === 'error';
    const progress = job?.progress ?? 0;
    const retry = async () => {
      await api(`/api/projects/${id}/process`, {method: 'POST'});
      load();
    };
    return (
      <AppShell>
        <Page>
          <PageHeader
            crumbs={[{href: '/', label: 'Projetos'}]}
            title={project.name}
            subtitle={failed ? 'O processamento parou com um erro.' : 'A IA está fazendo a primeira edição. Quando terminar, o editor abre sozinho.'}
            actions={
              <>
                {project.status === 'processing' && (
                  <button className="btn-ghost" onClick={stop}>
                    <Icon name="stop" size={12} /> Parar
                  </button>
                )}
                <button className="btn-ghost text-red-300" onClick={remove}>
                  <Icon name="trash" /> Excluir
                </button>
              </>
            }
          />
          <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
            <section className="card p-6 sm:p-8">
              {failed ? (
                <div>
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-danger/15 text-danger">
                    <Icon name="alert" size={22} />
                  </div>
                  <h2 className="text-lg font-bold">Algo deu errado</h2>
                  <pre className="mt-3 rounded-lg bg-bg p-3 text-xs whitespace-pre-wrap text-red-300">{project.error}</pre>
                  {project.uploads.length > 0 && (
                    <button className="btn-primary mt-5" onClick={retry}>
                      <Icon name="refresh" /> Tentar de novo
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold tracking-wide text-muted uppercase">{project.status === 'draft' && !job ? 'Aguardando' : 'Etapa atual'}</div>
                      <div className="mt-1 flex items-center gap-2 text-lg font-bold">
                        {(project.status === 'processing' || job) && <Spinner className="text-brand" />}
                        {job?.label ?? 'Na fila'}
                      </div>
                    </div>
                    <div className="text-4xl font-extrabold tracking-tight tabular-nums">
                      {progress}
                      <span className="text-xl text-muted">%</span>
                    </div>
                  </div>
                  <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-panel3">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand2 transition-all duration-700" style={{width: `${Math.max(2, progress)}%`}} />
                  </div>
                  <Steps progress={progress} />
                  {project.status === 'draft' && !job && project.uploads.length > 0 && (
                    <button className="btn-primary mt-6" onClick={retry}>
                      <Icon name="play" size={12} /> Processar
                    </button>
                  )}
                  <p className="mt-6 flex items-center gap-2 text-xs text-muted">
                    <Icon name="info" size={14} /> Pode fechar ou sair desta página: o processamento continua no servidor.
                  </p>
                </>
              )}
            </section>
            <aside className="card p-5">
              <h2 className="section-title">Detalhes</h2>
              <dl className="space-y-2.5 text-sm">
                <Detail k="Status" v={<StatusBadge status={project.status} />} />
                <Detail k="IA diretora" v={DIRECTOR_LABEL[project.director] ?? project.director} />
                <Detail k="Plataforma" v={PLATFORM_LABEL[project.platform] ?? project.platform} />
                <Detail k="Criado" v={timeAgo(project.createdAt)} />
              </dl>
              {project.uploads.length > 0 && (
                <>
                  <h3 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Arquivos</h3>
                  <ul className="space-y-1.5">
                    {project.uploads.map((u) => (
                      <li key={u.id} className="flex items-center gap-2 text-xs">
                        <Icon name="film" size={14} className="text-subtle" />
                        <span className="min-w-0 flex-1 truncate">{u.name}</span>
                        <span className="text-muted tabular-nums">{(u.size / 1e6).toFixed(1)} MB</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </aside>
          </div>
        </Page>
      </AppShell>
    );
  }

  if (comparing) return <Compare id={id} variants={project.variants} onPick={openVariant} onBack={() => router.push('/')} />;
  if (!variant || loadedVariant !== variant) return <Centered><Spinner className="text-brand" /> Abrindo o editor…</Centered>;
  return (
    <>
      <Editor
        projectName={project.name}
        variants={project.variants}
        onSwitchVariant={(v) => (v === variant ? undefined : openVariant(v))}
        onBack={() => router.push('/')}
      />
      {previewMsg && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 animate-fade-in items-center gap-2 rounded-xl border border-line bg-panel2 px-4 py-2.5 text-xs shadow-pop">
          <Spinner size={14} className="text-brand" /> {previewMsg}
        </div>
      )}
    </>
  );
}

const STEPS = [
  [5, 'Proxy e áudio', 'prepara uma cópia leve do vídeo'],
  [40, 'Transcrição', 'texto palavra a palavra'],
  [55, 'Rosto', 'onde você está no quadro'],
  [62, 'Correção', 'glossário e pontuação'],
  [66, 'Takes e cortes', 'pausas, erros e repetições'],
  [70, 'IA diretora', 'zoom, gráficos, transições e sons'],
  [85, 'B-roll', 'busca e gera as imagens de apoio'],
  [100, 'Pronto', 'abre o editor'],
] as const;

function Steps({progress}: {progress: number}) {
  const current = STEPS.findIndex(([p]) => progress < p);
  return (
    <ol className="mt-8 grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {STEPS.map(([p, l, d], i) => {
        const done = progress >= p;
        const now = i === current;
        return (
          <li key={l} className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${done ? 'border-ok/40 bg-ok/15 text-ok' : now ? 'border-brand bg-brand/15 text-brand' : 'border-line text-subtle'}`}>
              {done ? <Icon name="check" size={12} strokeWidth={3} /> : now ? <Spinner size={12} /> : i + 1}
            </span>
            <div>
              <div className={`text-sm font-semibold ${done || now ? 'text-text' : 'text-muted'}`}>{l}</div>
              <div className="text-xs text-muted">{d}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const Detail = ({k, v}: {k: string; v: React.ReactNode}) => (
  <div className="flex items-center justify-between gap-3">
    <dt className="text-muted">{k}</dt>
    <dd className="truncate text-right">{v}</dd>
  </div>
);

function Centered({children}: {children: React.ReactNode}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="flex items-center gap-3 text-muted">{children}</div>
    </main>
  );
}

/** modo Comparar: os dois planos lado a lado, preview ao vivo (sem render) */
function Compare({id, variants, onPick, onBack}: {id: string; variants: string[]; onPick: (v: string) => void; onBack: () => void}) {
  const [plans, setPlans] = useState<Record<string, {plan: EditPlan; media: Record<string, string>}>>({});
  const refs = useRef<Record<string, PlayerRef | null>>({});
  useEffect(() => {
    Promise.all(variants.map(async (v) => [v, await getPlan(id, v)] as const)).then((r) => setPlans(Object.fromEntries(r)));
  }, [id, variants]);
  const playAll = () => {
    for (const r of Object.values(refs.current)) {
      r?.seekTo(0);
      r?.play();
    }
  };
  return (
    <AppShell wide>
      <main className="mx-auto max-w-[1600px] px-4 py-8">
      <PageHeader
        crumbs={[{href: '/', label: 'Projetos'}]}
        title="Comparar IAs diretoras"
        subtitle="Dois planos de edição do mesmo vídeo. Assista lado a lado e escolha qual seguir editando — dá para trocar depois no editor."
        actions={
          <>
            <button className="btn-ghost" onClick={onBack}>
              <Icon name="back" /> Projetos
            </button>
            <button className="btn-primary" onClick={playAll}>
              <Icon name="play" size={12} /> Tocar os dois do início
            </button>
          </>
        }
      />
      <div className="grid gap-6 md:grid-cols-2">
        {variants.map((v) => {
          const p = plans[v];
          return (
            <div key={v} className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-bold">{LABEL[v] ?? v}</div>
                  {p && (
                    <div className="text-xs text-muted">
                      {p.plan.meta.model} · {p.plan.camera.beats.length} zooms · {p.plan.overlays.length} gráficos · {p.plan.broll.length} B-rolls
                    </div>
                  )}
                </div>
                <button className="btn-primary" onClick={() => onPick(v)} disabled={!p}>
                  <Icon name="check" /> Editar este
                </button>
              </div>
              <div className="mx-auto" style={{aspectRatio: '9 / 16', maxHeight: '72vh'}}>
                {p ? (
                  <Player
                    ref={(r) => {
                      refs.current[v] = r;
                    }}
                    component={Reel}
                    inputProps={{plan: p.plan, media: p.media}}
                    durationInFrames={Math.max(1, planDurationFrames(p.plan))}
                    fps={p.plan.format.fps}
                    compositionWidth={p.plan.format.width}
                    compositionHeight={p.plan.format.height}
                    style={{width: '100%', height: '100%'}}
                    controls
                    acknowledgeRemotionLicense
                  />
                ) : (
                  <div className="skeleton h-full rounded-xl" />
                )}
              </div>
              {p && p.plan.meta.notes.length > 0 && <p className="mt-3 text-xs text-muted">{p.plan.meta.notes.join(' · ')}</p>}
            </div>
          );
        })}
      </div>
      </main>
    </AppShell>
  );
}
