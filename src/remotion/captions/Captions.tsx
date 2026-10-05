// Módulo 03 — legendas animadas palavra por palavra. Presets:
// bold-pop (caixa alta, palavra-chave amarela), karaoke (caixa colorida na palavra
// falada), pill (fundo escuro), editorial (minúsculas suaves), clean.
// Base: autobroll/CaptionTrack.tsx e motion-script/ReelCaptions.tsx (MIT).
import React from 'react';
import {Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CaptionChunk, CaptionPreset} from '../../lib/plan/schema';
import type {StyleConfig} from '../../lib/styles';
import {clamp, pop} from '../anim';
import {fontStack} from '../fonts';
import {Selectable, useReel} from '../context';

export type TimedChunk = {chunk: CaptionChunk; t0: number; t1: number; /** palavras em tempo do vídeo */ words: {text: string; t0: number; t1: number; accent: boolean}[]; holdMax: number};

const STROKE = '0 0 2px #000, 0 3px 0 rgba(0,0,0,0.6), 0 6px 18px rgba(0,0,0,0.55)';

const Word: React.FC<{text: string; active: boolean; spoken: boolean; accent: boolean; preset: CaptionPreset; style: StyleConfig; size: number; appear: number}> = ({text, active, spoken, accent, preset, style, size, appear}) => {
  const p = style.palette;
  const base: React.CSSProperties = {display: 'inline-block', lineHeight: 1.12, whiteSpace: 'pre', transformOrigin: '50% 60%'};
  switch (preset) {
    case 'bold-pop':
      return (
        <span
          style={{
            ...base,
            fontFamily: fontStack(style.fonts.display),
            fontWeight: style.fonts.displayWeight,
            fontSize: size,
            letterSpacing: -1,
            color: accent ? p.key : '#fff',
            WebkitTextStroke: `${Math.round(size / 14)}px #000`,
            paintOrder: 'stroke fill',
            textShadow: STROKE,
            transform: `scale(${active ? 1.04 + (accent ? 0.03 : 0) : 1}) translateY(${(1 - appear) * 18}px)`,
            opacity: Math.max(0.0, appear),
          }}
        >
          {text}
        </span>
      );
    case 'karaoke':
      return (
        <span
          style={{
            ...base,
            fontFamily: fontStack(style.fonts.display),
            fontWeight: style.fonts.displayWeight,
            fontSize: size,
            color: spoken ? '#fff' : 'rgba(255,255,255,0.55)',
            background: active ? (accent ? p.key : p.accent) : 'transparent',
            borderRadius: size * 0.18,
            padding: `0 ${size * 0.14}px`,
            textShadow: active ? 'none' : STROKE,
            transform: `scale(${active ? 1.06 : 1}) rotate(${active ? -2 : 0}deg)`,
          }}
        >
          {text}
        </span>
      );
    case 'pill':
      return (
        <span style={{...base, fontFamily: fontStack(style.fonts.body), fontWeight: 700, fontSize: size, color: accent ? p.key : spoken ? '#fff' : 'rgba(255,255,255,0.62)'}}>{text}</span>
      );
    case 'editorial':
      return (
        <span
          style={{
            ...base,
            fontFamily: fontStack(style.fonts.body),
            fontWeight: active || accent ? 800 : 400,
            fontSize: size,
            color: '#fff',
            opacity: spoken ? 1 : 0.55,
            filter: active ? undefined : spoken ? undefined : 'blur(0.6px)',
            textShadow: '0 2px 14px rgba(0,0,0,0.55)',
            background: accent ? `linear-gradient(transparent 58%, ${p.key}cc 58%)` : undefined,
          }}
        >
          {text}
        </span>
      );
    default:
      return (
        <span style={{...base, fontFamily: fontStack(style.fonts.body), fontWeight: 700, fontSize: size, color: accent ? p.key : '#fff', textShadow: '0 2px 12px rgba(0,0,0,0.6), 0 0 24px rgba(0,0,0,0.35)'}}>
          {text}
        </span>
      );
  }
};

const Page: React.FC<{tc: TimedChunk; dur: number}> = ({tc, dur}) => {
  const {plan, style} = useReel();
  const frame = useCurrentFrame();
  const {fps, width: W} = useVideoConfig();
  const now = tc.t0 + frame / fps;
  const preset = plan.captions.preset;
  const k = W / 1080;
  const size = Math.round(style.captions.sizePx * k * (tc.chunk.scale ?? 1));
  const inF = Math.max(1, Math.min(Math.round(fps * 0.12), Math.floor(dur / 2)));
  const outStart = Math.max(inF + 1, dur - Math.round(fps * 0.12));
  const appear = interpolate(frame, [0, inF], [0, 1], clamp);
  const fade = outStart >= dur ? 1 : interpolate(frame, [outStart, dur], [1, 0], clamp);
  const y = tc.chunk.y ?? 70;
  const emojiPop = pop(frame, fps, 2);
  const pill = preset === 'pill';
  // a faixa da legenda tem a altura de 1 linha: o bloco cresce PARA CIMA (nunca entra na UI do Reels)
  const bandH = 150 * k * (tc.chunk.scale ?? 1);
  return (
    <div style={{position: 'absolute', top: `${y}%`, height: bandH, left: 0, right: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: `0 ${80 * k}px`, opacity: fade}}>
      {tc.chunk.emoji && (
        <div style={{fontSize: size * 1.25, transform: `scale(${emojiPop}) rotate(${(1 - emojiPop) * -20}deg)`, marginBottom: 6 * k, filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.4))'}}>{tc.chunk.emoji}</div>
      )}
      <Selectable id={tc.chunk.id}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: `${size * 0.02}px ${size * 0.34}px`,
            textAlign: 'center',
            transform: preset === 'bold-pop' ? `scale(${0.85 + 0.15 * appear})` : `translateY(${(1 - appear) * 12}px)`,
            opacity: preset === 'bold-pop' ? 1 : appear,
            // SEMPRE com caixa de fundo: contraste garantido em qualquer cena (fundo claro, B-roll, etc.)
            background: pill ? 'rgba(12,12,16,0.82)' : 'rgba(0,0,0,0.78)',
            borderRadius: pill ? size * 0.5 : size * 0.26,
            padding: pill ? `${size * 0.22}px ${size * 0.55}px` : `${size * 0.14}px ${size * 0.36}px`,
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
          }}
        >
          {tc.words.map((w, i) => {
            const active = now >= w.t0 && now < w.t1;
            const spoken = now >= w.t0;
            const wAppear = preset === 'bold-pop' ? interpolate(now, [w.t0 - 0.06, w.t0 + 0.06], [0.35, 1], clamp) : 1;
            return <Word key={i} text={w.text} active={active} spoken={spoken} accent={w.accent} preset={preset} style={style} size={size} appear={wAppear} />;
          })}
        </div>
      </Selectable>
    </div>
  );
};

export const CaptionsLayer: React.FC<{chunks: TimedChunk[]; hideRanges?: Array<[number, number]>}> = ({chunks, hideRanges = []}) => {
  const {fps} = useVideoConfig();
  return (
    <>
      {chunks.map((tc, i) => {
        if (tc.chunk.hidden) return null;
        const mid = (tc.t0 + tc.t1) / 2;
        if (hideRanges.some(([a, b]) => mid >= a && mid <= b)) return null;
        const next = chunks[i + 1]?.t0 ?? Infinity;
        const visEnd = Math.min(next, tc.t1 + 0.5, tc.holdMax);
        const from = Math.round(tc.t0 * fps);
        const dur = Math.max(1, Math.round(visEnd * fps) - from);
        return (
          <Sequence key={tc.chunk.id} from={from} durationInFrames={dur} layout="none" name={`legenda: ${tc.words.map((w) => w.text).join(' ')}`}>
            <Page tc={tc} dur={dur} />
          </Sequence>
        );
      })}
    </>
  );
};
