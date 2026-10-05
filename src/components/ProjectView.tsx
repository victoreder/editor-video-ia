'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {Player, type PlayerRef} from '@remotion/player';
import {Reel} from '@/remotion/Reel';
import {planDurationFrames} from '@/lib/plan/timeline';
import {api, getPlan, type ProjectView as PV} from '@/lib/client/api';
import type {Job} from '@/lib/adapters/db/types';
import type {EditPlan} from '@/lib/plan/schema';
import {Editor} from '@/editor/Editor';
import {useEditor} from '@/editor/store';

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

  const openVariant = useCallback(async (v: string) => {
    const {plan, media} = await getPlan(id, v);
    useEditor.getState().init(id, v, plan, media);
    setVariant(v);
    setComparing(false);
    await api(`/api/projects/${id}`, {method: 'PATCH', json: {activeVariant: v}}).catch(() => undefined);
  }, [id]);

  useEffect(() => {
    if (!data || data.project.status !== 'ready' || comparing || variant) return;
    const v = data.project.activeVariant ?? data.project.variants[0];
    if (v) openVariant(v);
  }, [data, comparing, variant, openVariant]);

  if (err) return <Centered><p className="text-red-300">{err}</p></Centered>;
  if (!data) return <Centered><p className="text-muted">Carregando…</p></Centered>;
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

  if (project.status === 'processing' || project.status === 'draft') {
    return (
      <Centered>
        <div className="card w-full max-w-lg p-8">
          <h1 className="mb-1 text-xl font-bold">{project.name}</h1>
          <p className="mb-6 text-sm text-muted">A IA está editando: transcrição → takes → cortes → legendas → zoom, B-roll, gráficos e sons.</p>
          <div className="mb-2 flex justify-between text-sm">
            <span>{job?.label ?? 'Na fila'}</span>
            <span className="tabular-nums">{job?.progress ?? 0}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-panel2">
            <div className="h-full bg-gradient-to-r from-brand to-brand2 transition-all" style={{width: `${job?.progress ?? 2}%`}} />
          </div>
          <Steps progress={job?.progress ?? 0} />
          <div className="mt-6 flex flex-wrap gap-2">
            {project.status === 'draft' && !job && project.uploads.length > 0 && (
              <button className="btn-primary" onClick={async () => {
                await api(`/api/projects/${id}/process`, {method: 'POST'});
                load();
              }}>
                Processar
              </button>
            )}
            {project.status === 'processing' && (
              <button className="btn-ghost" onClick={stop}>
                Parar processamento
              </button>
            )}
            <button className="btn-ghost text-red-300" onClick={remove}>
              Excluir
            </button>
            <button className="btn-ghost ml-auto" onClick={() => router.push('/')}>
              Voltar
            </button>
          </div>
        </div>
      </Centered>
    );
  }

  if (project.status === 'error' && !project.variants.length) {
    return (
      <Centered>
        <div className="card max-w-lg p-8">
          <h1 className="mb-2 text-xl font-bold">Algo deu errado</h1>
          <p className="mb-6 text-sm text-red-300">{project.error}</p>
          <div className="flex gap-2">
            {project.uploads.length > 0 && (
              <button className="btn-primary" onClick={async () => {
                await api(`/api/projects/${id}/process`, {method: 'POST'});
                load();
              }}>
                Tentar de novo
              </button>
            )}
            <button className="btn-ghost text-red-300" onClick={remove}>
              Excluir
            </button>
            <button className="btn-ghost" onClick={() => router.push('/')}>
              Voltar
            </button>
          </div>
        </div>
      </Centered>
    );
  }

  if (comparing) return <Compare id={id} variants={project.variants} onPick={openVariant} onBack={() => router.push('/')} />;
  if (!variant || loadedVariant !== variant) return <Centered><p className="text-muted">Abrindo o editor…</p></Centered>;
  return (
    <Editor
      projectName={project.name}
      variants={project.variants}
      onSwitchVariant={(v) => (v === variant ? undefined : openVariant(v))}
      onBack={() => router.push('/')}
    />
  );
}

const STEPS = [
  [5, 'Proxy e áudio'],
  [40, 'Transcrição'],
  [55, 'Rosto'],
  [62, 'Correção'],
  [66, 'Takes e cortes'],
  [70, 'IA diretora'],
  [85, 'B-roll'],
  [100, 'Pronto'],
] as const;

function Steps({progress}: {progress: number}) {
  return (
    <ol className="mt-6 grid grid-cols-2 gap-1 text-xs">
      {STEPS.map(([p, l]) => (
        <li key={l} className={progress >= p ? 'text-white' : 'text-muted'}>
          {progress >= p ? '✓' : '○'} {l}
        </li>
      ))}
    </ol>
  );
}

function Centered({children}: {children: React.ReactNode}) {
  return <main className="flex min-h-screen items-center justify-center p-4">{children}</main>;
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
    <main className="min-h-screen p-4">
      <div className="mb-4 flex items-center gap-3">
        <button className="btn-ghost" onClick={onBack}>
          ←
        </button>
        <h1 className="text-lg font-bold">Comparar IAs diretoras</h1>
        <button className="btn-ghost ml-auto" onClick={playAll}>
          ▶ Tocar os dois do início
        </button>
      </div>
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
                  Editar este
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
                  <div className="flex h-full items-center justify-center text-muted">Carregando…</div>
                )}
              </div>
              {p && p.plan.meta.notes.length > 0 && <p className="mt-3 text-xs text-muted">{p.plan.meta.notes.join(' · ')}</p>}
            </div>
          );
        })}
      </div>
    </main>
  );
}
