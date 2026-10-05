// Módulo 07 — motion graphics que "ilustram a fala", sincronizados na palavra.
// stat (número com contagem), list, chips, title (slam), quote, emoji, strike.
// Reescritos em React a partir de kamgasimo/components (HTML/GSAP),
// talking-head-reel/overlays.tsx e motion-script/motion-components (MIT).
import React from 'react';
import {Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Overlay} from '../../lib/plan/schema';
import {clamp, envelope, pop} from '../anim';
import {fontStack} from '../fonts';
import {Selectable, useReel} from '../context';
import {Card, useK} from './kit';
import {Behind, Chart, Compare, Confetti, LowerThird, Steps, Sticker, Terminal} from './Extra';

export type TimedOverlay = {o: Overlay; t0: number; t1: number};

/** contagem para números ("87%" conta de 0 a 87) */
function countUp(value: string, f: number): string {
  const m = value.match(/^(\D*?)(\d+(?:[.,]\d+)?)(.*)$/);
  if (!m) return value;
  const n = parseFloat(m[2].replace(',', '.'));
  if (!Number.isFinite(n) || n === 0) return value;
  const decimals = m[2].includes('.') || m[2].includes(',') ? m[2].split(/[.,]/)[1].length : 0;
  const cur = (n * f).toFixed(decimals);
  return `${m[1]}${m[2].includes(',') ? cur.replace('.', ',') : cur}${m[3]}`;
}

const Stat: React.FC<{o: Overlay; life: number}> = ({o, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const f = interpolate(frame, [2, Math.round(fps * 0.6)], [0, 1], {...clamp, easing: (x) => 1 - Math.pow(1 - x, 3)});
  return (
    <Card life={life} y={o.y ?? 50}>
      <div style={{textAlign: 'center', fontFamily: fontStack(style.fonts.display)}}>
        <div style={{fontSize: 150 * k, fontWeight: style.fonts.displayWeight, color: style.palette.key, lineHeight: 1, letterSpacing: -3 * k}}>{countUp(o.props.value ?? '', f)}</div>
        {o.props.label && <div style={{fontSize: 46 * k, fontWeight: 700, marginTop: 14 * k, fontFamily: fontStack(style.fonts.body), opacity: interpolate(frame, [8, 16], [0, 1], clamp)}}>{o.props.label}</div>}
      </div>
    </Card>
  );
};

const List: React.FC<{o: Overlay; life: number}> = ({o, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const items = o.props.items ?? [];
  const step = Math.max(4, Math.min(Math.round(fps * 0.45), Math.floor((life * 0.6) / Math.max(1, items.length))));
  return (
    <Card life={life} y={o.y ?? 46}>
      {o.props.title && <div style={{fontFamily: fontStack(style.fonts.display), fontWeight: style.fonts.displayWeight, fontSize: 50 * k, marginBottom: 18 * k, color: style.palette.key}}>{o.props.title}</div>}
      {items.map((it, i) => {
        const p = pop(frame, fps, 4 + i * step);
        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 22 * k, margin: `${12 * k}px 0`, opacity: Math.min(1, p), transform: `translateX(${(1 - p) * -40 * k}px)`}}>
            <div style={{width: 54 * k, height: 54 * k, borderRadius: 16 * k, background: style.palette.accent, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 30 * k, fontFamily: fontStack(style.fonts.display), flexShrink: 0}}>{i + 1}</div>
            <div style={{fontFamily: fontStack(style.fonts.body), fontWeight: 700, fontSize: 48 * k}}>{it}</div>
          </div>
        );
      })}
    </Card>
  );
};

const Chips: React.FC<{o: Overlay; life: number}> = ({o, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const e = envelope(frame, fps, life);
  const items = o.props.items ?? [];
  const colors = [style.palette.accent, style.palette.key, '#22D3EE', '#F472B6', '#34D399'];
  return (
    <div style={{position: 'absolute', top: `${o.y ?? 52}%`, left: 60 * k, right: 60 * k, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 20 * k, opacity: e.exit}}>
      {items.map((it, i) => {
        const p = pop(frame, fps, 2 + i * Math.round(fps * 0.22));
        const c = colors[i % colors.length];
        return (
          <div key={i} style={{padding: `${18 * k}px ${34 * k}px`, borderRadius: 999, background: c, color: c === style.palette.key ? '#111' : '#fff', fontFamily: fontStack(style.fonts.display), fontWeight: 800, fontSize: 46 * k, transform: `scale(${p}) rotate(${(i % 2 ? 3 : -3) * p}deg)`, boxShadow: '0 14px 30px rgba(0,0,0,0.35)'}}>
            {it}
          </div>
        );
      })}
    </div>
  );
};

const Title: React.FC<{o: Overlay; life: number}> = ({o, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const e = envelope(frame, fps, life);
  const slam = interpolate(frame, [0, 6], [1.6, 1], {...clamp, easing: (x) => 1 - Math.pow(1 - x, 4)});
  return (
    <>
      <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 40%, rgba(0,0,0,0.25), rgba(0,0,0,0.7))', opacity: e.exit * Math.min(1, frame / 4)}} />
      <div style={{position: 'absolute', top: '30%', left: 70 * k, right: 70 * k, textAlign: 'center', opacity: e.exit * Math.min(1, frame / 3), transform: `scale(${slam})`}}>
        <div style={{fontFamily: fontStack(style.fonts.display), fontWeight: style.fonts.displayWeight, fontSize: 124 * k, lineHeight: 1.0, color: '#fff', textTransform: 'uppercase', letterSpacing: -2 * k, textShadow: '0 10px 40px rgba(0,0,0,0.6)'}}>{o.props.text}</div>
        {o.props.label && <div style={{marginTop: 24 * k, fontFamily: fontStack(style.fonts.body), fontWeight: 700, fontSize: 44 * k, color: style.palette.key}}>{o.props.label}</div>}
      </div>
    </>
  );
};

const Quote: React.FC<{o: Overlay; life: number}> = ({o, life}) => {
  const {style} = useReel();
  const k = useK();
  return (
    <Card life={life} y={o.y ?? 46} light>
      <div style={{fontFamily: 'Georgia, serif', fontSize: 120 * k, lineHeight: 0.6, color: style.palette.accent}}>“</div>
      <div style={{fontFamily: fontStack(style.fonts.body), fontWeight: 700, fontSize: 52 * k, lineHeight: 1.2}}>{o.props.text}</div>
      {o.props.label && <div style={{marginTop: 18 * k, fontFamily: fontStack(style.fonts.body), fontSize: 36 * k, opacity: 0.6}}>— {o.props.label}</div>}
    </Card>
  );
};

const Strike: React.FC<{o: Overlay; life: number}> = ({o, life}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const {style} = useReel();
  const e = envelope(frame, fps, life);
  const line = interpolate(frame, [Math.round(fps * 0.35), Math.round(fps * 0.6)], [0, 1], clamp);
  return (
    <div style={{position: 'absolute', top: `${o.y ?? 50}%`, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: e.alpha, transform: `scale(${0.9 + 0.1 * e.enter})`}}>
      <div style={{position: 'relative', padding: `${16 * k}px ${40 * k}px`, background: 'rgba(255,255,255,0.95)', borderRadius: 22 * k, transform: 'rotate(-3deg)', boxShadow: '0 20px 50px rgba(0,0,0,0.35)'}}>
        <div style={{fontFamily: fontStack(style.fonts.display), fontWeight: style.fonts.displayWeight, fontSize: 84 * k, color: '#111', textTransform: 'uppercase'}}>{o.props.text}</div>
        <div style={{position: 'absolute', left: 24 * k, top: '52%', height: 12 * k, width: `calc(${line * 100}% - ${48 * k * line}px)`, background: '#EF4444', borderRadius: 8 * k, transform: 'rotate(-4deg)'}} />
      </div>
    </div>
  );
};

const BigEmoji: React.FC<{o: Overlay; life: number}> = ({o, life}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const e = envelope(frame, fps, life);
  const p = pop(frame, fps);
  const bob = Math.sin(frame / 6) * 8 * k;
  return (
    <div style={{position: 'absolute', top: `${o.y ?? 20}%`, right: 120 * k, fontSize: 220 * k, opacity: e.exit, transform: `translateY(${bob}px) scale(${p}) rotate(${(1 - p) * 30}deg)`, filter: 'drop-shadow(0 18px 30px rgba(0,0,0,0.45))'}}>
      {o.props.emoji ?? '🔥'}
    </div>
  );
};

/** palavra-chave da fala, grande e animada (estilo TikTok): entra "batendo" e sai rápido */
const Keyword: React.FC<{o: Overlay; life: number}> = ({o, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const e = envelope(frame, fps, life, 5);
  const text = (o.props.text ?? '').toUpperCase();
  // duas variações que se alternam pelo id: caixa colorida ou texto branco com contorno
  const boxed = (o.id.charCodeAt(o.id.length - 1) ?? 0) % 2 === 0;
  const size = (text.length > 14 ? 92 : text.length > 9 ? 112 : 136) * k;
  const slam = interpolate(frame, [0, 5], [1.45, 1], {...clamp, easing: (x) => 1 - Math.pow(1 - x, 4)});
  const tilt = boxed ? -3 : 2;
  return (
    <div style={{position: 'absolute', top: `${o.y ?? 24}%`, left: 60 * k, right: 60 * k, display: 'flex', justifyContent: 'center', opacity: e.exit * Math.min(1, frame / 2), transform: `scale(${slam}) rotate(${tilt}deg)`}}>
      <div
        style={{
          fontFamily: fontStack(style.fonts.display),
          fontWeight: style.fonts.displayWeight,
          fontSize: size,
          lineHeight: 1.02,
          letterSpacing: -2 * k,
          textAlign: 'center',
          padding: boxed ? `${10 * k}px ${30 * k}px ${14 * k}px` : 0,
          borderRadius: 18 * k,
          background: boxed ? style.palette.key : undefined,
          color: boxed ? '#111' : '#fff',
          WebkitTextStroke: boxed ? undefined : `${Math.round(size / 16)}px #000`,
          paintOrder: 'stroke fill',
          textShadow: boxed ? undefined : '0 8px 30px rgba(0,0,0,0.55)',
          boxShadow: boxed ? '0 18px 40px rgba(0,0,0,0.4)' : undefined,
        }}
      >
        {text}
      </div>
    </div>
  );
};

const KIND: Record<Overlay['kind'], React.FC<{o: Overlay; life: number}>> = {
  stat: Stat, list: List, chips: Chips, title: Title, quote: Quote, strike: Strike, emoji: BigEmoji,
  compare: Compare, steps: Steps, chart: Chart, lowerthird: LowerThird, confetti: Confetti, ui: Terminal, sticker: Sticker, behind: Behind, keyword: Keyword,
};

export const OverlaysLayer: React.FC<{items: TimedOverlay[]}> = ({items}) => {
  const {fps} = useVideoConfig();
  return (
    <>
      {items.map(({o, t0, t1}) => {
        const from = Math.round(t0 * fps);
        const dur = Math.max(2, Math.round((t1 - t0) * fps));
        const C = KIND[o.kind] ?? Stat;
        return (
          <Sequence key={o.id} from={from} durationInFrames={dur} layout="none" name={`gráfico: ${o.kind}`}>
            <Selectable id={o.id} style={{position: 'absolute', inset: 0}}>
              <C o={o} life={dur} />
            </Selectable>
          </Sequence>
        );
      })}
    </>
  );
};
