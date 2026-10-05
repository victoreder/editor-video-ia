'use client';
// Editor: preview ao vivo (@remotion/player — sem renderizar), timeline, inspector,
// desfazer/refazer, autosave, QA e exportação.
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {Reel} from '../remotion/Reel';
import {planDurationFrames} from '../lib/plan/timeline';
import {api, savePlan, waitJob, type ExportView} from '../lib/client/api';
import type {Job} from '../lib/adapters/db/types';
import type {QaIssue} from '../lib/modules/qa';
import {useEditor} from './store';
import {Timeline} from './Timeline';
import {Inspector} from './Inspector';
import {ChatPanel} from './ChatPanel';
import {PublishPanel} from './PublishPanel';
import {deleteItem, itemStart, splitAt} from './ops';
import {isTypingTarget, resolveKey} from './keys';

export function Editor({projectName, variants, onSwitchVariant, onBack}: {projectName: string; variants: string[]; onSwitchVariant: (v: string) => void; onBack: () => void}) {
  const plan = useEditor((s) => s.plan)!;
  const media = useEditor((s) => s.media);
  const selected = useEditor((s) => s.selected);
  const dirty = useEditor((s) => s.dirty);
  const saving = useEditor((s) => s.saving);
  const variant = useEditor((s) => s.variant);
  const projectId = useEditor((s) => s.projectId);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const {undo, redo, setFrame, select, apply, markSaved, setSaving} = useEditor.getState();
  const player = useRef<PlayerRef>(null);
  const [panel, setPanel] = useState<'none' | 'export' | 'qa'>('none');
  const [tab, setTab] = useState<'edit' | 'chat' | 'publish'>('edit');
  const [job, setJob] = useState<Job | null>(null);
  const duration = Math.max(1, planDurationFrames(plan));
  const fps = plan.format.fps;

  const seek = useCallback((f: number) => {
    const fr = Math.max(0, Math.min(duration - 1, f));
    player.current?.seekTo(fr);
    setFrame(fr);
  }, [duration, setFrame]);

  // agulha acompanha o player
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: {detail: {frame: number}}) => setFrame(e.detail.frame);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('seeked', onFrame);
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('seeked', onFrame);
    };
  }, [setFrame]);

  // autosave (debounce)
  useEffect(() => {
    if (!dirty) return;
    const h = setTimeout(async () => {
      setSaving(true);
      try {
        const cur = useEditor.getState().plan!;
        const r = await savePlan(projectId, variant, cur);
        useEditor.getState().setMedia({...useEditor.getState().media, ...r.media});
        if (useEditor.getState().plan === cur) markSaved();
        else setSaving(false);
      } catch (e) {
        setSaving(false);
        console.error(e);
      }
    }, 1200);
    return () => clearTimeout(h);
  }, [plan, dirty, projectId, variant, markSaved, setSaving]);

  // ao selecionar, leva a agulha para o item
  const lastSel = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || selected.id === lastSel.current) return;
    lastSel.current = selected.id;
    const t = itemStart(plan, selected);
    const now = useEditor.getState().frame / fps;
    if (t !== null && Math.abs(t - now) > 0.5 && selected.kind !== 'clip') seek(Math.round(t * fps) + 2);
  }, [selected, plan, fps, seek]);

  // atalhos
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target as HTMLElement)) return;
      const a = resolveKey(e, {frame: useEditor.getState().frame, totalFrames: duration, targetIsFocusedButton: (e.target as HTMLElement)?.tagName === 'BUTTON'});
      if (!a) return;
      e.preventDefault();
      switch (a.type) {
        case 'toggle-play':
          player.current?.toggle();
          break;
        case 'seek':
          seek(a.frame);
          break;
        case 'split':
          apply((p) => splitAt(p, useEditor.getState().frame / fps).plan, {refresh: true});
          break;
        case 'delete-selection': {
          const sel = useEditor.getState().selected;
          if (sel) {
            apply((p) => deleteItem(p, sel), {refresh: sel.kind === 'clip'});
            select(null);
          }
          break;
        }
        case 'escape':
          select(null);
          setPanel('none');
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duration, fps, seek, apply, select, undo, redo]);

  const inputProps = useMemo(() => ({plan, media, selectedId: selected?.id ?? null}), [plan, media, selected]);

  const replan = async () => {
    if (!confirm('A IA vai refazer zoom, B-roll, gráficos, transições e sons (cortes e legendas ficam). Continuar?')) return;
    const {job: j} = await api<{job: Job}>(`/api/projects/${projectId}/replan`, {method: 'POST', json: {variant, director: variant}});
    setJob(j);
    const done = await waitJob(j.id, setJob);
    if (done.status === 'done') {
      const r = await api<{plan: typeof plan; media: Record<string, string>}>(`/api/projects/${projectId}/plans/${variant}`);
      useEditor.getState().pushHistory();
      apply(() => r.plan, {history: false});
      useEditor.getState().setMedia(r.media);
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {/* barra superior */}
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <button className="btn-ghost" onClick={onBack}>
          ←
        </button>
        <div className="mr-2 max-w-56 truncate font-bold">{projectName}</div>
        {variants.length > 1 && (
          <div className="flex overflow-hidden rounded-lg border border-line">
            {variants.map((v) => (
              <button key={v} onClick={() => onSwitchVariant(v)} className={`px-3 py-1 text-xs font-semibold ${v === variant ? 'bg-brand' : 'bg-panel2'}`}>
                {v === 'claude' ? 'Claude' : v === 'openai' ? 'OpenAI' : 'Regras'}
              </button>
            ))}
          </div>
        )}
        <span className="text-xs text-muted">{saving ? 'Salvando…' : dirty ? 'Alterações não salvas' : 'Salvo'}</span>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" disabled={!canUndo} onClick={undo} title="Desfazer (⌘Z)">
            ↶
          </button>
          <button className="btn-ghost" disabled={!canRedo} onClick={redo} title="Refazer (⌘⇧Z)">
            ↷
          </button>
          <button className="btn-ghost" onClick={() => setPanel(panel === 'qa' ? 'none' : 'qa')}>
            Verificar (QA)
          </button>
          <a className="btn-ghost" href="#" onClick={async (e) => {
            e.preventDefault();
            const r = await fetch(`/api/projects/${projectId}/plans/${variant}/actions`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({plan, action: 'srt'})});
            const url = URL.createObjectURL(await r.blob());
            Object.assign(document.createElement('a'), {href: url, download: `${projectName}.srt`}).click();
          }}>
            .srt
          </a>
          <button className="btn-primary" onClick={() => setPanel(panel === 'export' ? 'none' : 'export')}>
            Exportar
          </button>
        </div>
      </header>

      {job && job.status !== 'done' && (
        <div className={`px-4 py-1.5 text-xs ${job.status === 'error' ? 'bg-red-900/60' : 'bg-brand/30'}`}>
          {job.status === 'error' ? `Erro: ${job.error}` : `${job.label} — ${job.progress}%`}
          {job.status === 'error' && (
            <button className="ml-3 underline" onClick={() => setJob(null)}>
              ok
            </button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* preview */}
        <div className="flex min-w-0 flex-1 items-center justify-center bg-black/60 p-3">
          <div className="h-full" style={{aspectRatio: `${plan.format.width} / ${plan.format.height}`, maxWidth: '100%'}}>
            <Player
              ref={player}
              component={Reel}
              inputProps={inputProps}
              durationInFrames={duration}
              fps={fps}
              compositionWidth={plan.format.width}
              compositionHeight={plan.format.height}
              style={{width: '100%', height: '100%'}}
              controls
              clickToPlay
              doubleClickToFullscreen
              acknowledgeRemotionLicense
              numberOfSharedAudioTags={12}
              bufferStateDelayInMilliseconds={300}
            />
          </div>
        </div>
        {/* inspector */}
        <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-panel">
          {panel === 'none' && (
            <div className="flex border-b border-line text-sm">
              {(
                [
                  ['edit', 'Editar'],
                  ['chat', 'Chat IA'],
                  ['publish', 'Publicar'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 font-semibold ${tab === k ? 'border-b-2 border-brand text-white' : 'text-muted'}`}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {panel === 'export' ? (
              <ExportPanel onClose={() => setPanel('none')} />
            ) : panel === 'qa' ? (
              <QaPanel onClose={() => setPanel('none')} onSeek={(t) => seek(Math.round(t * fps))} />
            ) : tab === 'chat' ? (
              <ChatPanel />
            ) : tab === 'publish' ? (
              <PublishPanel />
            ) : (
              <Inspector onReplan={replan} />
            )}
          </div>
        </aside>
      </div>
      <div className="h-[290px] shrink-0 border-t border-line bg-panel">
        <Timeline onSeek={seek} />
      </div>
    </div>
  );
}

function QaPanel({onClose, onSeek}: {onClose: () => void; onSeek: (t: number) => void}) {
  const plan = useEditor((s) => s.plan)!;
  const projectId = useEditor((s) => s.projectId);
  const variant = useEditor((s) => s.variant);
  const [issues, setIssues] = useState<QaIssue[] | null>(null);
  useEffect(() => {
    api<{issues: QaIssue[]}>(`/api/projects/${projectId}/plans/${variant}/actions`, {method: 'POST', json: {plan, action: 'qa'}}).then((r) => setIssues(r.issues));
  }, [plan, projectId, variant]);
  const color = {error: 'text-red-300', warning: 'text-amber-300', info: 'text-muted'};
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold">Controle de qualidade</h3>
        <button className="btn-ghost" onClick={onClose}>
          Fechar
        </button>
      </div>
      {!issues ? (
        <p className="text-sm text-muted">Verificando…</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {issues.map((i, k) => (
            <li key={k} className={`rounded-lg bg-panel2 p-2 ${color[i.level]}`}>
              {i.message}
              {i.at !== undefined && (
                <button className="ml-2 text-xs underline" onClick={() => onSeek(i.at!)}>
                  ir para {i.at.toFixed(1)}s
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const dl = (u: string) => u + (u.startsWith('/api/') ? '?download=1' : '');

function ExportPanel({onClose}: {onClose: () => void}) {
  const projectId = useEditor((s) => s.projectId);
  const variant = useEditor((s) => s.variant);
  const dirty = useEditor((s) => s.dirty);
  const [formats, setFormats] = useState<string[]>(['vertical']);
  const [clean, setClean] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [exportsList, setExports] = useState<ExportView[]>([]);
  const load = useCallback(() => api<{exports: ExportView[]}>(`/api/projects/${projectId}`).then((r) => setExports(r.exports)), [projectId]);
  useEffect(() => {
    load();
  }, [load]);
  const start = async () => {
    const {job: j} = await api<{job: Job}>(`/api/projects/${projectId}/render`, {method: 'POST', json: {variant, formats, clean}});
    setJob(j);
    await waitJob(j.id, setJob, 2000);
    load();
  };
  const toggle = (f: string) => setFormats(formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f]);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold">Exportar MP4</h3>
        <button className="btn-ghost" onClick={onClose}>
          Fechar
        </button>
      </div>
      {[
        ['vertical', '9:16 — Reels / TikTok / Shorts'],
        ['square', '1:1 — feed'],
        ['landscape', '16:9 — YouTube'],
      ].map(([f, l]) => (
        <label key={f} className="mb-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={formats.includes(f)} onChange={() => toggle(f)} /> {l}
        </label>
      ))}
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={clean} onChange={() => setClean(!clean)} /> Também a versão limpa (sem legendas/gráficos, para editar em outro programa)
      </label>
      <p className="my-3 text-xs text-muted">MP4 H.264 ~12 Mbps, áudio em −14 LUFS com QA automático, legenda .srt, capa com título e timeline .fcpxml (DaVinci/Premiere/Final Cut).</p>
      <button className="btn-primary w-full py-2" disabled={!formats.length || dirty || (job !== null && job.status !== 'done' && job.status !== 'error')} onClick={start}>
        {dirty ? 'Salvando alterações…' : 'Renderizar'}
      </button>
      {job && (
        <div className="mt-3 text-sm">
          <div className="mb-1 text-muted">{job.status === 'error' ? `Erro: ${job.error}` : job.label}</div>
          <div className="h-2 overflow-hidden rounded bg-panel2">
            <div className={`h-full transition-all ${job.status === 'error' ? 'bg-red-600' : 'bg-brand'}`} style={{width: `${job.progress}%`}} />
          </div>
        </div>
      )}
      {exportsList.length > 0 && (
        <>
          <h4 className="mb-2 mt-6 text-sm font-bold">Exportações</h4>
          <ul className="space-y-2">
            {exportsList.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-panel2 p-2 text-xs">
                {e.thumbUrl && <img src={e.thumbUrl} alt="" className="h-14 w-8 rounded object-cover" />}
                <div className="flex-1">
                  <div className="font-semibold">
                    {e.format} · {e.variant}
                  </div>
                  <div className="text-muted">{new Date(e.createdAt).toLocaleString('pt-BR')}</div>
                </div>
                <a className="btn-ghost" href={e.videoUrl + (e.videoUrl.startsWith('/api/') ? '?download=1' : '')} download>
                  MP4
                </a>
                {e.srtUrl && (
                  <a className="btn-ghost" href={dl(e.srtUrl)} download>
                    SRT
                  </a>
                )}
                {e.fcpxmlUrl && (
                  <a className="btn-ghost" href={dl(e.fcpxmlUrl)} download title="Timeline para DaVinci/Premiere/Final Cut">
                    XML
                  </a>
                )}
                {e.cleanUrl && (
                  <a className="btn-ghost" href={dl(e.cleanUrl)} download title="Versão limpa">
                    Limpo
                  </a>
                )}
                {e.qa && <div className={`w-full text-[11px] ${e.qa.ok ? 'text-emerald-300' : 'text-amber-300'}`}>QA: {e.qa.ok ? `ok${e.qa.lufs !== null ? ` · ${e.qa.lufs.toFixed(1)} LUFS` : ''}` : e.qa.notes.join('; ')}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
