// Capa / thumbnail (módulo 13): o frame mais expressivo, congelado, com o título
// grande no estilo do vídeo. Renderizada como still (renderStill).
import React from 'react';
import {AbsoluteFill, Freeze} from 'remotion';
import type {EditPlan} from '../lib/plan/schema';
import {styleOf} from '../lib/styles';
import {Reel} from './Reel';
import {fontStack} from './fonts';

export type CoverProps = {plan: EditPlan; media?: Record<string, string>; t: number; title: string};

export const Cover: React.FC<CoverProps> = ({plan, media, t, title}) => {
  const style = styleOf(plan);
  const k = plan.format.width / 1080;
  const lines = title.split('|').filter(Boolean);
  return (
    <AbsoluteFill>
      <Freeze frame={Math.round(t * plan.format.fps)}>
        <Reel plan={plan} media={media} layers={{captions: false, overlays: false, broll: false, music: false, sfx: false, hook: false, progress: false, outro: false}} />
      </Freeze>
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.75) 100%)'}} />
      <div style={{position: 'absolute', left: 60 * k, right: 60 * k, bottom: '17%', textAlign: 'center'}}>
        {lines.map((l, i) => (
          <div
            key={i}
            style={{
              display: 'inline-block',
              margin: `${8 * k}px 0`,
              padding: `${6 * k}px ${24 * k}px`,
              background: i % 2 ? style.palette.key : 'transparent',
              color: i % 2 ? '#111' : '#fff',
              fontFamily: fontStack(style.fonts.display),
              fontWeight: style.fonts.displayWeight,
              fontSize: (lines.length > 2 ? 96 : 120) * k,
              lineHeight: 1.02,
              textTransform: 'uppercase',
              WebkitTextStroke: i % 2 ? undefined : `${6 * k}px #000`,
              paintOrder: 'stroke fill',
              transform: `rotate(${i % 2 ? 2 : -2}deg)`,
              borderRadius: 14 * k,
            }}
          >
            {l}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
