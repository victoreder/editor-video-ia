// Módulo 06 — templates de B-roll (motion-script/BrollLayer.tsx, MIT):
// card (cartão de vidro abaixo do queixo), split (janela em cima, você embaixo),
// takeover (tela cheia), pip (mídia em tela cheia, você num quadrado).
import React from 'react';
import {Img, OffthreadVideo, Sequence, Video, getRemotionEnvironment, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {BrollSegment} from '../../lib/plan/schema';
import {clamp, envelope, pop} from '../anim';
import {fontStack} from '../fonts';
import {Selectable, useReel} from '../context';

export type TimedBroll = {b: BrollSegment; t0: number; t1: number};

const Media: React.FC<{b: BrollSegment; fit?: 'cover' | 'contain'; life: number}> = ({b, fit = 'cover', life}) => {
  const {resolve} = useReel();
  const frame = useCurrentFrame();
  const src = resolve(b.asset.src);
  const Comp = getRemotionEnvironment().isRendering ? OffthreadVideo : Video;
  // movimento lento (Ken Burns) para imagens paradas
  const kb = 1.04 + interpolate(frame, [0, life], [0, 0.08], clamp);
  if (b.asset.kind === 'emoji' || !src) {
    return <div style={{width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: 'min(28vw, 300px)'}}>{b.asset.emoji ?? '✨'}</div>;
  }
  if (b.asset.kind === 'video') return <Comp src={src} muted pauseWhenBuffering style={{width: '100%', height: '100%', objectFit: fit}} />;
  return <Img src={src} style={{width: '100%', height: '100%', objectFit: fit, transform: `scale(${kb})`}} />;
};

const CardT: React.FC<{b: BrollSegment; life: number}> = ({b, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps, width: W} = useVideoConfig();
  const k = W / 1080;
  const e = envelope(frame, fps, life);
  const emoji = b.asset.kind === 'emoji' || !b.asset.src;
  const float = Math.sin(frame / 9) * 10 * k;
  const size = 460 * k;
  return (
    <div style={{position: 'absolute', top: `${b.y ?? 48}%`, left: '50%', marginLeft: -size / 2, width: size, opacity: e.alpha, transform: `translateY(${(1 - e.enter) * 60 * k + (emoji ? float : 0)}px) scale(${0.85 + 0.15 * e.enter})`}}>
      <div
        style={{
          width: size,
          height: emoji ? size * 0.82 : size,
          borderRadius: 48 * k,
          overflow: 'hidden',
          background: emoji ? 'rgba(255,255,255,0.14)' : '#000',
          backdropFilter: 'blur(20px)',
          border: '2px solid rgba(255,255,255,0.35)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
        }}
      >
        {emoji ? (
          <div style={{width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: 250 * k, transform: `scale(${pop(frame, fps, 2)})`}}>{b.asset.emoji ?? '✨'}</div>
        ) : (
          <Media b={b} life={life} />
        )}
      </div>
      {b.caption && <div style={{marginTop: 16 * k, textAlign: 'center', fontFamily: fontStack(style.fonts.display), fontWeight: 800, fontSize: 44 * k, color: '#fff', textShadow: '0 4px 18px rgba(0,0,0,0.6)'}}>{b.caption}</div>}
    </div>
  );
};

const SplitT: React.FC<{b: BrollSegment; life: number}> = ({b, life}) => {
  const frame = useCurrentFrame();
  const {fps, width: W, height: H} = useVideoConfig();
  const k = W / 1080;
  const e = envelope(frame, fps, life, 7);
  const panelH = H * 0.47;
  // janela estilo macOS que desce do topo
  return (
    <div style={{position: 'absolute', left: 36 * k, right: 36 * k, top: 40 * k + (1 - e.enter) * -panelH * 0.4, height: panelH, opacity: e.alpha, borderRadius: 34 * k, overflow: 'hidden', background: '#0b0b0f', boxShadow: '0 30px 90px rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.12)', transform: b.template === 'split' ? `perspective(1600px) rotateX(${(1 - e.enter) * 8}deg)` : undefined}}>
      <div style={{height: 54 * k, display: 'flex', alignItems: 'center', gap: 12 * k, padding: `0 ${22 * k}px`, background: 'linear-gradient(#2a2a30,#1c1c22)'}}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <div key={c} style={{width: 18 * k, height: 18 * k, borderRadius: 99, background: c}} />
        ))}
      </div>
      <div style={{position: 'absolute', top: 54 * k, left: 0, right: 0, bottom: 0}}>
        <Media b={b} life={life} />
      </div>
    </div>
  );
};

const FullT: React.FC<{b: BrollSegment; life: number}> = ({b, life}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const e = envelope(frame, fps, life, 6);
  const zoomIn = interpolate(frame, [0, 8], [1.12, 1], clamp);
  return (
    <div style={{position: 'absolute', inset: 0, opacity: Math.min(1, e.enter * 1.6) * e.exit, transform: `scale(${zoomIn})`, background: '#000'}}>
      <Media b={b} life={life} />
    </div>
  );
};

export const BrollLayer: React.FC<{items: TimedBroll[]; below?: boolean}> = ({items, below}) => {
  const {fps} = useVideoConfig();
  return (
    <>
      {items
        // takeover/pip ficam ABAIXO do apresentador quando ele está em pip; o resto por cima
        .filter(({b}) => (below ? b.template === 'pip' : b.template !== 'pip'))
        .map(({b, t0, t1}) => {
          const from = Math.round(t0 * fps);
          const dur = Math.max(2, Math.round((t1 - t0) * fps));
          const C = b.template === 'card' ? CardT : b.template === 'split' ? SplitT : FullT;
          return (
            <Sequence key={b.id} from={from} durationInFrames={dur} layout="none" name={`b-roll: ${b.asset.query ?? b.asset.emoji ?? b.id}`}>
              <Selectable id={b.id} style={{position: 'absolute', inset: 0}}>
                <C b={b} life={dur} />
              </Selectable>
            </Sequence>
          );
        })}
    </>
  );
};
