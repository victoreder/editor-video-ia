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
import {Icon, Logo, Spinner} from '../components/ui/Icon';

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
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 sm:px-3">
        <button className="btn-icon" onClick={onBack} title="Voltar aos projetos">
          <Icon name="back" />
        </button>
        <a href="/" className="hidden sm:block" title="Projetos">
          <Logo size={26} />
        </a>
        <div className="ml-1 flex min-w-0 flex-col leading-tight">
          <a href="/" className="text-[11px] text-muted hover:text-text">
            Projetos
          </a>
          <div className="max-w-40 truncate text-sm font-bold sm:max-w-64">{projectName}</div>
        </div>
        <SaveStatus saving={saving} dirty={dirty} />
        {variants.length > 1 && (
          <div className="ml-2 hidden rounded-lg border border-line bg-panel2 p-0.5 md:flex">
            {variants.map((v) => (
              <button key={v} onClick={() => onSwitchVariant(v)} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${v === variant ? 'bg-brand text-white' : 'text-muted hover:text-text'}`}>
                {v === 'claude' ? 'Claude' : v === 'openai' ? 'OpenAI' : 'Regras'}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button className="btn-icon" disabled={!canUndo} onClick={undo} title="Desfazer (⌘Z)">
            <Icon name="undo" />
          </button>
          <button className="btn-icon" disabled={!canRedo} onClick={redo} title="Refazer (⌘⇧Z)">
            <Icon name="redo" />
          </button>
          <Shortcuts />
          <span className="mx-1 h-5 w-px bg-line" />
          <button className={`btn-quiet ${panel === 'qa' ? 'bg-panel3 text-text' : ''}`} onClick={() => setPanel(panel === 'qa' ? 'none' : 'qa')} title="Controle de qualidade">
            <Icon name="shield" /> <span className="hidden lg:inline">Verificar</span>
          </button>
          <button
            className="btn-quiet"
            title="Baixar a legenda (.srt)"
            onClick={async () => {
              const r = await fetch(`/api/projects/${projectId}/plans/${variant}/actions`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({plan, action: 'srt'})});
              const url = URL.createObjectURL(await r.blob());
              Object.assign(document.createElement('a'), {href: url, download: `${projectName}.srt`}).click();
            }}
          >
            <Icon name="file" /> <span className="hidden lg:inline">.srt</span>
          </button>
          <button className="btn-primary ml-1" onClick={() => setPanel(panel === 'export' ? 'none' : 'export')}>
            <Icon name="download" /> Exportar
          </button>
        </div>
      </header>

      {job && job.status !== 'done' && (
        <div className={`flex items-center gap-2 border-b px-4 py-1.5 text-xs ${(job.status === 'error' || job.status === 'cancelled') ? 'border-danger/30 bg-danger/10 text-red-200' : 'border-brand/30 bg-brand/10'}`}>
          {(job.status === 'error' || job.status === 'cancelled') ? <Icon name="alert" size={14} className="text-danger" /> : <Spinner size={14} className="text-brand" />}
          {(job.status === 'error' || job.status === 'cancelled') ? `Erro: ${job.error}` : `${job.label} — ${job.progress}%`}
          {(job.status === 'error' || job.status === 'cancelled') && (
            <button className="ml-3 underline" onClick={() => setJob(null)}>
              ok
            </button>
          )}
          {(job.status === 'queued' || job.status === 'running') && (
            <button className="ml-3 underline" onClick={() => api(`/api/projects/${projectId}/cancel`, {method: 'POST'}).catch(() => undefined)}>
              parar
            </button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* preview */}
        <div className="flex min-w-0 flex-1 items-center justify-center bg-[radial-gradient(ellipse_at_center,#1a1a26_0%,#07070b_70%)] p-4">
          <div className="h-full overflow-hidden rounded-lg shadow-[0_20px_60px_-20px_rgb(0_0_0/0.9)] ring-1 ring-white/5" style={{aspectRatio: `${plan.format.width} / ${plan.format.height}`, maxWidth: '100%'}}>
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
        <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-panel">
          {panel === 'none' && (
            <div className="border-b border-line p-2">
              <div className="flex rounded-lg bg-panel2 p-0.5">
                {(
                  [
                    ['edit', 'Editar', 'sliders'],
                    ['chat', 'Chat IA', 'sparkles'],
                    ['publish', 'Publicar', 'share'],
                  ] as const
                ).map(([k, l, i]) => (
                  <button key={k} onClick={() => setTab(k)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-semibold transition ${tab === k ? 'bg-panel3 text-text shadow-sm' : 'text-muted hover:text-text'}`}>
                    <Icon name={i} size={14} /> {l}
                  </button>
                ))}
              </div>
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
        <Timeline onSeek={seek} onTogglePlay={() => player.current?.toggle()} />
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
        <h3 className="flex items-center gap-2 font-bold">
          <Icon name="shield" className="text-brand" /> Controle de qualidade
        </h3>
        <button className="btn-icon" onClick={onClose} title="Fechar (Esc)">
          <Icon name="x" />
        </button>
      </div>
      {!issues ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner size={14} /> Verificando…
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {issues.map((i, k) => (
            <li key={k} className={`surface p-2.5 ${color[i.level]}`}>
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
        <h3 className="flex items-center gap-2 font-bold">
          <Icon name="download" className="text-brand" /> Exportar MP4
        </h3>
        <button className="btn-icon" onClick={onClose} title="Fechar (Esc)">
          <Icon name="x" />
        </button>
      </div>
      <label className="label">Formatos</label>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          ['vertical', '9:16', 'Reels, TikTok, Shorts', 'h-7 w-4'],
          ['square', '1:1', 'Feed', 'h-5 w-5'],
          ['landscape', '16:9', 'YouTube', 'h-4 w-7'],
        ].map(([f, r, l, box]) => (
          <button key={f} onClick={() => toggle(f)} className={`flex flex-col items-center gap-1.5 !p-2.5 ${formats.includes(f) ? 'option-on' : 'option'}`}>
            <span className="flex h-8 items-center">
              <span className={`rounded-sm border-2 ${formats.includes(f) ? 'border-brand' : 'border-muted'} ${box}`} />
            </span>
            <span className="text-sm font-bold">{r}</span>
            <span className="text-center text-[10px] leading-tight text-muted">{l}</span>
          </button>
        ))}
      </div>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={clean} onChange={() => setClean(!clean)} /> Também a versão limpa (sem legendas/gráficos, para editar em outro programa)
      </label>
      <p className="my-3 text-xs text-muted">MP4 H.264 ~12 Mbps, áudio em −14 LUFS com QA automático, legenda .srt, capa com título e timeline .fcpxml (DaVinci/Premiere/Final Cut).</p>
      <button className="btn-primary btn-lg w-full" disabled={!formats.length || dirty || (job !== null && job.status !== 'done' && job.status !== 'error' && job.status !== 'cancelled')} onClick={start}>
        {dirty ? 'Salvando alterações…' : 'Renderizar'}
      </button>
      {job && (
        <div className="mt-3 text-sm">
          <div className="mb-1 text-muted">{(job.status === 'error' || job.status === 'cancelled') ? `Erro: ${job.error}` : job.label}</div>
          <div className="h-2 overflow-hidden rounded bg-panel2">
            <div className={`h-full transition-all ${(job.status === 'error' || job.status === 'cancelled') ? 'bg-red-600' : 'bg-brand'}`} style={{width: `${job.progress}%`}} />
          </div>
        </div>
      )}
      {exportsList.length > 0 && (
        <>
          <h4 className="mb-2 mt-6 text-sm font-bold">Exportações</h4>
          <ul className="space-y-2">
            {exportsList.map((e) => (
              <li key={e.id} className="surface flex flex-wrap items-center gap-2 p-2 text-xs">
                {e.thumbUrl && <img src={e.thumbUrl} alt="" className="h-14 w-8 rounded object-cover" />}
                <div className="flex-1">
                  <div className="font-semibold">
                    {e.format} · {e.variant}
                  </div>
                  <div className="text-muted">{new Date(e.createdAt).toLocaleString('pt-BR')}</div>
                </div>
                <a className="btn-ghost btn-sm" href={e.videoUrl + (e.videoUrl.startsWith('/api/') ? '?download=1' : '')} download>
                  MP4
                </a>
                {e.srtUrl && (
                  <a className="btn-ghost btn-sm" href={dl(e.srtUrl)} download>
                    SRT
                  </a>
                )}
                {e.fcpxmlUrl && (
                  <a className="btn-ghost btn-sm" href={dl(e.fcpxmlUrl)} download title="Timeline para DaVinci/Premiere/Final Cut">
                    XML
                  </a>
                )}
                {e.cleanUrl && (
                  <a className="btn-ghost btn-sm" href={dl(e.cleanUrl)} download title="Versão limpa">
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

function SaveStatus({saving, dirty}: {saving: boolean; dirty: boolean}) {
  return (
    <span className={`ml-2 hidden items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline-flex ${saving ? 'bg-brand/15 text-[#b9a8ff]' : dirty ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok'}`}>
      {saving ? <Spinner size={10} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {saving ? 'Salvando…' : dirty ? 'Alterações não salvas' : 'Salvo'}
    </span>
  );
}

const SHORTCUTS: [string[], string][] = [
  [['Espaço'], 'Tocar / pausar'],
  [['←', '→'], 'Voltar / avançar 1 frame'],
  [['⇧', '← →'], '10 frames'],
  [['Home', 'End'], 'Início / fim'],
  [['S'], 'Dividir o clipe na agulha'],
  [['⌫'], 'Apagar o item selecionado'],
  [['Esc'], 'Limpar seleção / fechar painel'],
  [['⌘', 'Z'], 'Desfazer'],
  [['⌘', '⇧', 'Z'], 'Refazer'],
];

function Shortcuts() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative hidden sm:block">
      <button className={`btn-icon ${open ? 'bg-panel3 text-text' : ''}`} onClick={() => setOpen(!open)} title="Atalhos de teclado">
        <Icon name="keyboard" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 animate-fade-in rounded-xl border border-line bg-panel2 p-3 shadow-pop">
          <div className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Atalhos</div>
          <ul className="space-y-1.5 text-sm">
            {SHORTCUTS.map(([keys, label]) => (
              <li key={label} className="flex items-center justify-between gap-3">
                <span className="text-muted">{label}</span>
                <span className="flex gap-1">
                  {keys.map((k) => (
                    <kbd key={k} className="kbd">
                      {k}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
