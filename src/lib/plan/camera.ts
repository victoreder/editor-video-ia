// Câmera virtual (módulo 04): escala e origem a cada instante do vídeo final.
// Combina 1) o nível do clipe (um enquadramento novo a cada corte), 2) os beats
// da IA (punch = snap zoom, push = slow push, shake = tremor de impacto) e
// 3) os keyframes manuais do editor. O zoom é centrado no rosto (face track).
// Regras de motion-script/talking-head-motion.ts e kamgasimo/edit-plan.mjs (MIT).
import type {EditPlan, FaceSample, FaceTrack, ZoomBeat} from './schema';
import {placeClips, projectRange, sampleTransform, type PlacedClip} from './timeline';

export type ProjectedBeat = ZoomBeat & {t0: number; t1: number};

export function projectBeats(plan: Pick<EditPlan, 'camera' | 'clips' | 'format'>, placed?: PlacedClip[]): ProjectedBeat[] {
  const pl = placed ?? placeClips(plan.clips, plan.format.fps);
  const out: ProjectedBeat[] = [];
  for (const b of plan.camera.beats) {
    const r = projectRange(pl, b.sourceId, b.start, b.end);
    if (r) out.push({...b, t0: r.start, t1: r.end});
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

const easeOut = (f: number) => 1 - Math.pow(1 - f, 3);
const easeInOut = (f: number) => (f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2);
const clamp01 = (f: number) => Math.max(0, Math.min(1, f));

/** fator multiplicativo do beat no instante t (1 = neutro) */
export function beatFactor(beat: ProjectedBeat, t: number): number {
  if (t < beat.t0 || t > beat.t1 + 0.35) return 1;
  const len = Math.max(0.01, beat.t1 - beat.t0);
  const z = beat.scale - 1;
  switch (beat.style) {
    case 'punch': {
      // snap rápido (0,12 s), segura, e solta em 0,25 s depois do fim
      const rise = easeOut(clamp01((t - beat.t0) / 0.12));
      const fall = t > beat.t1 ? 1 - easeInOut(clamp01((t - beat.t1) / 0.25)) : 1;
      return 1 + z * rise * fall;
    }
    case 'push': {
      const rise = easeInOut(clamp01((t - beat.t0) / len));
      const fall = t > beat.t1 ? 1 - easeOut(clamp01((t - beat.t1) / 0.3)) : 1;
      return 1 + z * rise * fall;
    }
    case 'shake':
      return t <= beat.t1 ? 1 + z * 0.5 : 1;
    default:
      return 1;
  }
}

export function shakeOffset(beats: ProjectedBeat[], t: number): {x: number; y: number} {
  for (const b of beats) {
    if (b.style !== 'shake' || t < b.t0 || t > b.t1) continue;
    const k = 1 - (t - b.t0) / Math.max(0.01, b.t1 - b.t0); // decai
    const amp = 1.4 * k; // % do quadro
    return {x: Math.sin(t * 90) * amp, y: Math.cos(t * 77) * amp * 0.7};
  }
  return {x: 0, y: 0};
}

/** amostra do rosto mais próxima de um tempo da fonte (mantém a última por até 1,5 s) */
export function faceAt(tracks: FaceTrack[] | undefined, sourceId: string, srcSec: number): FaceSample | null {
  const track = tracks?.find((f) => f.sourceId === sourceId);
  if (!track || !track.samples.length) return null;
  const s = track.samples;
  // busca binária pela amostra mais próxima
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t < srcSec) lo = mid + 1;
    else hi = mid;
  }
  let best = s[lo];
  if (lo > 0 && Math.abs(s[lo - 1].t - srcSec) < Math.abs(best.t - srcSec)) best = s[lo - 1];
  return Math.abs(best.t - srcSec) <= 1.5 ? best : null;
}

/** suaviza o centro do rosto com uma média móvel (evita a câmera "tremer" com o detector) */
export function smoothFace(tracks: FaceTrack[] | undefined, sourceId: string, srcSec: number, windowSec = 0.6): {cx: number; cy: number} | null {
  const track = tracks?.find((f) => f.sourceId === sourceId);
  if (!track?.samples.length) return null;
  let n = 0;
  let cx = 0;
  let cy = 0;
  for (const s of track.samples) {
    if (s.t < srcSec - windowSec) continue;
    if (s.t > srcSec + windowSec) break;
    cx += s.cx;
    cy += s.cy;
    n++;
  }
  if (!n) {
    const f = faceAt(tracks, sourceId, srcSec);
    return f ? {cx: f.cx, cy: f.cy} : null;
  }
  return {cx: cx / n, cy: cy / n};
}

export type CameraState = {scale: number; originX: number; originY: number; offsetX: number; offsetY: number};

/** estado da câmera no instante t (segundos do vídeo) dentro do clipe `p` */
export function cameraAt(
  plan: Pick<EditPlan, 'faceTracks'>,
  p: PlacedClip,
  srcSec: number,
  t: number,
  beats: ProjectedBeat[],
  maxZoom = 1.6,
): CameraState {
  let scale = p.clip.baseZoom || 1;
  for (const b of beats) if (t >= b.t0 && t <= b.t1 + 0.35) scale *= beatFactor(b, t);
  const manual = sampleTransform(p.clip.transform, srcSec);
  scale = Math.min(maxZoom, scale) * manual.scale;
  const face = smoothFace(plan.faceTracks, p.clip.sourceId, srcSec);
  // origem do zoom: entre os olhos (um pouco acima do centro do rosto)
  const originX = face ? face.cx : 0.5;
  const originY = face ? Math.max(0.1, face.cy - 0.03) : 0.36;
  const sh = shakeOffset(beats, t);
  return {scale, originX, originY, offsetX: manual.x + sh.x, offsetY: manual.y + sh.y};
}
