// Camada do apresentador: os clipes cortados, um atrás do outro, com a câmera
// virtual (zoom centrado no rosto), as transições na entrada de cada clipe,
// o grade de cor e o layout (cheio / split / pip) pedido pelo B-roll ativo.
import React, {useMemo} from 'react';
import {AbsoluteFill, OffthreadVideo, Sequence, Video, getRemotionEnvironment, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Overlay} from '../lib/plan/schema';
import {BehindText} from './overlays/Extra';
import {cameraAt, type ProjectedBeat} from '../lib/plan/camera';
import {coverFit, srcToScreen} from '../lib/plan/frame';
import {faceAt} from '../lib/plan/camera';
import type {PlacedClip} from '../lib/plan/timeline';
import type {Transition} from '../lib/plan/schema';
import {clamp} from './anim';
import {useReel} from './context';

export type SpeakerLayout = {mode: 'full' | 'split' | 'pip' | 'takeover'; k: number};

const GRADE: Record<string, string> = {
  punchy: 'contrast(1.08) saturate(1.18) brightness(1.02)',
  clean: 'contrast(1.03) saturate(1.05) brightness(1.03)',
  film: 'contrast(1.06) saturate(0.88) sepia(0.08) brightness(1.01)',
  none: '',
};

const ClipMedia: React.FC<{p: PlacedClip; beats: ProjectedBeat[]; transition?: Transition}> = ({p, beats, transition}) => {
  const {plan, resolve} = useReel();
  const frame = useCurrentFrame();
  const {fps, width: W, height: H} = useVideoConfig();
  const clip = p.clip;
  const speed = clip.speed || 1;
  const srcSec = clip.inSec + (frame / fps) * speed;
  const t = p.start + frame / fps;
  const source = plan.sources.find((s) => s.id === clip.sourceId);
  const cam = cameraAt(plan, p, srcSec, t, beats);
  // reframe 16:9 → 9:16: segue o enquadramento suavizado ("cinegrafista", fx) ou o rosto
  const face = faceAt(plan.faceTracks, clip.sourceId, srcSec);
  const fit = coverFit(source?.width ?? W, source?.height ?? H, W, H, face?.fx ?? face?.cx ?? 0.5, 0.4);
  const origin = srcToScreen(fit, W, H, cam.originX, cam.originY);

  // transição de entrada
  let tx = 0;
  let extraScale = 1;
  let blur = 0;
  let flash = 0;
  let hue = 0;
  if (transition && transition.kind !== 'cut') {
    const d = Math.max(2, Math.round(transition.duration * fps));
    const f = interpolate(frame, [0, d], [1, 0], clamp); // 1 → 0
    if (transition.kind === 'whip') {
      tx = f * f * 40;
      blur = f * 18;
    } else if (transition.kind === 'zoom') {
      extraScale = 1 + f * f * 0.35;
      blur = f * 10;
    } else if (transition.kind === 'flash') flash = f;
    else if (transition.kind === 'blur') blur = f * 24;
    else if (transition.kind === 'glitch' && frame < d) {
      tx = (frame % 2 ? 1 : -1) * 3 * f;
      hue = frame % 3 === 0 ? 90 * f : 0;
    }
  }

  const Comp = getRemotionEnvironment().isRendering ? OffthreadVideo : Video;
  const src = resolve(source?.proxyKey ?? source?.key);
  const trimBefore = Math.round(clip.inSec * fps);
  const grade = GRADE[plan.grade?.look ?? 'none'];
  const lift = plan.grade?.faceLift ? ` brightness(${1 + plan.grade.faceLift * 0.15})` : '';
  // correção medida desta fonte (módulo 09): o rosto nunca sai mais escuro
  const ps = plan.grade?.perSource?.[clip.sourceId];
  const measured = ps ? ` brightness(${ps.brightness.toFixed(3)}) contrast(${ps.contrast.toFixed(3)}) saturate(${ps.saturate.toFixed(3)})${ps.warmth ? ` sepia(${Math.max(0, ps.warmth).toFixed(3)})` : ''}` : '';
  const filter = [measured + ' ' + grade + lift, blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : '', hue ? `hue-rotate(${hue}deg)` : ''].join(' ').trim();

  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#000'}}>
      <AbsoluteFill
        style={{
          transformOrigin: `${(origin.x * 100).toFixed(2)}% ${(origin.y * 100).toFixed(2)}%`,
          transform: `translate(${(cam.offsetX + tx).toFixed(2)}%, ${cam.offsetY.toFixed(2)}%) scale(${(cam.scale * extraScale).toFixed(4)})`,
          filter: filter || undefined,
        }}
      >
        {src ? (
          <Comp
            src={src}
            playbackRate={speed}
            trimBefore={trimBefore}
            trimAfter={trimBefore + Math.round(p.durFrames * speed)}
            acceptableTimeShiftInSeconds={0.5}
            muted={clip.muted || clip.volume === 0}
            volume={clip.muted ? 0 : clip.volume}
            pauseWhenBuffering
            style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${(fit.posX * 100).toFixed(1)}% ${(fit.posY * 100).toFixed(1)}%`}}
          />
        ) : (
          <AbsoluteFill style={{background: '#222', color: '#888', alignItems: 'center', justifyContent: 'center', fontSize: 40}}>sem mídia</AbsoluteFill>
        )}
        <BehindInClip p={p} fit={fit} />
      </AbsoluteFill>
      {flash > 0.01 && <AbsoluteFill style={{background: '#fff', opacity: flash}} />}
    </AbsoluteFill>
  );
};

/**
 * Texto atrás da pessoa (fase 3): o texto é desenhado sobre o vídeo e, por cima dele,
 * o recorte da pessoa (vídeo com alfa gerado pelo job "matte"), dentro do mesmo
 * contêiner da câmera — o recorte acompanha exatamente o zoom do apresentador.
 */
const BehindInClip: React.FC<{p: PlacedClip; fit: ReturnType<typeof coverFit>}> = ({p, fit}) => {
  const {plan, resolve} = useReel();
  const {fps} = useVideoConfig();
  const clip = p.clip;
  const speed = clip.speed || 1;
  const items = plan.overlays.filter((o): o is Overlay => o.kind === 'behind' && !!o.props.matteSrc && o.sourceId === clip.sourceId && o.start < clip.outSec && o.end > clip.inSec);
  if (!items.length) return null;
  const Comp = getRemotionEnvironment().isRendering ? OffthreadVideo : Video;
  return (
    <>
      {items.map((o) => {
        const a = Math.max(o.start, clip.inSec);
        const b = Math.min(o.end, clip.outSec);
        const from = Math.round(((a - clip.inSec) / speed) * fps);
        const dur = Math.max(1, Math.round(((b - a) / speed) * fps));
        const matteOffset = Math.max(0, Math.round((a - (o.props.matteStart ?? o.start)) * fps));
        const src = resolve(o.props.matteSrc);
        return (
          <Sequence key={o.id} from={from} durationInFrames={dur} layout="none" name={`atrás: ${o.props.text ?? ''}`}>
            <BehindFrame o={o} life={dur} />
            {src && (
              <AbsoluteFill>
                <Comp
                  src={src}
                  muted
                  transparent
                  playbackRate={speed}
                  trimBefore={matteOffset}
                  style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${(fit.posX * 100).toFixed(1)}% ${(fit.posY * 100).toFixed(1)}%`}}
                />
              </AbsoluteFill>
            )}
          </Sequence>
        );
      })}
    </>
  );
};

const BehindFrame: React.FC<{o: Overlay; life: number}> = ({o, life}) => {
  const frame = useCurrentFrame();
  return <BehindText o={o} frame={frame} life={life} />;
};

export const SpeakerLayer: React.FC<{placed: PlacedClip[]; beats: ProjectedBeat[]; layout: SpeakerLayout}> = ({placed, beats, layout}) => {
  const {plan} = useReel();
  const {fps, width: W, height: H} = useVideoConfig();
  const trByClip = useMemo(() => new Map(plan.transitions.map((t) => [t.clipId, t])), [plan.transitions]);
  const k = layout.k;
  let style: React.CSSProperties = {};
  if (layout.mode === 'split') {
    // o apresentador desce para a metade de baixo
    style = {transform: `translateY(${(k * H * 0.26).toFixed(1)}px)`};
  } else if (layout.mode === 'pip') {
    const s = 1 - 0.66 * k;
    style = {
      transformOrigin: '100% 100%',
      transform: `translate(${(-k * W * 0.05).toFixed(1)}px, ${(-k * H * 0.2).toFixed(1)}px) scale(${s.toFixed(3)})`,
      borderRadius: 60 * k,
      overflow: 'hidden',
      boxShadow: k > 0.1 ? `0 30px 80px rgba(0,0,0,${0.5 * k})` : undefined,
      border: k > 0.1 ? `${(8 * k).toFixed(1)}px solid rgba(255,255,255,0.9)` : undefined,
    };
  }
  return (
    <AbsoluteFill style={style}>
      {placed.map((p) => (
        <Sequence key={p.clip.id} from={p.fromFrame} durationInFrames={p.durFrames} premountFor={Math.round(fps)} name={p.clip.label ?? p.clip.id}>
          <ClipMedia p={p} beats={beats} transition={trByClip.get(p.clip.id)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
