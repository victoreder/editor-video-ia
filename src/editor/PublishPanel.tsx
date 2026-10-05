'use client';
// Publicar (fase 3): legenda do post + hashtags por plataforma, capa com título
// e "vídeo longo → Shorts" (cada Short vira um projeto próprio, já editado).
import {useCallback, useEffect, useState} from 'react';
import {api, runProjectJob, savePlan, type ProjectView} from '../lib/client/api';
import type {Job, Moment, PostPack} from '../lib/adapters/db/types';
import {useEditor} from './store';

type Loaded = {project: ProjectView & {postpack?: PostPack; shorts?: string[]; moment?: Moment; parentId?: string}};

export function PublishPanel() {
  const projectId = useEditor((s) => s.projectId);
  const variant = useEditor((s) => s.variant);
  const [data, setData] = useState<Loaded | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [count, setCount] = useState(3);
  const [shorts, setShorts] = useState<{id: string; name: string}[]>([]);
  const load = useCallback(async () => {
    const r = await api<Loaded>(`/api/projects/${projectId}`);
    setData(r);
    const ids = r.project.shorts ?? [];
    setShorts(await Promise.all(ids.map(async (id) => ({id, name: (await api<Loaded>(`/api/projects/${id}`).catch(() => null))?.project.name ?? id}))));
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (type: 'postpack' | 'thumbnail' | 'shorts', input: Record<string, unknown> = {}) => {
    await savePlan(projectId, variant, useEditor.getState().plan!);
    const done = await runProjectJob(projectId, type, {variant, ...input}, setJob);
    await load();
    return done;
  };
  const busy = job !== null && job.status !== 'done' && job.status !== 'error';
  const pp = data?.project.postpack;
  const copy = (t: string) => navigator.clipboard?.writeText(t);
  const longVideo = typeof window !== 'undefined' && localStorage.getItem(`shorts:${projectId}`) === '1';

  return (
    <div className="space-y-6">
      {job && (
        <div className={`rounded-lg p-2 text-xs ${job.status === 'error' ? 'bg-red-900/50' : 'bg-brand/20'}`}>{job.status === 'error' ? `Erro: ${job.error}` : `${job.label} — ${job.progress}%`}</div>
      )}
      {data?.project.parentId && (
        <a className="block text-xs text-brand2 underline" href={`/projects/${data.project.parentId}`}>
          ← Voltar ao vídeo longo de origem
        </a>
      )}

      <section>
        <h3 className="mb-2 font-bold">Legenda do post</h3>
        <button className="btn-ghost mb-3" disabled={busy} onClick={() => run('postpack')}>
          {pp ? 'Reescrever' : 'Escrever legenda, gancho e hashtags'}
        </button>
        {pp && (
          <div className="space-y-3 text-sm">
            <div>
              <span className="label">Gancho</span>
              <p className="font-semibold">{pp.hook}</p>
            </div>
            {(['instagram', 'tiktok', 'shorts'] as const).map((p) => (
              <div key={p}>
                <div className="flex items-center justify-between">
                  <span className="label">{p === 'shorts' ? 'YouTube Shorts' : p === 'tiktok' ? 'TikTok' : 'Instagram'}</span>
                  <button className="text-xs text-brand2" onClick={() => copy(pp.platforms[p])}>
                    copiar
                  </button>
                </div>
                <p className="whitespace-pre-wrap rounded-lg bg-panel2 p-2 text-xs">{pp.platforms[p]}</p>
              </div>
            ))}
            <div>
              <span className="label">Títulos (Shorts)</span>
              <ul className="list-disc pl-5 text-xs">
                {pp.titles.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-bold">Capa / thumbnail</h3>
        <p className="mb-2 text-xs text-muted">Escolhe o frame mais expressivo (rosto grande, palavra forte, longe de cortes) e coloca o gancho como título.</p>
        <button className="btn-ghost" disabled={busy} onClick={() => run('thumbnail')}>
          Gerar capa
        </button>
        {data?.project.thumbUrl && <img src={`${data.project.thumbUrl}${data.project.thumbUrl.includes('?') ? '&' : '?'}v=${data.project.updatedAt}`} alt="capa" className="mt-3 w-40 rounded-lg border border-line" />}
      </section>

      <section>
        <h3 className="mb-2 font-bold">Vídeo longo → Shorts</h3>
        <p className="mb-2 text-xs text-muted">
          Acha os trechos de 20–60 s que funcionam sozinhos (gancho forte, sem depender de contexto, terminam num ponto) e edita cada um como um Short novo.
          {longVideo && <b className="text-key"> Você marcou este vídeo como longo.</b>}
        </p>
        <div className="flex items-center gap-2">
          <select className="input w-auto" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} Short{n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
          <button className="btn-primary" disabled={busy} onClick={() => run('shorts', {count})}>
            Gerar Shorts
          </button>
        </div>
        {shorts.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {shorts.map((s) => (
              <li key={s.id}>
                <a className="text-brand2 underline" href={`/projects/${s.id}`}>
                  {s.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
