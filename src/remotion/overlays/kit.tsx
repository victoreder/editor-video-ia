// peças comuns dos gráficos (cartão de vidro e escala por largura)
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {envelope} from '../anim';
import {useReel} from '../context';

export const useK = () => useVideoConfig().width / 1080;

export const Card: React.FC<{life: number; y: number; children: React.ReactNode; width?: number; light?: boolean}> = ({life, y, children, width = 860, light}) => {
  const {style} = useReel();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const k = useK();
  const e = envelope(frame, fps, life);
  return (
    <div
      style={{
        position: 'absolute',
        top: `${y}%`,
        left: '50%',
        width: width * k,
        marginLeft: (-width * k) / 2,
        padding: 40 * k,
        borderRadius: 44 * k,
        background: light ? 'rgba(255,255,255,0.96)' : style.palette.panel.startsWith('#') ? `${style.palette.panel}ee` : style.palette.panel,
        color: light ? '#111' : style.palette.panelText,
        backdropFilter: 'blur(18px)',
        boxShadow: '0 30px 80px rgba(0,0,0,0.38), 0 6px 18px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.14)',
        opacity: e.alpha,
        transform: `translateY(${(1 - e.enter) * 50 * k}px) scale(${0.9 + 0.1 * e.enter})`,
        transformOrigin: '50% 100%',
      }}
    >
      {children}
    </div>
  );
};

