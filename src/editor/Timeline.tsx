'use client';
// Timeline com faixas (vídeo, legendas, gráficos, B-roll, câmera, sons): clicar
// seleciona e posiciona a agulha; arrastar move; arrastar as bordas apara/estica;
// arrastar um clipe de vídeo reordena. Inspirado em autobroll/editor/Timeline.tsx (MIT).
import {useMemo, useRef, useState} from 'react';
import type {EditPlan} from '../lib/plan/schema';
import {useEditor} from './store';
import {moveClip, retimeItem, splitAt, timelineModel, trimClip, type ItemKind, type TimelineItem} from './ops';
import {Icon} from '../components/ui/Icon';

const timecode = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

const COLORS: Record<ItemKind, string> = {
  clip: 'bg-sky-600/80 border-sky-300',
  caption: 'bg-amber-500/80 border-amber-200 text-black',
  overlay: 'bg-fuchsia-600/80 border-fuchsia-300',
  broll: 'bg-emerald-600/80 border-emerald-300',
  zoom: 'bg-violet-600/70 border-violet-300',
  sfx: 'bg-rose-600/80 border-rose-300',
  transition: 'bg-white/70 border-white',
};

type Drag = {mode: 'move' | 'in' | 'out' | 'reorder'; item: TimelineItem; x0: number; base: EditPlan; dx: number};

export function Timeline({onSeek, onTogglePlay}: {onSeek: (frame: number) => void; onTogglePlay?: () => void}) {
  const plan = useEditor((s) => s.plan)!;
  const frame = useEditor((s) => s.frame);
  const selected = useEditor((s) => s.selected);
  const px = useEditor((s) => s.pxPerSec);
  const {apply, pushHistory, refresh, select, setPxPerSec} = useEditor.getState();
  const model = useMemo(() => timelineModel(plan), [plan]);
  const fps = plan.format.fps;
  const total = model.duration + (plan.outro?.duration ?? 0);
  const width = Math.max(600, total * px + 200);
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + el.scrollLeft - 96) / px);
  };

  const begin = (e: React.PointerEvent, item: TimelineItem, mode: Drag['mode']) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    select({kind: item.kind, id: item.id});
    if (item.kind !== 'clip' || mode !== 'move') pushHistory();
    setDrag({mode: item.kind === 'clip' && mode === 'move' ? 'reorder' : mode, item, x0: e.clientX, base: plan, dx: 0});
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const dt = (e.clientX - drag.x0) / px;
    const {item, base} = drag;
    if (drag.mode === 'reorder') {
      setDrag({...drag, dx: e.clientX - drag.x0});
      return;
    }
    if (item.kind === 'clip') {
      apply(() => trimClip(base, item.id, drag.mode === 'in' ? 'in' : 'out', dt), {history: false});
      return;
    }
    const t0 = drag.mode === 'out' ? item.t0 : item.t0 + dt;
    const t1 = drag.mode === 'in' ? item.t1 : item.t1 + dt;
    apply(() => retimeItem(base, item.kind, item.id, Math.min(t0, t1 - 0.1), t1), {history: false});
  };
  const end = (e: React.PointerEvent) => {
    if (!drag) return;
    const {item} = drag;
    if (drag.mode === 'reorder') {
      if (Math.abs(drag.dx) > 6) {
        const t = timeAt(e.clientX);
        const clips = model.tracks[0].items.filter((c) => c.id !== item.id);
        const idx = clips.filter((c) => (c.t0 + c.t1) / 2 < t).length;
        apply((p) => moveClip(p, item.id, idx), {refresh: true});
      } else onSeek(Math.round(item.t0 * fps));
    } else if (item.kind === 'clip' || item.kind === 'caption') refresh();
    else if (Math.abs(e.clientX - drag.x0) < 3) onSeek(Math.round(item.t0 * fps));
    setDrag(null);
  };

  const ticks = useMemo(() => {
    const step = px > 120 ? 0.5 : px > 50 ? 1 : px > 25 ? 2 : 5;
    const out: number[] = [];
    for (let t = 0; t <= total + step; t += step) out.push(+t.toFixed(2));
    return out;
  }, [px, total]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-2 text-xs text-muted">
        {onTogglePlay && (
          <button className="btn-icon h-7 w-7" onClick={onTogglePlay} title="Tocar / pausar (Espaço)">
            <Icon name="play" size={13} />
          </button>
        )}
        <span className="rounded-md bg-panel2 px-2 py-1 font-mono text-[11px] tabular-nums">
          <span className="text-text">{timecode(frame / fps)}</span>
          <span className="text-subtle"> / {timecode(total)}</span>
        </span>
        <button className="btn-icon ml-1 h-7 w-7" title="Dividir na agulha (S)" onClick={() => apply((p) => splitAt(p, frame / fps).plan, {refresh: true})}>
          <Icon name="scissors" size={14} />
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button className="btn-icon h-7 w-7" title="Menos zoom" onClick={() => setPxPerSec(Math.max(15, Math.round(px / 1.4)))}>
            <Icon name="zoomOut" size={14} />
          </button>
          <input type="range" className="w-28" min={15} max={400} value={px} onChange={(e) => setPxPerSec(Number(e.target.value))} aria-label="Zoom da timeline" />
          <button className="btn-icon h-7 w-7" title="Mais zoom" onClick={() => setPxPerSec(Math.min(400, Math.round(px * 1.4)))}>
            <Icon name="zoomIn" size={14} />
          </button>
        </div>
      </div>
      <div ref={scroller} className="relative flex-1 select-none overflow-auto" onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
        <div style={{width}} className="relative">
          {/* régua */}
          <div className="sticky top-0 z-20 flex h-6 cursor-pointer border-b border-line bg-panel" onPointerDown={(e) => onSeek(Math.round(timeAt(e.clientX) * fps))}>
            <div className="w-24 shrink-0" />
            <div className="relative flex-1">
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-line/70 pl-1 text-[10px] text-muted" style={{left: t * px}}>
                  {Number.isInteger(t) ? `${t}s` : ''}
                </div>
              ))}
            </div>
          </div>
          {model.tracks.map((tr) => (
            <div key={tr.kind} className="flex h-11 border-b border-line/60 even:bg-white/[0.012]">
              <div className="sticky left-0 z-10 flex w-24 shrink-0 items-center gap-2 border-r border-line bg-panel px-2.5 text-[11px] font-semibold text-muted">
                <span className={`h-2 w-2 shrink-0 rounded-full border ${COLORS[tr.kind as ItemKind] ?? ''}`} />
                <span className="truncate">{tr.label}</span>
              </div>
              <div className="relative flex-1" onPointerDown={(e) => {
                select(null);
                onSeek(Math.round(timeAt(e.clientX) * fps));
              }}>
                {tr.items.map((it) => {
                  const sel = selected?.id === it.id;
                  const shift = drag?.mode === 'reorder' && drag.item.id === it.id ? drag.dx : 0;
                  return (
                    <div
                      key={it.id}
                      onPointerDown={(e) => begin(e, it, 'move')}
                      className={`absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md border px-1.5 text-[11px] leading-[34px] whitespace-nowrap ${COLORS[it.kind]} ${sel ? 'ring-2 ring-white z-10' : 'border-opacity-30'}`}
                      style={{left: it.t0 * px + shift, width: Math.max(4, (it.t1 - it.t0) * px), opacity: shift ? 0.7 : 1}}
                      title={it.label}
                    >
                      {it.kind !== 'sfx' && <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/30 hover:bg-white" onPointerDown={(e) => begin(e, it, 'in')} />}
                      <span className="pointer-events-none">{it.label}</span>
                      {it.sub && <span className="pointer-events-none ml-1 opacity-70">· {it.sub}</span>}
                      {it.kind !== 'sfx' && <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/30 hover:bg-white" onPointerDown={(e) => begin(e, it, 'out')} />}
                    </div>
                  );
                })}
                {tr.kind === 'clip' &&
                  plan.transitions.map((t) => {
                    const c = tr.items.find((x) => x.id === t.clipId);
                    if (!c) return null;
                    return (
                      <div
                        key={t.id}
                        title={`transição: ${t.kind}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          select({kind: 'transition', id: t.id});
                        }}
                        className={`absolute top-2.5 z-10 h-6 w-6 -translate-x-1/2 rotate-45 cursor-pointer rounded-sm border-2 ${selected?.id === t.id ? 'border-white bg-key' : 'border-black/50 bg-white/80'}`}
                        style={{left: c.t0 * px}}
                      />
                    );
                  })}
              </div>
            </div>
          ))}
          {/* agulha */}
          <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-key shadow-[0_0_8px_rgb(255_212_0/0.6)]" style={{left: 96 + (frame / fps) * px}}>
            <div className="absolute -top-0 -left-[5px] h-3 w-3 rotate-45 rounded-[2px] bg-key" />
          </div>
        </div>
      </div>
    </div>
  );
}
