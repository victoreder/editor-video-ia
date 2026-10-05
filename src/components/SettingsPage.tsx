'use client';
// Configurações: integrações (quais chaves estão ativas e o que cada uma liga),
// padrões do "Novo vídeo" (salvos neste navegador), infraestrutura e conta.
import {useEffect, useState} from 'react';
import {api, type AppConfig} from '@/lib/client/api';
import {loadPrefs, savePrefs, type Prefs} from '@/lib/client/prefs';
import {AppShell, Page, PageHeader, logout} from './ui/AppShell';
import {Icon, type IconName} from './ui/Icon';
import {PLATFORM_LABEL} from './ui/status';
import {AGGR_OPTIONS, DirectorPicker, MUSIC_OPTIONS, StylePicker, defaultDirector, defaultStyle} from './NewProjectPage';

type Tab = 'general' | 'integrations' | 'system' | 'account';
const TABS: {id: Tab; label: string; icon: IconName}[] = [
  {id: 'general', label: 'Padrões de edição', icon: 'sliders'},
  {id: 'integrations', label: 'Integrações', icon: 'key'},
  {id: 'system', label: 'Sistema', icon: 'server'},
  {id: 'account', label: 'Conta', icon: 'user'},
];

export default function SettingsPage() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [tab, setTab] = useState<Tab>('general');
  useEffect(() => {
    api<AppConfig>('/api/config').then(setCfg).catch(() => undefined);
    const h = window.location.hash.slice(1) as Tab;
    if (TABS.some((t) => t.id === h)) setTab(h);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };
  return (
    <AppShell>
      <Page>
        <PageHeader title="Configurações" subtitle="Padrões dos novos vídeos, integrações de IA e informações do sistema." />
        <div className="grid items-start gap-6 md:grid-cols-[220px_1fr]">
          <nav className="flex gap-1 overflow-x-auto md:sticky md:top-20 md:flex-col">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => go(t.id)} className={`${tab === t.id ? 'tab-on' : 'tab'} justify-start md:py-2`}>
                <Icon name={t.icon} /> {t.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 animate-fade-in" key={tab}>
            {!cfg ? (
              <div className="skeleton h-80 rounded-2xl" />
            ) : tab === 'general' ? (
              <Defaults cfg={cfg} />
            ) : tab === 'integrations' ? (
              <Integrations cfg={cfg} />
            ) : tab === 'system' ? (
              <System cfg={cfg} />
            ) : (
              <Account />
            )}
          </div>
        </div>
      </Page>
    </AppShell>
  );
}

function Card({title, desc, children, footer}: {title: string; desc?: string; children: React.ReactNode; footer?: React.ReactNode}) {
  return (
    <section className="card mb-5 overflow-hidden">
      <div className="p-5 sm:p-6">
        <h2 className="font-bold">{title}</h2>
        {desc && <p className="mt-1 text-sm text-muted">{desc}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="flex items-center justify-end gap-3 border-t border-line bg-panel2/50 px-5 py-3 sm:px-6">{footer}</div>}
    </section>
  );
}

function Defaults({cfg}: {cfg: AppConfig}) {
  const [p, setP] = useState<Prefs>(() => loadPrefs());
  const [saved, setSaved] = useState(false);
  const set = (patch: Prefs) => {
    setP({...p, ...patch});
    setSaved(false);
  };
  const save = () => {
    savePrefs(p);
    setSaved(true);
  };
  return (
    <>
      <Card
        title="Padrões do “Novo vídeo”"
        desc="O que já vem selecionado ao criar um projeto. Fica salvo neste navegador."
        footer={
          <>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-ok">
                <Icon name="check" /> Salvo
              </span>
            )}
            <button className="btn-primary" onClick={save}>
              Salvar padrões
            </button>
          </>
        }
      >
        <label className="label">Estilo padrão</label>
        <StylePicker cfg={cfg} value={defaultStyle(cfg, p.style)} onChange={(style) => set({style})} />

        <label className="label mt-6">IA diretora</label>
        <DirectorPicker cfg={cfg} value={defaultDirector(cfg, p.director)} onChange={(d) => set({director: d as Prefs['director']})} />

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Plataforma</label>
            <select className="input" value={p.platform ?? 'instagram'} onChange={(e) => set({platform: e.target.value})}>
              {Object.entries(PLATFORM_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Cortes</label>
            <select className="input" value={p.aggressiveness ?? 'medium'} onChange={(e) => set({aggressiveness: e.target.value as Prefs['aggressiveness']})}>
              {AGGR_OPTIONS.map(([k, l, d]) => (
                <option key={k} value={k}>
                  {l} — {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Música de fundo</label>
            <select className="input" value={p.music ?? 'builtin:music/upbeat.mp3'} onChange={(e) => set({music: e.target.value})}>
              {MUSIC_OPTIONS(cfg.musicAI).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
              <option value="none">Sem música</option>
            </select>
          </div>
          <div>
            <label className="label">Glossário padrão</label>
            <input className="input" value={p.glossary ?? ''} onChange={(e) => set({glossary: e.target.value})} placeholder="Sua marca, seu nome, termos do nicho" />
          </div>
        </div>
        <label className="mt-4 flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={p.removeMistakes ?? true} onChange={() => set({removeMistakes: !(p.removeMistakes ?? true)})} /> Remover erros e repetições por padrão
        </label>
      </Card>
    </>
  );
}

function Integrations({cfg}: {cfg: AppConfig}) {
  const transcribers = cfg.transcribers.filter((t) => t !== 'script');
  const rows: {name: string; env: string; on: boolean; what: string; detail?: string}[] = [
    {name: 'Claude (Anthropic)', env: 'ANTHROPIC_API_KEY', on: cfg.directors.includes('claude'), what: 'IA diretora, edição por chat, legenda do post', detail: cfg.models.claude},
    {name: 'OpenAI', env: 'OPENAI_API_KEY', on: cfg.directors.includes('openai'), what: 'IA diretora alternativa, transcrição whisper-1, imagens', detail: cfg.models.openai},
    {name: 'Transcrição', env: 'ELEVENLABS, GROQ ou OPENAI_API_KEY', on: transcribers.length > 0, what: 'Texto palavra a palavra para cortes e legendas', detail: transcribers.join(', ') || undefined},
    {name: 'Pexels', env: 'PEXELS_API_KEY', on: cfg.pexels, what: 'B-roll de banco de vídeos e fotos'},
    {name: 'Geração de imagens', env: 'OPENAI_API_KEY ou REPLICATE_API_TOKEN', on: cfg.imageGen, what: 'B-roll gerado por IA quando não há vídeo de banco'},
    {name: 'Música por IA', env: 'ELEVENLABS_API_KEY', on: cfg.musicAI, what: 'Trilha original gerada para cada vídeo'},
    {name: 'Vídeo por IA', env: 'REPLICATE_API_TOKEN + BROLL_AI_VIDEO=1', on: cfg.videoAI, what: 'B-roll em vídeo gerado por IA'},
  ];
  const on = rows.filter((r) => r.on).length;
  return (
    <Card title="Integrações" desc={`${on} de ${rows.length} ativas. As chaves ficam nas variáveis de ambiente do servidor (.env.local ou painel da hospedagem) — nunca no navegador.`}>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {rows.map((r) => (
          <li key={r.name} className="flex flex-wrap items-center gap-3 bg-panel2/40 px-4 py-3">
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${r.on ? 'bg-ok/15 text-ok' : 'bg-panel3 text-subtle'}`}>
              <Icon name={r.on ? 'check' : 'key'} size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                {r.name}
                {r.detail && <span className="ml-2 font-mono text-[11px] font-normal text-muted">{r.detail}</span>}
              </div>
              <div className="text-xs text-muted">{r.what}</div>
            </div>
            {r.on ? <span className="badge bg-ok/15 text-ok">Conectado</span> : <code className="rounded bg-panel3 px-2 py-0.5 text-[11px] text-muted">{r.env}</code>}
          </li>
        ))}
      </ul>
      <p className="hint mt-4">Sem chaves, o editor usa as <b>regras</b> no lugar da IA e o <b>alinhamento do roteiro</b> no lugar da transcrição (cole o roteiro ao criar o projeto). Veja <code>.env.example</code>.</p>
    </Card>
  );
}

function System({cfg}: {cfg: AppConfig}) {
  const rows: [string, string, IconName][] = [
    ['Armazenamento', cfg.storage, 'download'],
    ['Banco de dados', cfg.db, 'server'],
    ['Processamento', cfg.runner, 'refresh'],
    ['Modelo Claude', cfg.models.claude, 'sparkles'],
    ['Modelo OpenAI', cfg.models.openai, 'sparkles'],
    ['Estilos disponíveis', `${cfg.styles.length} (${cfg.styles.filter((s) => s.custom).length} seus)`, 'palette'],
  ];
  return (
    <Card title="Sistema" desc="Como este servidor está configurado.">
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map(([k, v, i]) => (
          <div key={k} className="surface flex items-center gap-3 p-3">
            <Icon name={i} className="text-subtle" />
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="ml-auto truncate font-mono text-xs">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Account() {
  return (
    <Card title="Conta" desc="O acesso é protegido pela senha definida em APP_PASSWORD.">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-panel3 text-muted">
          <Icon name="user" />
        </div>
        <div className="flex-1 text-sm">
          <div className="font-semibold">Sessão ativa</div>
          <div className="text-xs text-muted">Neste navegador</div>
        </div>
        <button className="btn-ghost text-red-300" onClick={logout}>
          <Icon name="logout" /> Sair
        </button>
      </div>
    </Card>
  );
}
