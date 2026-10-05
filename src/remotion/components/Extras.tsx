// Gancho (título dos 2 primeiros segundos), barra de progresso, end card,
// trilha com ducking e efeitos sonoros.
import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {MusicBed, SfxCue} from '../../lib/plan/schema';
import {SFX_GAIN_DB, SFX_LEAD, dbToGain} from '../../lib/modules/sfx';
import {clamp, envelope, pop} from '../anim';
import {fontStack} from '../fonts';
import {useReel} from '../context';

export const HookTitle: React.FC<{title: string; life: number}> = ({title, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps, width: W} = useVideoConfig();
  const k = W / 1080;
  const e = envelope(frame, fps, life, 6);
  const lines = title.split('|').filter(Boolean);
  return (
    <div style={{position: 'absolute', top: '13%', left: 60 * k, right: 60 * k, textAlign: 'center', opacity: e.exit}}>
      {lines.map((l, i) => {
        const p = pop(frame, fps, i * 4);
        return (
          <div key={i} style={{display: 'inline-block', margin: `${6 * k}px 0`, padding: `${8 * k}px ${26 * k}px`, background: i % 2 ? style.palette.key : '#fff', color: '#111', fontFamily: fontStack(style.fonts.display), fontWeight: style.fonts.displayWeight, fontSize: 76 * k, lineHeight: 1.05, textTransform: 'uppercase', transform: `scale(${p}) rotate(${i % 2 ? 2 : -2}deg)`, boxShadow: '0 14px 40px rgba(0,0,0,0.35)', borderRadius: 14 * k}}>
            {l}
          </div>
        );
      })}
    </div>
  );
};

export const ProgressBar: React.FC<{total: number}> = ({total}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {width: W} = useVideoConfig();
  const k = W / 1080;
  return (
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 10 * k, background: 'rgba(255,255,255,0.15)'}}>
      <div style={{height: '100%', width: `${Math.min(100, (frame / Math.max(1, total)) * 100)}%`, background: style.palette.key}} />
    </div>
  );
};

export const EndCard: React.FC<{title: string; line?: string; life: number}> = ({title, line, life}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps, width: W} = useVideoConfig();
  const k = W / 1080;
  const p = pop(frame, fps, 2);
  const fade = interpolate(frame, [0, 6], [0, 1], clamp);
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 40%, ${style.palette.accent}, ${style.palette.bg})`, opacity: fade, alignItems: 'center', justifyContent: 'center'}}>
      <div style={{fontFamily: fontStack(style.fonts.display), fontWeight: style.fonts.displayWeight, fontSize: 96 * k, color: '#fff', textAlign: 'center', padding: `0 ${80 * k}px`, transform: `scale(${p})`, textTransform: 'uppercase'}}>{title}</div>
      {line && <div style={{marginTop: 24 * k, fontFamily: fontStack(style.fonts.body), fontSize: 44 * k, color: style.palette.muted}}>{line}</div>}
      <div style={{marginTop: 40 * k, width: 120 * k, height: 120 * k, borderRadius: 99, background: style.palette.key, display: 'grid', placeItems: 'center', fontSize: 80 * k, fontWeight: 900, color: '#111', transform: `scale(${pop(frame, fps, 8)})`, opacity: life > 0 ? 1 : 0}}>+</div>
    </AbsoluteFill>
  );
};

/** trilha com fade-out e ducking: abaixa enquanto há fala (voz sempre por cima) */
export const MusicTrack: React.FC<{music: MusicBed; totalFrames: number; speech: Array<[number, number]>; src: string}> = ({music, totalFrames, speech, src}) => {
  const {fps} = useVideoConfig();
  const fadeFrames = Math.round((music.fadeOutSec ?? 0) * fps);
  const RAMP = 0.25;
  return (
    <Audio
      src={src}
      loop
      trimBefore={Math.round((music.startSec ?? 0) * fps)}
      volume={(f) => {
        let v = fadeFrames > 0 ? interpolate(f, [totalFrames - fadeFrames, totalFrames], [music.volume, 0], clamp) : music.volume;
        v *= interpolate(f, [0, Math.round(fps * 0.5)], [0, 1], clamp);
        if (music.duck && speech.length) {
          const t = f / fps;
          let dist = Infinity;
          for (const [a, b] of speech) {
            if (t >= a && t <= b) {
              dist = 0;
              break;
            }
            dist = Math.min(dist, t < a ? a - t : t - b);
          }
          const kk = Math.min(1, dist / RAMP);
          v *= music.duckLevel + (1 - music.duckLevel) * kk;
        }
        return v;
      }}
    />
  );
};

export const SfxLayer: React.FC<{cues: {cue: SfxCue; t: number}[]; volume: number}> = ({cues, volume}) => {
  const {fps} = useVideoConfig();
  return (
    <>
      {cues.map(({cue, t}) => {
        const start = Math.max(0, Math.round((t - SFX_LEAD[cue.kind]) * fps));
        return (
          <Sequence key={cue.id} from={start} durationInFrames={Math.round(fps * 3)} layout="none" name={`sfx: ${cue.kind}`}>
            <Audio src={staticFile(`sfx/${cue.kind}.wav`)} volume={Math.min(1, volume * dbToGain(SFX_GAIN_DB[cue.kind] + cue.gainDb + 12))} />
          </Sequence>
        );
      })}
    </>
  );
};
