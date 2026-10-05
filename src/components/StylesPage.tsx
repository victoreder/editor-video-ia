'use client';
// "Meu estilo" (módulos 10 e 11): estilos prontos, estilos próprios editáveis e
// "copiar o estilo de um reel" — sobe um reel que você admira e a IA cria o estilo.
import {useEffect, useRef, useState} from 'react';
import {api, uploadToPrefix, waitJob} from '@/lib/client/api';
import type {StyleConfig} from '@/lib/plan/schema';
import type {Job} from '@/lib/adapters/db/types';

type Data = {builtin: StyleConfig[]; custom: StyleConfig[]};

export default function StylesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<StyleConfig | null>(null);
  const load = () => api<Data>('/api/styles').then(setData);
  useEffect(() => {
    load();
  }, []);
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-center gap-3">
        <a className="btn-ghost" href="/">
          ←
        </a>
        <div>
          <h1 className="text-2xl font-extrabold">Meu estilo</h1>
          <p className="text-sm text-muted">Um estilo é a "receita" da edição: cores, fontes, legenda, câmera, ritmo, gráficos, sons e música.</p>
        </div>
      </header>
      <FromReference onDone={(s) => {
        load();
        setEditing(s);
      }} />
      {!data ? (
        <p className="text-muted">Carregando…</p>
      ) : (
        <>
          <h2 className="mb-3 mt-8 font-bold">Meus estilos</h2>
          {data.custom.length === 0 && <p className="text-sm text-muted">Nenhum ainda — copie de um reel acima ou duplique um estilo pronto.</p>}
          <Grid styles={data.custom} onEdit={setEditing} onDelete={async (s) => {
            if (!confirm(`Apagar "${s.name}"?`)) return;
            await api(`/api/styles?id=${s.id}`, {method: 'DELETE'});
            load();
          }} />
          <h2 className="mb-3 mt-8 font-bold">Prontos</h2>
          <Grid styles={data.builtin} onEdit={(s) => setEditing({...structuredClone(s), id: 'novo', name: `${s.name} (meu)`, origin: `cópia de ${s.name}`})} editLabel="Duplicar e editar" />
        </>
      )}
      {editing && (
        <Editor
          style={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </main>
  );
}

function Grid({styles, onEdit, onDelete, editLabel = 'Editar'}: {styles: StyleConfig[]; onEdit: (s: StyleConfig) => void; onDelete?: (s: StyleConfig) => void; editLabel?: string}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {styles.map((s) => (
        <div key={s.id} className="card p-4">
          <div className="mb-2 flex gap-1">
            {[s.palette.key, s.palette.accent, s.palette.bg, s.palette.panel].map((c, i) => (
              <span key={i} className="h-5 w-5 rounded-full border border-white/20" style={{background: c}} />
            ))}
          </div>
          <div className="font-bold">{s.name}</div>
          <p className="mt-1 line-clamp-3 text-xs text-muted">{s.summary}</p>
          {s.origin && <p className="mt-1 text-[11px] text-brand2">{s.origin}</p>}
          <div className="mt-3 flex gap-2">
            <button className="btn-ghost text-xs" onClick={() => onEdit(s)}>
              {editLabel}
            </button>
            {onDelete && (
              <button className="btn-ghost text-xs" onClick={() => onDelete(s)}>
                Apagar
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function FromReference({onDone}: {onDone: (s: StyleConfig) => void}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [upload, setUpload] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const start = async () => {
    if (!file) return;
    setErr(null);
    try {
      const key = await uploadToPrefix('styles', file, setUpload);
      setUpload(null);
      const {job: j} = await api<{job: Job}>('/api/styles/reference', {method: 'POST', json: {key, name: name || file.name.replace(/\.[^.]+$/, '')}});
      const done = await waitJob(j.id, setJob);
      if (done.status === 'done') onDone((done.result as {style: StyleConfig}).style);
      else setErr(done.error ?? 'falhou');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setUpload(null);
    }
  };
  const busy = upload !== null || (job !== null && job.status !== 'done' && job.status !== 'error' && job.status !== 'cancelled');
  return (
    <div className="card p-5">
      <h2 className="mb-1 font-bold">Copiar o estilo de um reel</h2>
      <p className="mb-4 text-sm text-muted">Suba um reel que você admira. O sistema mede o ritmo dos cortes e as cores, e a IA (com visão) analisa legendas, zooms, gráficos e transições para criar um estilo novo.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={ref} type="file" accept="video/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn-ghost" onClick={() => ref.current?.click()}>
          {file ? file.name : 'Escolher o reel…'}
        </button>
        <input className="input max-w-64" placeholder="Nome do estilo" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" disabled={!file || busy} onClick={start}>
          Analisar e criar estilo
        </button>
      </div>
      {upload !== null && <p className="mt-3 text-sm text-muted">Enviando… {Math.round(upload * 100)}%</p>}
      {job && job.status !== 'done' && <p className="mt-3 text-sm text-muted">{(job.status === 'error' || job.status === 'cancelled') ? `Erro: ${job.error}` : `${job.label} — ${job.progress}%`}</p>}
      {err && <p className="mt-3 text-sm text-red-300">{err}</p>}
    </div>
  );
}

const PRESETS = ['bold-pop', 'karaoke', 'pill', 'editorial', 'clean'] as const;
const FONTS = ['Montserrat', 'Inter', 'Anton'];
const TRANS = ['whip', 'zoom', 'flash', 'glitch', 'blur'] as const;

function Editor({style, onClose, onSaved}: {style: StyleConfig; onClose: () => void; onSaved: () => void}) {
  const [s, setS] = useState<StyleConfig>(style);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof StyleConfig>(k: K, v: StyleConfig[K]) => setS({...s, [k]: v});
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/styles', {method: 'POST', json: s});
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const color = (k: keyof StyleConfig['palette'], label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(s.palette[k]) ? s.palette[k] : '#000000'} onChange={(e) => set('palette', {...s.palette, [k]: e.target.value})} /> {label}
    </label>
  );
  const num = (label: string, v: number, on: (n: number) => void, min: number, max: number, step: number) => (
    <label className="block text-sm">
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <input type="range" className="flex-1" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} />
        <span className="w-12 text-right text-xs text-muted">{v}</span>
      </div>
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
      <div className="card my-8 w-full max-w-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Editar estilo</h2>
          <button className="btn-ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">Nome</span>
            <input className="input" value={s.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Resumo</span>
            <input className="input" value={s.summary} onChange={(e) => set('summary', e.target.value)} />
          </label>
        </div>
        <h3 className="mb-2 mt-5 font-bold">Cores e fontes</h3>
        <div className="flex flex-wrap gap-4">
          {color('key', 'Destaque da legenda')}
          {color('accent', 'Acento')}
          {color('panel', 'Cards')}
          {color('bg', 'Fundo')}
          {color('text', 'Texto')}
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="label">Fonte dos títulos</span>
            <select className="input" value={s.fonts.display} onChange={(e) => set('fonts', {...s.fonts, display: e.target.value})}>
              {FONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Fonte do texto</span>
            <select className="input" value={s.fonts.body} onChange={(e) => set('fonts', {...s.fonts, body: e.target.value})}>
              {FONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          {num('Peso', s.fonts.displayWeight, (v) => set('fonts', {...s.fonts, displayWeight: v}), 400, 900, 100)}
        </div>
        <h3 className="mb-2 mt-5 font-bold">Legenda</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="label">Preset</span>
            <select className="input" value={s.captions.preset} onChange={(e) => set('captions', {...s.captions, preset: e.target.value as StyleConfig['captions']['preset']})}>
              {PRESETS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          {num('Palavras por bloco', s.captions.maxWords, (v) => set('captions', {...s.captions, maxWords: v}), 1, 6, 1)}
          {num('Tamanho (px em 1080)', s.captions.sizePx, (v) => set('captions', {...s.captions, sizePx: v}), 40, 120, 2)}
          {num('Destaques (fração)', s.captions.emphasisRate, (v) => set('captions', {...s.captions, emphasisRate: v}), 0, 0.3, 0.01)}
          {num('1 emoji a cada N blocos (0 = nunca)', s.captions.emojiEvery, (v) => set('captions', {...s.captions, emojiEvery: v}), 0, 20, 1)}
          <label className="flex items-center gap-2 pt-6 text-sm">
            <input type="checkbox" checked={s.captions.uppercase} onChange={() => set('captions', {...s.captions, uppercase: !s.captions.uppercase})} /> Caixa alta
          </label>
        </div>
        <h3 className="mb-2 mt-5 font-bold">Câmera e ritmo</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {num('Snap zoom (máx.)', s.camera.punchScale[1], (v) => set('camera', {...s.camera, punchScale: [Math.min(s.camera.punchScale[0], v), v], maxZoom: Math.max(v, s.camera.maxZoom)}), 1.05, 1.6, 0.01)}
          {num('Snap a cada (s)', s.camera.punchEvery, (v) => set('camera', {...s.camera, punchEvery: v}), 2, 30, 1)}
          {num('Nada parado por mais de (s)', s.maxStatic, (v) => set('maxStatic', v), 1.5, 12, 0.5)}
          {num('Gráficos por minuto', s.graphics.perMinute, (v) => set('graphics', {...s.graphics, perMinute: v}), 0, 15, 1)}
          {num('B-rolls por minuto', s.broll.perMinute, (v) => set('broll', {...s.broll, perMinute: v}), 0, 15, 1)}
          {num('Volume da música', s.music.volume, (v) => set('music', {...s.music, volume: v}), 0, 0.5, 0.01)}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <span className="label w-full">Transições</span>
          {TRANS.map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input type="checkbox" checked={s.transitions.set.includes(t)} onChange={() => set('transitions', {...s.transitions, set: s.transitions.set.includes(t) ? s.transitions.set.filter((x) => x !== t) : [...s.transitions.set.filter((x) => x !== 'cut'), t]})} /> {t}
            </label>
          ))}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={s.camera.shake} onChange={() => set('camera', {...s.camera, shake: !s.camera.shake})} /> tremor no impacto
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={s.hook} onChange={() => set('hook', !s.hook)} /> gancho no início
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={s.progress} onChange={() => set('progress', !s.progress)} /> barra de progresso
          </label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="label">Sons</span>
            <select className="input" value={s.sfx.density} onChange={(e) => set('sfx', {...s.sfx, density: e.target.value as StyleConfig['sfx']['density']})}>
              <option value="low">Poucos</option>
              <option value="medium">Médio</option>
              <option value="high">Muitos</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Clima da música</span>
            <select className="input" value={s.music.mood} onChange={(e) => set('music', {...s.music, mood: e.target.value as StyleConfig['music']['mood']})}>
              <option value="upbeat">Animada</option>
              <option value="calm">Calma</option>
              <option value="cinematic">Cinematográfica</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Cor (look)</span>
            <select className="input" value={s.grade} onChange={(e) => set('grade', e.target.value as StyleConfig['grade'])}>
              <option value="punchy">Vibrante</option>
              <option value="clean">Limpo</option>
              <option value="film">Filme</option>
              <option value="none">Original</option>
            </select>
          </label>
          <label className="block sm:col-span-3">
            <span className="label">CTA no final (vazio = sem)</span>
            <input className="input" value={s.cta ?? ''} onChange={(e) => set('cta', e.target.value || null)} />
          </label>
        </div>
        <div className="mt-6 flex justify-end">
          <button className="btn-primary px-5 py-2" disabled={busy} onClick={save}>
            Salvar estilo
          </button>
        </div>
      </div>
    </div>
  );
}
