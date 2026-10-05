'use client';
import {useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {api, uploadProjectFile, type AppConfig, type ProjectView} from '@/lib/client/api';
import type {Project} from '@/lib/adapters/db/types';

const STATUS: Record<Project['status'], string> = {draft: 'Rascunho', processing: 'Processando', ready: 'Pronto', rendering: 'Exportando', error: 'Erro'};
const DIRECTOR_LABEL: Record<string, string> = {claude: 'Claude', openai: 'OpenAI', compare: 'Comparar', heuristic: 'Sem IA (regras)'};

export default function Home() {
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    api<{projects: ProjectView[]}>('/api/projects').then((r) => setProjects(r.projects)).catch(() => setProjects([]));
    api<AppConfig>('/api/config').then(setCfg).catch(() => undefined);
  }, []);
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Editor de Vídeo <span className="text-brand">IA</span>
          </h1>
          <p className="text-sm text-muted">Reels, TikTok e Shorts: legendas animadas, zoom, B-roll, gráficos e sons — automáticos e ajustáveis.</p>
        </div>
        <div className="flex gap-2">
          <a className="btn-ghost px-4 py-2" href="/styles">
            Meu estilo
          </a>
          <button
            className="btn-ghost px-4 py-2"
            onClick={async () => {
              await fetch('/api/auth/logout', {method: 'POST'});
              window.location.href = '/login';
            }}
          >
            Sair
          </button>
          <button className="btn-primary px-4 py-2" onClick={() => setCreating(true)}>
            + Novo vídeo
          </button>
        </div>
      </header>
      {cfg && <SetupHints cfg={cfg} />}
      {projects === null ? (
        <p className="text-muted">Carregando…</p>
      ) : projects.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="mb-4 text-lg font-semibold">Nenhum projeto ainda</p>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            Subir o primeiro vídeo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {projects.map((p) => (
            <div key={p.id} className="group relative">
              <a href={`/projects/${p.id}`} className="card block overflow-hidden transition hover:border-brand">
                <div className="aspect-[9/16] bg-panel2">{p.thumbUrl && <img src={p.thumbUrl} alt="" className="h-full w-full object-cover opacity-90 group-hover:opacity-100" />}</div>
                <div className="p-3">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted">
                    <span>{STATUS[p.status]}</span>
                    <span>{DIRECTOR_LABEL[p.director]}</span>
                  </div>
                </div>
              </a>
              <button
                title="Excluir"
                aria-label={`Excluir ${p.name}`}
                className="absolute right-2 top-2 z-10 rounded-md bg-black/70 px-2 py-1 text-xs text-red-300 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!confirm(`Excluir "${p.name}"? O vídeo e as edições serão apagados.`)) return;
                  try {
                    await api(`/api/projects/${p.id}`, {method: 'DELETE'});
                    setProjects((cur) => cur?.filter((x) => x.id !== p.id) ?? null);
                  } catch (err) {
                    alert(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                Excluir
              </button>
            </div>
          ))}
        </div>
      )}
      {creating && cfg && <NewProject cfg={cfg} onClose={() => setCreating(false)} />}
    </main>
  );
}

function SetupHints({cfg}: {cfg: AppConfig}) {
  const missing: string[] = [];
  if (!cfg.directors.includes('claude')) missing.push('ANTHROPIC_API_KEY (IA diretora Claude)');
  if (!cfg.directors.includes('openai')) missing.push('OPENAI_API_KEY (IA OpenAI, whisper-1, imagens)');
  if (!cfg.transcribers.some((t) => t !== 'script')) missing.push('ELEVENLABS_API_KEY ou GROQ_API_KEY (transcrição)');
  if (!cfg.pexels) missing.push('PEXELS_API_KEY (B-roll de banco)');
  if (!missing.length) return null;
  return (
    <details className="card mb-6 p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-key">Funcionando em modo limitado — {missing.length} chave(s) não configurada(s)</summary>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <p className="mt-3 text-muted">
        Sem chaves, o editor usa as <b>regras</b> no lugar da IA e o <b>alinhamento do roteiro</b> no lugar da transcrição (cole o roteiro ao criar o projeto). Configure em <code>.env.local</code> (veja <code>.env.example</code>).
      </p>
    </details>
  );
}

function NewProject({cfg, onClose}: {cfg: AppConfig; onClose: () => void}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  // estilo padrão: o último usado; senão o estilo próprio mais recente (da referência); senão Dynamic
  const [style, setStyle] = useState(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem('ev:lastStyle');
    } catch {
      /* sem storage */
    }
    if (last && cfg.styles.some((s) => s.id === last)) return last;
    return [...cfg.styles].reverse().find((s) => s.custom)?.id ?? 'dynamic';
  });
  const [isLong, setIsLong] = useState(false);
  const [director, setDirector] = useState<string>(cfg.directors.includes('claude') ? 'claude' : cfg.directors.includes('openai') ? 'openai' : 'heuristic');
  const [platform, setPlatform] = useState('instagram');
  const [glossary, setGlossary] = useState('');
  const [script, setScript] = useState('');
  const [aggr, setAggr] = useState('medium');
  const [mistakes, setMistakes] = useState(true);
  const [music, setMusic] = useState('builtin:music/upbeat.mp3');
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const noTranscriber = !cfg.transcribers.some((t) => t !== 'script');

  const submit = async () => {
    setErr(null);
    if (!files.length) return setErr('Escolha pelo menos um vídeo.');
    if (noTranscriber && !script.trim()) return setErr('Sem chave de transcrição: cole o roteiro do que você fala no vídeo.');
    try {
      setBusy('Criando projeto');
      try {
        localStorage.setItem('ev:lastStyle', style);
      } catch {
        /* sem storage */
      }
      const {project} = await api<{project: Project}>('/api/projects', {
        method: 'POST',
        json: {
          name: name.trim() || files[0].name.replace(/\.[^.]+$/, ''),
          style,
          director,
          platform,
          aggressiveness: aggr,
          removeMistakes: mistakes,
          glossary: glossary.split(',').map((s) => s.trim()).filter(Boolean),
          script: script.trim() || undefined,
          musicKey: music === 'none' || music === 'upload' ? undefined : music,
        },
      });
      for (const [i, f] of files.entries()) {
        setBusy(`Enviando ${f.name} (${i + 1}/${files.length})`);
        await uploadProjectFile(project.id, f, 'source', (p) => setProgress((i + p) / files.length));
      }
      if (music === 'upload' && musicFile) {
        setBusy('Enviando a música');
        await uploadProjectFile(project.id, musicFile, 'music', setProgress);
      }
      if (isLong) localStorage.setItem(`shorts:${project.id}`, '1');
      setBusy('Iniciando o processamento');
      await api(`/api/projects/${project.id}/process`, {method: 'POST'});
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="card my-8 w-full max-w-3xl p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">Novo vídeo</h2>
          <button className="btn-ghost" onClick={onClose} disabled={!!busy}>
            Fechar
          </button>
        </div>

        <div
          className="mb-5 cursor-pointer rounded-xl border-2 border-dashed border-line p-6 text-center hover:border-brand"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setFiles([...files, ...Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('video/'))]);
          }}
        >
          <input ref={fileRef} type="file" accept="video/*" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
          <p className="font-semibold">Arraste o vídeo cru aqui (um ou vários takes)</p>
          <p className="text-xs text-muted">MP4/MOV — a ordem dos arquivos é a ordem do vídeo</p>
          {files.length > 0 && (
            <ul className="mt-3 space-y-1 text-left text-sm">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between rounded bg-panel2 px-3 py-1">
                  <span className="truncate">
                    {i + 1}. {f.name}
                  </span>
                  <span className="text-xs text-muted">{(f.size / 1e6).toFixed(1)} MB</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Nome</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Meu reel" />
          </div>
          <div>
            <label className="label">Plataforma (área segura)</label>
            <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="instagram">Instagram Reels</option>
              <option value="tiktok">TikTok</option>
              <option value="shorts">YouTube Shorts</option>
              <option value="all">Todas</option>
            </select>
          </div>
        </div>

        <label className="label mt-5">Estilo</label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cfg.styles.map((s) => (
            <button key={s.id} onClick={() => setStyle(s.id)} className={`rounded-xl border p-3 text-left transition ${style === s.id ? 'border-brand bg-brand/10' : 'border-line bg-panel2 hover:border-muted'}`}>
              <div className="mb-2 flex gap-1">
                {[s.palette.key, s.palette.accent, s.palette.bg].map((c) => (
                  <span key={c} className="h-4 w-4 rounded-full border border-white/20" style={{background: c}} />
                ))}
              </div>
              <div className="text-sm font-bold">
                {s.name}
                {s.custom && <span className="ml-1 rounded bg-brand2/20 px-1 text-[10px] text-brand2">meu</span>}
              </div>
              <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted">{s.summary}</div>
            </button>
          ))}
        </div>

        <label className="label mt-5">IA diretora</label>
        <div className="flex flex-wrap gap-2">
          {(['claude', 'openai', 'compare', 'heuristic'] as const).map((d) => {
            const ok = d === 'compare' ? cfg.directors.includes('claude') && cfg.directors.includes('openai') : cfg.directors.includes(d);
            return (
              <button key={d} disabled={!ok} onClick={() => setDirector(d)} className={`btn ${director === d ? 'bg-brand text-white' : 'bg-panel2 text-white'} ${!ok ? 'line-through' : ''}`} title={ok ? '' : 'chave não configurada'}>
                {DIRECTOR_LABEL[d]}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-muted">
          <a className="underline" href="/styles">
            Criar um estilo copiando um reel de referência →
          </a>
        </p>
        <p className="mt-1 text-xs text-muted">Comparar gera dois planos (Claude e OpenAI) e mostra os previews lado a lado — custa só as chamadas de texto.</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Cortes</label>
            <select className="input" value={aggr} onChange={(e) => setAggr(e.target.value)}>
              <option value="gentle">Suave — corta só pausas longas (&gt; 0,6 s)</option>
              <option value="medium">Médio — corta pausas &gt; 0,35 s</option>
              <option value="tight">Todo respiro — corta pausas &gt; 0,2 s (ritmo rápido)</option>
            </select>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={mistakes} onChange={() => setMistakes(!mistakes)} /> Remover erros, repetições e "pera, vou de novo" (fica só a versão completa)
            </label>
          </div>
          <div>
            <label className="label">Música de fundo</label>
            <select className="input" value={music} onChange={(e) => setMusic(e.target.value)}>
              <option value="builtin:music/upbeat.mp3">Animada (sintetizada)</option>
              <option value="builtin:music/calm.mp3">Calma (sintetizada)</option>
              <option value="builtin:music/cinematic.mp3">Cinematográfica (sintetizada)</option>
              <option value="ai:upbeat">Gerada por IA — animada{cfg.musicAI ? '' : ' (sem chave: sintetizada)'}</option>
              <option value="ai:calm">Gerada por IA — calma{cfg.musicAI ? '' : ' (sem chave: sintetizada)'}</option>
              <option value="ai:cinematic">Gerada por IA — cinematográfica{cfg.musicAI ? '' : ' (sem chave: sintetizada)'}</option>
              <option value="upload">Enviar meu arquivo…</option>
              <option value="none">Sem música</option>
            </select>
            {music === 'upload' && <input type="file" accept="audio/*" className="mt-2 text-xs" onChange={(e) => setMusicFile(e.target.files?.[0] ?? null)} />}
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isLong} onChange={() => setIsLong(!isLong)} /> É um vídeo longo (podcast, live, aula) — quero cortar em Shorts depois
        </label>
        <div className="mt-5">
          <label className="label">Glossário (nomes, marcas, termos — separados por vírgula)</label>
          <input className="input" value={glossary} onChange={(e) => setGlossary(e.target.value)} placeholder="Claude, Supabase, RX Estratégias" />
        </div>
        <div className="mt-5">
          <label className="label">Roteiro {noTranscriber ? '(obrigatório sem chave de transcrição)' : '(opcional — ajuda a escolher os takes)'}</label>
          <textarea className="input min-h-24" value={script} onChange={(e) => setScript(e.target.value)} placeholder="Cole aqui o texto que você fala no vídeo…" />
        </div>

        {err && <p className="mt-4 rounded-lg bg-red-900/40 p-3 text-sm text-red-200">{err}</p>}
        <div className="mt-6 flex items-center justify-end gap-3">
          {busy && (
            <div className="mr-auto flex-1 text-sm text-muted">
              {busy}
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-panel2">
                <div className="h-full bg-brand transition-all" style={{width: `${Math.round(progress * 100)}%`}} />
              </div>
            </div>
          )}
          <button className="btn-primary px-5 py-2" onClick={submit} disabled={!!busy}>
            Criar e processar
          </button>
        </div>
      </div>
    </div>
  );
}
