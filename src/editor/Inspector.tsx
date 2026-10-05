'use client';
// Painel de propriedades: muda conforme o item selecionado (clipe, legenda,
// gráfico, B-roll, zoom, som, transição) ou mostra as opções do vídeo inteiro.
import {useState} from 'react';
import type {EditPlan, OverlayKind, SfxKind, TransitionKind} from '../lib/plan/schema';
import {STYLE_LIST} from '../lib/styles';
import {api} from '../lib/client/api';
import {useEditor} from './store';
import {addBroll, addOverlay, addSfx, addZoom, deleteItem, setCaptionText, splitAt, updateBroll, updateCaption, updateClip, updateOverlay, updateZoom} from './ops';
import {uid} from '../lib/util/id';

const SFX: SfxKind[] = ['whoosh', 'swoosh', 'pop', 'click', 'impact', 'riser', 'sparkle', 'glitch', 'ding', 'typing'];
const TRANSITIONS: TransitionKind[] = ['cut', 'whip', 'zoom', 'flash', 'glitch', 'blur'];
const OVERLAYS: {kind: OverlayKind; label: string}[] = [
  {kind: 'stat', label: 'Número'},
  {kind: 'list', label: 'Lista'},
  {kind: 'title', label: 'Título'},
  {kind: 'quote', label: 'Citação'},
  {kind: 'emoji', label: 'Emoji'},
  {kind: 'strike', label: 'Riscado'},
  {kind: 'chips', label: 'Chips'},
];

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
  <div className="mb-3">
    <label className="label">{label}</label>
    {children}
  </div>
);
const Slider = ({value, min, max, step, onChange, fmt}: {value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string}) => (
  <div className="flex items-center gap-2">
    <input type="range" className="flex-1" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    <span className="w-14 text-right text-xs tabular-nums text-muted">{fmt ? fmt(value) : value.toFixed(2)}</span>
  </div>
);

export function Inspector({onReplan}: {onReplan: () => void}) {
  const plan = useEditor((s) => s.plan)!;
  const sel = useEditor((s) => s.selected);
  const frame = useEditor((s) => s.frame);
  const {apply, pushHistory, select, refresh} = useEditor.getState();
  const t = frame / plan.format.fps;
  /** gesto contínuo (slider): 1 passo de histórico no início */
  const live = (fn: (p: EditPlan) => EditPlan) => apply(fn, {history: false});

  const header = (title: string) => (
    <div className="mb-4 flex items-center justify-between">
      <h3 className="font-bold">{title}</h3>
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => select(null)}>
          Fechar
        </button>
        <button
          className="btn-danger"
          onClick={() => {
            apply((p) => deleteItem(p, sel), {refresh: sel?.kind === 'clip'});
            select(null);
          }}
        >
          Apagar
        </button>
      </div>
    </div>
  );

  if (sel?.kind === 'clip') {
    const c = plan.clips.find((x) => x.id === sel.id);
    if (!c) return null;
    const idx = plan.clips.indexOf(c);
    const tr = plan.transitions.find((x) => x.clipId === c.id);
    return (
      <div onPointerDown={pushHistory}>
        {header(`Clipe ${idx + 1}`)}
        <Row label="Nome">
          <input className="input" value={c.label ?? ''} onChange={(e) => live((p) => updateClip(p, c.id, {label: e.target.value}))} />
        </Row>
        <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-muted">
          <div>Entrada: {c.inSec.toFixed(2)}s</div>
          <div>Saída: {c.outSec.toFixed(2)}s</div>
        </div>
        <Row label="Velocidade">
          <Slider value={c.speed} min={0.25} max={3} step={0.05} fmt={(v) => `${v.toFixed(2)}x`} onChange={(v) => live((p) => updateClip(p, c.id, {speed: v}))} />
        </Row>
        <Row label="Volume da voz">
          <Slider value={c.volume} min={0} max={2} step={0.05} onChange={(v) => live((p) => updateClip(p, c.id, {volume: v}))} />
        </Row>
        <Row label="Enquadramento (zoom do clipe)">
          <Slider value={c.baseZoom} min={1} max={1.6} step={0.01} fmt={(v) => `${v.toFixed(2)}x`} onChange={(v) => live((p) => updateClip(p, c.id, {baseZoom: v}))} />
        </Row>
        <Row label="Transição na entrada">
          <select
            className="input"
            value={tr?.kind ?? 'cut'}
            onChange={(e) => {
              const kind = e.target.value as TransitionKind;
              apply((p) => ({...p, transitions: kind === 'cut' ? p.transitions.filter((x) => x.clipId !== c.id) : [...p.transitions.filter((x) => x.clipId !== c.id), {id: tr?.id ?? uid('tr'), clipId: c.id, kind, duration: 0.24}]}), {refresh: true});
            }}
          >
            {TRANSITIONS.map((k) => (
              <option key={k} value={k}>
                {k === 'cut' ? 'corte seco' : k}
              </option>
            ))}
          </select>
        </Row>
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={c.muted} onChange={() => apply((p) => updateClip(p, c.id, {muted: !c.muted}))} /> Sem som
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => apply((p) => splitAt(p, t).plan, {refresh: true})}>
            Dividir na agulha (S)
          </button>
          <button className="btn-ghost" disabled={idx === 0} onClick={() => apply((p) => ({...p, clips: swap(p.clips, idx, idx - 1)}), {refresh: true})}>
            ← Mover
          </button>
          <button className="btn-ghost" disabled={idx === plan.clips.length - 1} onClick={() => apply((p) => ({...p, clips: swap(p.clips, idx, idx + 1)}), {refresh: true})}>
            Mover →
          </button>
        </div>
      </div>
    );
  }

  if (sel?.kind === 'caption') {
    const c = plan.captions.chunks.find((x) => x.id === sel.id);
    if (!c) return null;
    return (
      <div>
        {header('Legenda')}
        <Row label="Texto">
          <input className="input" defaultValue={c.words.map((w) => w.text).join(' ')} key={c.id + c.words.length} onBlur={(e) => apply((p) => setCaptionText(p, c.id, e.target.value))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </Row>
        <Row label="Destaque (clique nas palavras)">
          <div className="flex flex-wrap gap-1">
            {c.words.map((w, i) => (
              <button key={i} className={`rounded px-2 py-0.5 text-sm ${w.accent ? 'bg-key text-black' : 'bg-panel2'}`} onClick={() => apply((p) => updateCaption(p, c.id, {words: c.words.map((x, j) => (j === i ? {...x, accent: !x.accent} : x))}))}>
                {w.text}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Emoji">
          <input className="input" value={c.emoji ?? ''} placeholder="ex.: 🔥" onChange={(e) => apply((p) => updateCaption(p, c.id, {emoji: e.target.value || undefined}))} />
        </Row>
        <div onPointerDown={pushHistory}>
          <Row label="Posição vertical">
            <Slider value={c.y ?? 62} min={5} max={85} step={0.5} fmt={(v) => `${v.toFixed(0)}%`} onChange={(v) => live((p) => updateCaption(p, c.id, {y: v, manual: true}))} />
          </Row>
          <Row label="Tamanho">
            <Slider value={c.scale ?? 1} min={0.5} max={1.8} step={0.05} onChange={(v) => live((p) => updateCaption(p, c.id, {scale: v}))} />
          </Row>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!c.hidden} onChange={() => apply((p) => updateCaption(p, c.id, {hidden: !c.hidden}))} /> Ocultar este bloco
        </label>
        {c.manual && (
          <button className="btn-ghost mt-3" onClick={() => apply((p) => updateCaption(p, c.id, {manual: false}), {refresh: true})}>
            Posição automática (fora do rosto)
          </button>
        )}
      </div>
    );
  }

  if (sel?.kind === 'overlay') {
    const o = plan.overlays.find((x) => x.id === sel.id);
    if (!o) return null;
    const set = (patch: Partial<typeof o.props>) => apply((p) => updateOverlay(p, o.id, {props: {...o.props, ...patch}}));
    return (
      <div>
        {header('Gráfico')}
        <Row label="Tipo">
          <select className="input" value={o.kind} onChange={(e) => apply((p) => updateOverlay(p, o.id, {kind: e.target.value as OverlayKind, layout: e.target.value === 'title' ? 'full' : 'card'}), {refresh: true})}>
            {OVERLAYS.map((x) => (
              <option key={x.kind} value={x.kind}>
                {x.label}
              </option>
            ))}
          </select>
        </Row>
        {o.kind === 'stat' && (
          <>
            <Row label="Valor">
              <input className="input" value={o.props.value ?? ''} onChange={(e) => set({value: e.target.value})} />
            </Row>
            <Row label="Rótulo">
              <input className="input" value={o.props.label ?? ''} onChange={(e) => set({label: e.target.value})} />
            </Row>
          </>
        )}
        {(o.kind === 'list' || o.kind === 'chips') && (
          <>
            {o.kind === 'list' && (
              <Row label="Título">
                <input className="input" value={o.props.title ?? ''} onChange={(e) => set({title: e.target.value})} />
              </Row>
            )}
            <Row label="Itens (um por linha)">
              <textarea className="input min-h-24" value={(o.props.items ?? []).join('\n')} onChange={(e) => set({items: e.target.value.split('\n')})} />
            </Row>
          </>
        )}
        {(o.kind === 'title' || o.kind === 'quote' || o.kind === 'strike') && (
          <Row label="Texto">
            <input className="input" value={o.props.text ?? ''} onChange={(e) => set({text: e.target.value})} />
          </Row>
        )}
        {(o.kind === 'title' || o.kind === 'quote') && (
          <Row label={o.kind === 'quote' ? 'Autor' : 'Subtítulo'}>
            <input className="input" value={o.props.label ?? ''} onChange={(e) => set({label: e.target.value})} />
          </Row>
        )}
        {o.kind === 'emoji' && (
          <Row label="Emoji">
            <input className="input text-2xl" value={o.props.emoji ?? ''} onChange={(e) => set({emoji: e.target.value})} />
          </Row>
        )}
        {o.kind !== 'title' && (
          <div onPointerDown={pushHistory}>
            <Row label="Posição vertical">
              <Slider value={o.y ?? 50} min={5} max={85} step={0.5} fmt={(v) => `${v.toFixed(0)}%`} onChange={(v) => live((p) => updateOverlay(p, o.id, {y: v}))} />
            </Row>
          </div>
        )}
        {o.reason && <p className="mt-3 text-xs text-muted">IA: {o.reason}</p>}
      </div>
    );
  }

  if (sel?.kind === 'broll') {
    const b = plan.broll.find((x) => x.id === sel.id);
    if (!b) return null;
    return (
      <div>
        {header('B-roll')}
        <Row label="Template">
          <select className="input" value={b.template} onChange={(e) => apply((p) => updateBroll(p, b.id, {template: e.target.value as typeof b.template}), {refresh: true})}>
            <option value="card">Card (abaixo do queixo)</option>
            <option value="split">Split (mídia em cima, você embaixo)</option>
            <option value="takeover">Tela cheia</option>
            <option value="pip">PiP (você no cantinho)</option>
          </select>
        </Row>
        <BrollPicker b={b} />
        <Row label="Emoji (quando não há mídia)">
          <input className="input" value={b.asset.emoji ?? ''} onChange={(e) => apply((p) => updateBroll(p, b.id, {asset: {...b.asset, emoji: e.target.value}}))} />
        </Row>
        <Row label="Texto sobre o card (opcional)">
          <input className="input" value={b.caption ?? ''} onChange={(e) => apply((p) => updateBroll(p, b.id, {caption: e.target.value || undefined}))} />
        </Row>
        {b.asset.credit && <p className="text-xs text-muted">{b.asset.credit}</p>}
        {b.reason && <p className="mt-2 text-xs text-muted">IA: {b.reason}</p>}
      </div>
    );
  }

  if (sel?.kind === 'zoom') {
    const z = plan.camera.beats.find((x) => x.id === sel.id);
    if (!z) return null;
    return (
      <div onPointerDown={pushHistory}>
        {header('Câmera')}
        <Row label="Movimento">
          <select className="input" value={z.style} onChange={(e) => apply((p) => updateZoom(p, z.id, {style: e.target.value as typeof z.style}))}>
            <option value="punch">Snap zoom (ênfase)</option>
            <option value="push">Slow push</option>
            <option value="shake">Tremor (impacto)</option>
            <option value="static">Parado</option>
          </select>
        </Row>
        <Row label="Escala">
          <Slider value={z.scale} min={1} max={1.6} step={0.01} fmt={(v) => `${v.toFixed(2)}x`} onChange={(v) => live((p) => updateZoom(p, z.id, {scale: v}))} />
        </Row>
        {z.reason && <p className="text-xs text-muted">IA: {z.reason}</p>}
      </div>
    );
  }

  if (sel?.kind === 'sfx') {
    const s = plan.audio.sfx.find((x) => x.id === sel.id);
    if (!s) return null;
    const upd = (patch: Partial<typeof s>) => apply((p) => ({...p, audio: {...p.audio, sfx: p.audio.sfx.map((x) => (x.id === s.id ? {...x, ...patch, auto: false} : x))}}));
    return (
      <div>
        {header('Efeito sonoro')}
        <Row label="Som">
          <select className="input" value={s.kind} onChange={(e) => upd({kind: e.target.value as SfxKind})}>
            {SFX.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Row>
        <Row label="Ganho">
          <Slider value={s.gainDb} min={-18} max={6} step={1} fmt={(v) => `${v} dB`} onChange={(v) => upd({gainDb: v})} />
        </Row>
        <button className="btn-ghost" onClick={() => new Audio(`/sfx/${s.kind}.wav`).play()}>
          ▶ Ouvir
        </button>
      </div>
    );
  }

  if (sel?.kind === 'transition') {
    const tr = plan.transitions.find((x) => x.id === sel.id);
    if (!tr) return null;
    return (
      <div onPointerDown={pushHistory}>
        {header('Transição')}
        <Row label="Tipo">
          <select className="input" value={tr.kind} onChange={(e) => apply((p) => ({...p, transitions: p.transitions.map((x) => (x.id === tr.id ? {...x, kind: e.target.value as TransitionKind} : x))}))}>
            {TRANSITIONS.filter((k) => k !== 'cut').map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Row>
        <Row label="Duração">
          <Slider value={tr.duration} min={0.1} max={0.8} step={0.02} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => live((p) => ({...p, transitions: p.transitions.map((x) => (x.id === tr.id ? {...x, duration: v} : x))}))} />
        </Row>
      </div>
    );
  }

  return <ProjectPanel t={t} onReplan={onReplan} />;
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const a = arr.slice();
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

function BrollPicker({b}: {b: EditPlan['broll'][number]}) {
  const {apply} = useEditor.getState();
  const projectId = useEditor((s) => s.projectId);
  const media = useEditor((s) => s.media);
  const [q, setQ] = useState(b.asset.query ?? '');
  const [results, setResults] = useState<{src: string; url: string; kind: string; origin: string; credit?: string}[] | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true);
    try {
      const orient = b.template === 'split' ? 'landscape' : b.template === 'card' ? 'square' : 'portrait';
      const r = await api<{results: NonNullable<typeof results>}>(`/api/projects/${projectId}/broll?q=${encodeURIComponent(q)}&orientation=${orient}`);
      setResults(r.results);
    } finally {
      setBusy(false);
    }
  };
  const preview = b.asset.src ? media[b.asset.src] ?? b.asset.src : null;
  return (
    <>
      {preview && (
        <div className="mb-3 overflow-hidden rounded-lg border border-line bg-black">
          {b.asset.kind === 'video' ? <video src={preview} muted autoPlay loop className="max-h-40 w-full object-contain" /> : <img src={preview} alt="" className="max-h-40 w-full object-contain" />}
        </div>
      )}
      <Row label="Buscar mídia (inglês funciona melhor)">
        <div className="flex gap-2">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
          <button className="btn-ghost" onClick={search} disabled={busy || !q}>
            {busy ? '…' : 'Buscar'}
          </button>
        </div>
      </Row>
      {b.asset.alternatives.length > 1 && (
        <button
          className="btn-ghost mb-3"
          onClick={() => {
            const i = b.asset.alternatives.indexOf(b.asset.src ?? '');
            const next = b.asset.alternatives[(i + 1) % b.asset.alternatives.length];
            apply((p) => updateBroll(p, b.id, {asset: {...b.asset, src: next, kind: /\.(jpe?g|png|webp)(\?|$)/i.test(next) ? 'image' : 'video'}}));
          }}
        >
          ↻ Trocar pela próxima alternativa ({b.asset.alternatives.length})
        </button>
      )}
      {results && (
        <div className="mb-3 grid max-h-64 grid-cols-3 gap-1 overflow-y-auto">
          {results.length === 0 && <p className="col-span-3 text-xs text-muted">Nada encontrado (configure PEXELS_API_KEY ou suba arquivos na biblioteca).</p>}
          {results.map((r) => (
            <button
              key={r.src}
              className="aspect-square overflow-hidden rounded border border-line hover:border-brand"
              title={r.credit}
              onClick={() => {
                apply((p) => updateBroll(p, b.id, {template: b.template === 'card' && r.kind === 'video' ? 'split' : b.template, asset: {...b.asset, kind: r.kind as 'video' | 'image', src: r.src, query: q, origin: r.origin as 'own' | 'pexels', credit: r.credit, alternatives: results.map((x) => x.src)}}));
                useEditor.getState().setMedia({...useEditor.getState().media, [r.src]: r.url});
              }}
            >
              {r.kind === 'video' ? <video src={r.url} muted className="h-full w-full object-cover" /> : <img src={r.url} alt="" className="h-full w-full object-cover" />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ProjectPanel({t, onReplan}: {t: number; onReplan: () => void}) {
  const plan = useEditor((s) => s.plan)!;
  const projectId = useEditor((s) => s.projectId);
  const variant = useEditor((s) => s.variant);
  const {apply, select, pushHistory} = useEditor.getState();
  const [busy, setBusy] = useState<string | null>(null);
  const live = (fn: (p: EditPlan) => EditPlan) => apply(fn, {history: false});
  const add = (r: {plan: EditPlan; id?: string}, kind: 'overlay' | 'broll' | 'zoom' | 'sfx') => {
    apply(() => r.plan, {refresh: true});
    if (r.id) select({kind, id: r.id});
  };
  const action = async (name: string, body: Record<string, unknown>) => {
    setBusy(name);
    try {
      const r = await api<{plan: EditPlan}>(`/api/projects/${projectId}/plans/${variant}/actions`, {method: 'POST', json: {plan, ...body}});
      apply(() => r.plan);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h3 className="mb-3 font-bold">Adicionar na agulha ({t.toFixed(1)}s)</h3>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {OVERLAYS.map((o) => (
          <button key={o.kind} className="btn-ghost text-xs" onClick={() => add(addOverlay(plan, t, o.kind), 'overlay')}>
            + {o.label}
          </button>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        <button className="btn-ghost text-xs" onClick={() => add(addBroll(plan, t), 'broll')}>
          + B-roll
        </button>
        <button className="btn-ghost text-xs" onClick={() => add(addZoom(plan, t, 'punch'), 'zoom')}>
          + Snap zoom
        </button>
        <button className="btn-ghost text-xs" onClick={() => add(addZoom(plan, t, 'push'), 'zoom')}>
          + Slow push
        </button>
        <button className="btn-ghost text-xs" onClick={() => add(addSfx(plan, t, 'whoosh'), 'sfx')}>
          + Som
        </button>
      </div>

      <h3 className="mb-3 font-bold">Vídeo</h3>
      <Row label="Estilo">
        <select className="input" value={plan.style} disabled={!!busy} onChange={(e) => action('estilo', {action: 'restyle', style: e.target.value})}>
          {STYLE_LIST.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Legenda">
        <select className="input" value={plan.captions.preset} onChange={(e) => apply((p) => ({...p, captions: {...p.captions, preset: e.target.value as typeof p.captions.preset}}))}>
          <option value="bold-pop">Bold pop (caixa alta, palavra amarela)</option>
          <option value="karaoke">Karaokê</option>
          <option value="pill">Pílula escura</option>
          <option value="editorial">Editorial (minúsculas)</option>
          <option value="clean">Clean</option>
        </select>
      </Row>
      <Row label="Plataforma (área segura)">
        <select className="input" value={plan.platform} onChange={(e) => apply((p) => ({...p, platform: e.target.value as typeof p.platform}), {refresh: true})}>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="shorts">Shorts</option>
          <option value="all">Todas</option>
        </select>
      </Row>
      <Row label="Gancho (2 primeiros segundos — use | para quebrar a linha)">
        <input className="input" value={plan.hook?.title ?? ''} placeholder="ex.: ISSO MUDA|TUDO" onChange={(e) => apply((p) => ({...p, hook: e.target.value ? {title: e.target.value, until: p.hook?.until ?? 2} : undefined}))} />
      </Row>
      <Row label="End card (CTA no final)">
        <input className="input" value={plan.outro?.title ?? ''} placeholder="ex.: SIGA PARA MAIS" onChange={(e) => apply((p) => ({...p, outro: e.target.value ? {title: e.target.value, duration: p.outro?.duration ?? 1.6} : undefined}))} />
      </Row>
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={plan.progressBar} onChange={() => apply((p) => ({...p, progressBar: !p.progressBar}))} /> Barra de progresso
        </label>
      </div>
      <Row label="Cor (look)">
        <select className="input" value={plan.grade.look} onChange={(e) => apply((p) => ({...p, grade: {...p.grade, look: e.target.value as typeof p.grade.look}}))}>
          <option value="punchy">Vibrante</option>
          <option value="clean">Limpo</option>
          <option value="film">Filme</option>
          <option value="none">Original</option>
        </select>
      </Row>
      <div onPointerDown={pushHistory}>
        <Row label="Iluminar o rosto">
          <Slider value={plan.grade.faceLift} min={0} max={1} step={0.05} onChange={(v) => live((p) => ({...p, grade: {...p.grade, faceLift: v}}))} />
        </Row>
        <Row label="Volume dos efeitos">
          <Slider value={plan.audio.sfxVolume} min={0} max={1.5} step={0.05} onChange={(v) => live((p) => ({...p, audio: {...p.audio, sfxVolume: v}}))} />
        </Row>
        <Row label="Música">
          <select
            className="input mb-2"
            value={plan.audio.music?.src ?? 'none'}
            onChange={(e) =>
              apply((p) => ({...p, audio: {...p.audio, music: e.target.value === 'none' ? undefined : {src: e.target.value, volume: p.audio.music?.volume ?? 0.16, startSec: 0, fadeOutSec: 1.5, duck: true, duckLevel: 0.3}}}))
            }
          >
            <option value="none">Sem música</option>
            <option value="builtin:music/upbeat.mp3">Animada (sintetizada)</option>
            <option value="builtin:music/calm.mp3">Calma (sintetizada)</option>
            {plan.audio.music && !plan.audio.music.src.startsWith('builtin:') && <option value={plan.audio.music.src}>Minha música</option>}
          </select>
          {plan.audio.music && (
            <>
              <Slider value={plan.audio.music.volume} min={0} max={0.6} step={0.01} onChange={(v) => live((p) => ({...p, audio: {...p.audio, music: {...p.audio.music!, volume: v}}}))} />
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={plan.audio.music.duck} onChange={() => apply((p) => ({...p, audio: {...p.audio, music: {...p.audio.music!, duck: !p.audio.music!.duck}}}))} /> Abaixar quando eu falo (ducking)
              </label>
            </>
          )}
        </Row>
      </div>

      <h3 className="mb-3 mt-6 font-bold">Refazer com IA / regras</h3>
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" id="aggr" defaultValue="medium">
          <option value="gentle">Cortes suaves</option>
          <option value="medium">Cortes médios</option>
          <option value="tight">Cortes agressivos</option>
        </select>
        <button className="btn-ghost" disabled={!!busy} onClick={() => action('cortes', {action: 'autocut', level: (document.getElementById('aggr') as HTMLSelectElement).value})}>
          Refazer cortes
        </button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => action('legendas', {action: 'captions'})}>
          Regerar legendas
        </button>
        <button className="btn-primary" disabled={!!busy} onClick={onReplan}>
          Replanejar zoom, B-roll e gráficos (IA)
        </button>
      </div>
      {busy && <p className="mt-2 text-xs text-muted">Aplicando: {busy}…</p>}
      {plan.meta.notes.length > 0 && (
        <div className="mt-5 rounded-lg bg-panel2 p-3 text-xs text-muted">
          <div className="mb-1 font-semibold text-white">Notas da IA ({plan.meta.director} · {plan.meta.model})</div>
          {plan.meta.notes.map((n, i) => (
            <p key={i}>• {n}</p>
          ))}
        </div>
      )}
    </div>
  );
}
