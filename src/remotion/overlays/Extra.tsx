// Fase 2 — biblioteca completa de motion graphics, reescrita em React a partir de
// kamgasimo/components (compare, steps, chart, lowerthird, confetti, ui, sticker)
// e talking-head-reel/overlays.tsx (MIT). Fase 3 — texto atrás da pessoa.
import React from 'react';
import {Img, interpolate, random, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Overlay} from '../../lib/plan/schema';
import {clamp, envelope, pop} from '../anim';
import {fontStack} from '../fonts';
import {useReel} from '../context';
import {Card, useK} from './kit';

type P = {o: Overlay; life: number};

/** "Título|valor" → [título, valor] */
const split2 = (s: string) => {
  const [a, ...b] = s.split('|');
  return [a.trim(), b.join('|').trim()] as const;
};

/** comparação: dois cartões lado a lado, o vencedor (o segundo, ou o marcado com *) destacado */
export const Compare: React.FC<P> = ({o, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const items = (o.props.items ?? []).slice(0, 2);
  const winner = Math.max(0, items.findIndex((x) => x.includes('*')));
  const w = winner === 0 && !items[0]?.includes('*') ? 1 : winner;
  return (
    <Card life={life} y={o.y ?? 48} width={940}>
      {o.props.title && <div style={{textAlign: 'center', fontFamily: fontStack(style.fonts.display), fontWeight: style.fonts.displayWeight, fontSize: 44 * k, marginBottom: 20 * k}}>{o.props.title}</div>}
      <div style={{display: 'flex', gap: 24 * k, alignItems: 'stretch'}}>
        {items.map((it, i) => {
          const [title, value] = split2(it.replace('*', ''));
          const p = pop(frame, fps, 3 + i * 8);
          const win = i === w;
          return (
            <div key={i} style={{flex: 1, borderRadius: 30 * k, padding: 26 * k, textAlign: 'center', background: win ? style.palette.accent : 'rgba(255,255,255,0.08)', border: win ? `4px solid ${style.palette.key}` : '2px solid rgba(255,255,255,0.15)', transform: `scale(${p * (win ? 1.04 : 0.97)})`, opacity: Math.min(1, p)}}>
              <div style={{fontFamily: fontStack(style.fonts.body), fontWeight: 700, fontSize: 36 * k, opacity: 0.85}}>{title}</div>
              {value && <div style={{fontFamily: fontStack(style.fonts.display), fontWeight: style.fonts.displayWeight, fontSize: 76 * k, color: win ? style.palette.key : '#fff', marginTop: 8 * k}}>{value}</div>}
            </div>
          );
        })}
      </div>
      {items.length === 2 && <div style={{position: 'absolute', left: '50%', top: '55%', transform: `translate(-50%,-50%) scale(${pop(frame, fps, 10)})`, width: 70 * k, height: 70 * k, borderRadius: 99, background: '#fff', color: '#111', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 28 * k, fontFamily: fontStack(style.fonts.display)}}>VS</div>}
    </Card>
  );
};

/** passos: 1 → 2 → 3, cada um entra na sua vez com a seta desenhando */
export const Steps: React.FC<P> = ({o, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const items = (o.props.items ?? []).slice(0, 4);
  const step = Math.max(5, Math.floor((life * 0.65) / Math.max(1, items.length)));
  return (
    <Card life={life} y={o.y ?? 46}>
      {o.props.title && <div style={{fontFamily: fontStack(style.fonts.display), fontWeight: style.fonts.displayWeight, fontSize: 44 * k, marginBottom: 14 * k, color: style.palette.key}}>{o.props.title}</div>}
      {items.map((it, i) => {
        const p = pop(frame, fps, 3 + i * step);
        const line = interpolate(frame, [3 + i * step + 4, 3 + (i + 1) * step], [0, 1], clamp);
        return (
          <div key={i}>
            <div style={{display: 'flex', alignItems: 'center', gap: 22 * k, opacity: Math.min(1, p), transform: `translateY(${(1 - p) * 20 * k}px)`}}>
              <div style={{width: 64 * k, height: 64 * k, borderRadius: 99, border: `4px solid ${style.palette.key}`, display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 32 * k, fontFamily: fontStack(style.fonts.display), color: style.palette.key, flexShrink: 0}}>{i + 1}</div>
              <div style={{fontFamily: fontStack(style.fonts.body), fontWeight: 700, fontSize: 46 * k}}>{it}</div>
            </div>
            {i < items.length - 1 && <div style={{marginLeft: 30 * k, width: 4 * k, height: 34 * k * line, background: style.palette.key, opacity: 0.7}} />}
          </div>
        );
      })}
    </Card>
  );
};

/** gráfico de barras: itens "rótulo:valor"; as barras crescem uma após a outra */
export const Chart: React.FC<P> = ({o, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const data = (o.props.items ?? []).slice(0, 5).map((it) => {
    const [label, v] = it.split(':');
    return {label: label.trim(), value: Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')) || 0, raw: (v ?? '').trim()};
  });
  const max = Math.max(1, ...data.map((d) => d.value));
  const H = 300 * k;
  return (
    <Card life={life} y={o.y ?? 44}>
      {o.props.title && <div style={{fontFamily: fontStack(style.fonts.display), fontWeight: style.fonts.displayWeight, fontSize: 44 * k, marginBottom: 16 * k}}>{o.props.title}</div>}
      <div style={{display: 'flex', alignItems: 'flex-end', gap: 22 * k, height: H + 70 * k}}>
        {data.map((d, i) => {
          const g = interpolate(frame, [4 + i * 5, 4 + i * 5 + Math.round(fps * 0.5)], [0, 1], {...clamp, easing: (x) => 1 - Math.pow(1 - x, 3)});
          const last = i === data.length - 1;
          return (
            <div key={i} style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%'}}>
              <div style={{fontFamily: fontStack(style.fonts.display), fontWeight: 800, fontSize: 34 * k, opacity: g, color: last ? style.palette.key : '#fff'}}>{d.raw}</div>
              <div style={{width: '100%', height: (d.value / max) * H * g, borderRadius: `${14 * k}px ${14 * k}px 0 0`, background: last ? style.palette.key : style.palette.accent, marginTop: 6 * k}} />
              <div style={{fontFamily: fontStack(style.fonts.body), fontSize: 28 * k, marginTop: 10 * k, opacity: 0.85, textAlign: 'center'}}>{d.label}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

/** lower third: nome + função entrando pela esquerda */
export const LowerThird: React.FC<P> = ({o, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const e = envelope(frame, fps, life);
  const bar = interpolate(frame, [0, 8], [0, 1], clamp);
  return (
    <div style={{position: 'absolute', left: 70 * k, top: `${o.y ?? 66}%`, opacity: e.exit, transform: `translateX(${(1 - e.enter) * -80 * k}px)`}}>
      <div style={{display: 'flex', alignItems: 'stretch', gap: 18 * k}}>
        <div style={{width: 10 * k, background: style.palette.key, transform: `scaleY(${bar})`, borderRadius: 6 * k}} />
        <div>
          <div style={{background: '#fff', color: '#111', padding: `${8 * k}px ${22 * k}px`, fontFamily: fontStack(style.fonts.display), fontWeight: style.fonts.displayWeight, fontSize: 56 * k, borderRadius: 10 * k}}>{o.props.text}</div>
          {o.props.label && <div style={{marginTop: 8 * k, background: style.palette.accent, color: '#fff', padding: `${6 * k}px ${18 * k}px`, fontFamily: fontStack(style.fonts.body), fontWeight: 700, fontSize: 34 * k, borderRadius: 8 * k, display: 'inline-block', opacity: interpolate(frame, [6, 12], [0, 1], clamp)}}>{o.props.label}</div>}
        </div>
      </div>
    </div>
  );
};

/** confete: partículas determinísticas (seed pelo id), em tela cheia */
export const Confetti: React.FC<P> = ({o, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {width: W, height: H} = useVideoConfig();
  const colors = [style.palette.key, style.palette.accent, '#22D3EE', '#F472B6', '#34D399', '#fff'];
  const fade = interpolate(frame, [life - 10, life], [1, 0], clamp);
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', opacity: fade, pointerEvents: 'none'}}>
      {Array.from({length: 90}, (_, i) => {
        const r = (n: number) => random(`${o.id}-${i}-${n}`);
        const x0 = W * (0.3 + r(1) * 0.4);
        const vx = (r(2) - 0.5) * W * 1.4;
        const vy = -H * (0.6 + r(3) * 0.7);
        const t = frame / 30;
        const x = x0 + vx * t;
        const y = H * 0.55 + vy * t + 0.5 * H * 2.6 * t * t;
        const size = (10 + r(4) * 14) * (W / 1080);
        return <div key={i} style={{position: 'absolute', left: x, top: y, width: size, height: size * 0.6, background: colors[i % colors.length], transform: `rotate(${(r(5) * 720 + frame * 12 * (r(6) - 0.5)).toFixed(0)}deg)`, borderRadius: 2}} />;
      })}
      {o.props.emoji && <div style={{position: 'absolute', top: '30%', width: '100%', textAlign: 'center', fontSize: 200 * (W / 1080), transform: `scale(${pop(frame, 30)})`}}>{o.props.emoji}</div>}
    </div>
  );
};

/** UI/terminal: "$ comando" é digitado; "✓ ..." marca sucesso; o resto é saída */
export const Terminal: React.FC<P> = ({o, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const e = envelope(frame, fps, life);
  const lines = (o.props.items ?? []).slice(0, 6);
  const per = Math.max(6, Math.floor((life * 0.7) / Math.max(1, lines.length)));
  return (
    <div style={{position: 'absolute', top: `${o.y ?? 12}%`, left: 60 * k, right: 60 * k, borderRadius: 26 * k, overflow: 'hidden', background: '#0d1117', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)', opacity: e.alpha, transform: `translateY(${(1 - e.enter) * -40 * k}px)`}}>
      <div style={{height: 50 * k, display: 'flex', alignItems: 'center', gap: 10 * k, padding: `0 ${20 * k}px`, background: '#161b22', fontFamily: fontStack(style.fonts.body), fontSize: 26 * k, color: '#8b949e'}}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{width: 16 * k, height: 16 * k, borderRadius: 99, background: c}} />
        ))}
        <span style={{marginLeft: 12 * k}}>{o.props.title ?? 'terminal'}</span>
      </div>
      <div style={{padding: 28 * k, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 34 * k, lineHeight: 1.5}}>
        {lines.map((l, i) => {
          const start = 4 + i * per;
          if (frame < start) return null;
          const isCmd = l.startsWith('$');
          const typed = isCmd ? l.slice(0, Math.floor((frame - start) * 1.6) + 1) : l;
          const ok = l.startsWith('✓');
          const tool = /^\[.*\]/.test(l);
          return (
            <div key={i} style={{color: ok ? '#3fb950' : tool ? style.palette.key : isCmd ? '#fff' : '#c9d1d9', whiteSpace: 'pre-wrap'}}>
              {typed}
              {isCmd && typed.length < l.length && <span style={{opacity: frame % 10 < 5 ? 1 : 0}}>▌</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** sticker/meme: imagem que entra com pop, inclinada, flutuando */
export const Sticker: React.FC<P> = ({o, life}) => {
  const {resolve} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const e = envelope(frame, fps, life);
  const p = pop(frame, fps);
  const src = resolve(o.props.src);
  return (
    <div style={{position: 'absolute', top: `${o.y ?? 18}%`, right: 90 * k, width: 420 * k, opacity: e.exit, transform: `rotate(${-6 + Math.sin(frame / 10) * 2}deg) scale(${p})`, filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.45))'}}>
      {src ? <Img src={src} style={{width: '100%', borderRadius: 20 * k, border: `${8 * k}px solid #fff`}} /> : <div style={{fontSize: 200 * k}}>{o.props.emoji ?? '😂'}</div>}
      {o.props.text && <div style={{marginTop: 8 * k, textAlign: 'center', fontFamily: 'Impact, Anton, sans-serif', fontSize: 52 * k, color: '#fff', WebkitTextStroke: `${3 * k}px #000`, textTransform: 'uppercase'}}>{o.props.text}</div>}
    </div>
  );
};

/** texto gigante ATRÁS da pessoa: o texto em si (desenhado entre o vídeo e o recorte) */
export const BehindText: React.FC<{o: Overlay; frame: number; life: number}> = ({o, frame, life}) => {
  const {style} = useReel();
  const {fps, width: W} = useVideoConfig();
  const k = W / 1080;
  const text = (o.props.text ?? '').toUpperCase();
  const size = Math.min(380, (1900 / Math.max(3, text.length)) * 1.05) * k;
  const p = interpolate(frame, [0, 7], [1.25, 1], {...clamp, easing: (x) => 1 - Math.pow(1 - x, 4)});
  const fade = Math.min(interpolate(frame, [0, 4], [0, 1], clamp), interpolate(frame, [life - Math.round(fps * 0.2), life], [1, 0], clamp));
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top: `${o.y ?? 16}%`, textAlign: 'center', fontFamily: fontStack(style.fonts.display), fontWeight: style.fonts.displayWeight, fontSize: size, lineHeight: 0.92, color: style.palette.key, letterSpacing: -2 * k, opacity: fade, transform: `scale(${p})`, textShadow: '0 12px 40px rgba(0,0,0,0.35)'}}>
      {text}
    </div>
  );
};

/** sem recorte pronto, o "behind" aparece na frente (fallback) */
export const Behind: React.FC<P> = ({o, life}) => {
  const frame = useCurrentFrame();
  if (o.props.matteSrc) return null; // desenhado dentro da camada do apresentador
  return <BehindText o={o} frame={frame} life={life} />;
};
