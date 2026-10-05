'use client';
// "Novo vídeo": página inteira (antes era um pop-up). Esquerda: o formulário em
// seções; direita: resumo fixo com o botão de criar e o progresso do envio.
import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {api, uploadProjectFile, type AppConfig} from '@/lib/client/api';
import {loadPrefs, savePrefs, type Prefs} from '@/lib/client/prefs';
import type {Project} from '@/lib/adapters/db/types';
import {AppShell, Page, PageHeader} from './ui/AppShell';
import {Icon, Spinner} from './ui/Icon';
import {DIRECTOR_LABEL, PLATFORM_LABEL} from './ui/status';

export const MUSIC_OPTIONS = (musicAI: boolean) => [
  ['builtin:music/upbeat.mp3', 'Animada (sintetizada)'],
  ['builtin:music/calm.mp3', 'Calma (sintetizada)'],
  ['builtin:music/cinematic.mp3', 'Cinematográfica (sintetizada)'],
  ['ai:upbeat', `Gerada por IA — animada${musicAI ? '' : ' (sem chave: sintetizada)'}`],
  ['ai:calm', `Gerada por IA — calma${musicAI ? '' : ' (sem chave: sintetizada)'}`],
  ['ai:cinematic', `Gerada por IA — cinematográfica${musicAI ? '' : ' (sem chave: sintetizada)'}`],
];

export const AGGR_OPTIONS = [
  ['gentle', 'Suave', 'só pausas longas (> 0,6 s)'],
  ['medium', 'Médio', 'pausas > 0,35 s'],
  ['tight', 'Todo respiro', 'pausas > 0,2 s, ritmo rápido'],
] as const;

export const directorOk = (cfg: AppConfig, d: string) => (d === 'compare' ? cfg.directors.includes('claude') && cfg.directors.includes('openai') : cfg.directors.includes(d as 'claude'));
export const defaultDirector = (cfg: AppConfig, pref?: string) => (pref && directorOk(cfg, pref) ? pref : cfg.directors.includes('claude') ? 'claude' : cfg.directors.includes('openai') ? 'openai' : 'heuristic');
export const defaultStyle = (cfg: AppConfig, pref?: string) => (pref && cfg.styles.some((s) => s.id === pref) ? pref : [...cfg.styles].reverse().find((s) => s.custom)?.id ?? 'dynamic');

export default function NewProjectPage() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<AppConfig>('/api/config').then(setCfg).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  return (
    <AppShell>
      <Page>
        <PageHeader crumbs={[{href: '/', label: 'Projetos'}]} title="Novo vídeo" subtitle="Suba o vídeo cru, escolha o estilo e a IA faz a primeira edição. Tudo pode ser ajustado depois no editor." />
        {err ? <p className="text-danger">{err}</p> : !cfg ? <FormSkeleton /> : <NewProjectForm cfg={cfg} prefs={loadPrefs()} />}
      </Page>
    </AppShell>
  );
}

function FormSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {[180, 260, 160].map((h) => (
          <div key={h} className="skeleton rounded-2xl" style={{height: h}} />
        ))}
      </div>
      <div className="skeleton h-64 rounded-2xl" />
    </div>
  );
}

function Section({n, title, desc, children}: {n: number; title: string; desc?: string; children: React.ReactNode}) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">{n}</span>
        <div>
          <h2 className="font-bold">{title}</h2>
          {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function NewProjectForm({cfg, prefs}: {cfg: AppConfig; prefs: Prefs}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [style, setStyle] = useState(() => defaultStyle(cfg, prefs.style));
  const [isLong, setIsLong] = useState(false);
  const [director, setDirector] = useState<string>(() => defaultDirector(cfg, prefs.director));
  const [platform, setPlatform] = useState(prefs.platform ?? 'instagram');
  const [glossary, setGlossary] = useState(prefs.glossary ?? '');
  const [script, setScript] = useState('');
  const [aggr, setAggr] = useState<string>(prefs.aggressiveness ?? 'medium');
  const [mistakes, setMistakes] = useState(prefs.removeMistakes ?? true);
  const [music, setMusic] = useState(prefs.music ?? 'builtin:music/upbeat.mp3');
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const noTranscriber = !cfg.transcribers.some((t) => t !== 'script');
  const totalMb = files.reduce((s, f) => s + f.size, 0) / 1e6;

  // não deixa fechar a aba no meio do envio
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  const addFiles = (list: FileList | File[] | null) => setFiles((cur) => [...cur, ...Array.from(list ?? []).filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name))]);
  const moveFile = (i: number, d: -1 | 1) =>
    setFiles((cur) => {
      const a = cur.slice();
      const j = i + d;
      if (j < 0 || j >= a.length) return a;
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });

  const submit = async () => {
    setErr(null);
    if (!files.length) return setErr('Escolha pelo menos um vídeo.');
    if (noTranscriber && !script.trim()) return setErr('Sem chave de transcrição: cole o roteiro do que você fala no vídeo.');
    if (music === 'upload' && !musicFile) return setErr('Escolha o arquivo da música (ou outra opção de música).');
    try {
      setBusy('Criando projeto');
      setProgress(0);
      savePrefs({style});
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

  const styleName = cfg.styles.find((s) => s.id === style)?.name ?? style;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
      <fieldset disabled={!!busy} className="min-w-0 space-y-5">
        <Section n={1} title="Vídeo" desc="Um ou vários takes. A ordem dos arquivos é a ordem do vídeo.">
          <div
            role="button"
            tabIndex={0}
            className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${dragging ? 'border-brand bg-brand/10' : 'border-line hover:border-line2 hover:bg-panel2'}`}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand/15 text-brand">
              <Icon name="upload" size={22} />
            </div>
            <p className="font-semibold">Arraste o vídeo cru aqui ou clique para escolher</p>
            <p className="mt-1 text-xs text-muted">MP4, MOV ou WebM</p>
          </div>
          {files.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="surface flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-panel3 text-xs font-bold text-muted">{i + 1}</span>
                  <Icon name="film" className="text-subtle" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-xs text-muted tabular-nums">{(f.size / 1e6).toFixed(1)} MB</span>
                  {files.length > 1 && (
                    <>
                      <button type="button" className="btn-icon h-7 w-7" disabled={i === 0} onClick={() => moveFile(i, -1)} title="Subir">
                        <Icon name="chevronDown" className="rotate-180" />
                      </button>
                      <button type="button" className="btn-icon h-7 w-7" disabled={i === files.length - 1} onClick={() => moveFile(i, 1)} title="Descer">
                        <Icon name="chevronDown" />
                      </button>
                    </>
                  )}
                  <button type="button" className="btn-icon h-7 w-7 hover:text-danger" onClick={() => setFiles(files.filter((_, j) => j !== i))} title="Remover">
                    <Icon name="x" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="np-name">
                Nome do projeto
              </label>
              <input id="np-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Meu reel" />
            </div>
            <div>
              <label className="label" htmlFor="np-platform">
                Plataforma (área segura)
              </label>
              <select id="np-platform" className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {Object.entries(PLATFORM_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="mt-4 flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={isLong} onChange={() => setIsLong(!isLong)} /> É um vídeo longo (podcast, live, aula) — quero cortar em Shorts depois
          </label>
        </Section>

        <Section n={2} title="Estilo" desc="Cores, fontes, legenda, câmera, ritmo, gráficos, sons e música.">
          <StylePicker cfg={cfg} value={style} onChange={setStyle} />
          <Link className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand2 hover:underline" href="/styles">
            Criar um estilo copiando um reel de referência <Icon name="chevronRight" size={12} />
          </Link>
        </Section>

        <Section n={3} title="Edição" desc="Quem decide zoom, B-roll, gráficos e sons, e quanto cortar.">
          <label className="label">IA diretora</label>
          <DirectorPicker cfg={cfg} value={director} onChange={setDirector} />
          <p className="hint">Comparar gera dois planos (Claude e OpenAI) e mostra os previews lado a lado — custa só as chamadas de texto.</p>

          <label className="label mt-5">Cortes</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {AGGR_OPTIONS.map(([k, l, d]) => (
              <button type="button" key={k} onClick={() => setAggr(k)} className={aggr === k ? 'option-on' : 'option'}>
                <div className="text-sm font-semibold">{l}</div>
                <div className="mt-0.5 text-xs text-muted">Corta {d}</div>
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={mistakes} onChange={() => setMistakes(!mistakes)} /> Remover erros, repetições e &quot;pera, vou de novo&quot; (fica só a versão completa)
          </label>
        </Section>

        <Section n={4} title="Áudio e texto" desc="Música de fundo, termos que a transcrição deve acertar e o roteiro.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="np-music">
                Música de fundo
              </label>
              <select id="np-music" className="input" value={music} onChange={(e) => setMusic(e.target.value)}>
                {MUSIC_OPTIONS(cfg.musicAI).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
                <option value="upload">Enviar meu arquivo…</option>
                <option value="none">Sem música</option>
              </select>
              {music === 'upload' && <input type="file" accept="audio/*" className="mt-2 block w-full text-xs text-muted file:mr-3 file:rounded-md file:border-0 file:bg-panel3 file:px-3 file:py-1.5 file:text-text" onChange={(e) => setMusicFile(e.target.files?.[0] ?? null)} />}
            </div>
            <div>
              <label className="label" htmlFor="np-glossary">
                Glossário
              </label>
              <input id="np-glossary" className="input" value={glossary} onChange={(e) => setGlossary(e.target.value)} placeholder="Claude, Supabase, RX Estratégias" />
              <p className="hint">Nomes, marcas e termos, separados por vírgula.</p>
            </div>
          </div>
          <div className="mt-4">
            <label className="label" htmlFor="np-script">
              Roteiro {noTranscriber ? <span className="text-warn">(obrigatório sem chave de transcrição)</span> : <span className="normal-case">(opcional — ajuda a escolher os takes)</span>}
            </label>
            <textarea id="np-script" className="input min-h-28" value={script} onChange={(e) => setScript(e.target.value)} placeholder="Cole aqui o texto que você fala no vídeo…" />
          </div>
        </Section>
      </fieldset>

      <aside className="lg:sticky lg:top-20">
        <div className="card p-5">
          <h2 className="section-title">Resumo</h2>
          <dl className="space-y-2.5 text-sm">
            <Sum k="Vídeos" v={files.length ? `${files.length} arquivo(s) · ${totalMb.toFixed(0)} MB` : <span className="text-warn">nenhum ainda</span>} />
            <Sum k="Estilo" v={styleName} />
            <Sum k="IA diretora" v={DIRECTOR_LABEL[director]} />
            <Sum k="Plataforma" v={PLATFORM_LABEL[platform]} />
            <Sum k="Cortes" v={AGGR_OPTIONS.find((a) => a[0] === aggr)?.[1] ?? aggr} />
          </dl>
          {err && (
            <p className="mt-4 flex gap-2 rounded-lg bg-danger/10 p-3 text-sm text-red-200">
              <Icon name="alert" className="mt-0.5 text-danger" />
              {err}
            </p>
          )}
          {busy ? (
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-2 text-sm">
                <Spinner className="text-brand" />
                <span className="min-w-0 flex-1 truncate">{busy}</span>
                <span className="text-xs text-muted tabular-nums">{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-panel3">
                <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand2 transition-all" style={{width: `${Math.max(3, Math.round(progress * 100))}%`}} />
              </div>
              <p className="hint">Não feche esta aba até o envio terminar.</p>
            </div>
          ) : (
            <button className="btn-primary btn-lg mt-5 w-full" onClick={submit}>
              <Icon name="sparkles" /> Criar e processar
            </button>
          )}
          <p className="mt-3 text-center text-xs text-muted">Leva alguns minutos. Você pode acompanhar o progresso na próxima tela.</p>
        </div>
      </aside>
    </div>
  );
}

const Sum = ({k, v}: {k: string; v: React.ReactNode}) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className="text-muted">{k}</dt>
    <dd className="truncate text-right font-medium">{v}</dd>
  </div>
);

export function StylePicker({cfg, value, onChange}: {cfg: AppConfig; value: string; onChange: (id: string) => void}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {cfg.styles.map((s) => (
        <button type="button" key={s.id} onClick={() => onChange(s.id)} className={`relative ${value === s.id ? 'option-on' : 'option'}`}>
          {value === s.id && (
            <span className="absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
              <Icon name="check" size={12} strokeWidth={3} />
            </span>
          )}
          <div className="mb-2 flex gap-1">
            {[s.palette.key, s.palette.accent, s.palette.bg].map((c, i) => (
              <span key={i} className="h-4 w-4 rounded-full border border-white/20" style={{background: c}} />
            ))}
          </div>
          <div className="pr-6 text-sm font-bold">
            {s.name}
            {s.custom && <span className="ml-1.5 rounded bg-brand2/15 px-1 py-px text-[10px] text-brand2">meu</span>}
          </div>
          <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted">{s.summary}</div>
        </button>
      ))}
    </div>
  );
}

export function DirectorPicker({cfg, value, onChange}: {cfg: AppConfig; value: string; onChange: (d: string) => void}) {
  return (
    <div className="flex flex-wrap gap-2">
      {(['claude', 'openai', 'compare', 'heuristic'] as const).map((d) => {
        const ok = directorOk(cfg, d);
        return (
          <button type="button" key={d} disabled={!ok} onClick={() => onChange(d)} className={`btn border ${value === d ? 'border-brand bg-brand/15 text-text' : 'border-line bg-panel2 text-muted hover:text-text'}`} title={ok ? '' : 'chave não configurada'}>
            {value === d && <Icon name="check" size={14} className="text-brand" />}
            {DIRECTOR_LABEL[d]}
            {!ok && <Icon name="key" size={12} />}
          </button>
        );
      })}
    </div>
  );
}
