// Módulo 09 — cor com o rosto primeiro (kamgasimo/grade.mjs, MIT):
// mede o rosto (caixa vinda do face track) contra o quadro inteiro, 1 frame por
// segundo. Um rosto escuro contra um fundo claro (janela, parede branca) tem os
// médios levantados; um tom de cor puxado é neutralizado de leve. A correção é
// expressa como filtros CSS (brilho/contraste/saturação) aplicados igualmente no
// preview e no render. Regra: o rosto NUNCA fica mais escuro (brilho ≥ 1).
import type {EditPlan, FaceTrack, Source} from '../plan/schema';
import {run} from './ffmpeg';

type Stats = {luma: number; u: number; v: number; sat: number} | null;

async function stats(file: string, crop?: string): Promise<Stats> {
  const vf = `fps=1,${crop ? `crop=${crop},` : ''}signalstats,metadata=print:file=-`;
  try {
    const {stdout} = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', vf, '-an', '-f', 'null', '-']);
    const vals: Record<string, number[]> = {};
    for (const m of stdout.matchAll(/lavfi\.signalstats\.(YAVG|UAVG|VAVG|SATAVG)=([\d.]+)/g)) (vals[m[1]] ||= []).push(Number(m[2]));
    const med = (a?: number[]) => {
      if (!a?.length) return NaN;
      const s = [...a].sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)];
    };
    const out = {luma: med(vals.YAVG), u: med(vals.UAVG), v: med(vals.VAVG), sat: med(vals.SATAVG)};
    return Number.isFinite(out.luma) ? out : null;
  } catch {
    return null;
  }
}

/** caixa mediana do rosto em pixels da fonte, no formato do crop do ffmpeg */
export function faceBox(track: FaceTrack | undefined, w: number, h: number): string | undefined {
  if (!track?.samples.length) return undefined;
  const med = (k: 'cx' | 'cy' | 'w' | 'h') => [...track.samples.map((s) => s[k])].sort((a, b) => a - b)[Math.floor(track.samples.length / 2)];
  const bw = Math.max(16, Math.round(med('w') * w * 0.7));
  const bh = Math.max(16, Math.round(med('h') * h * 0.7));
  const x = Math.max(0, Math.min(w - bw, Math.round(med('cx') * w - bw / 2)));
  const y = Math.max(0, Math.min(h - bh, Math.round(med('cy') * h - bh / 2)));
  return `${bw}:${bh}:${x}:${y}`;
}

export type SourceGrade = EditPlan['grade']['perSource'][string];

/** cálculo puro (testável): estatísticas → correção */
export function gradeFromStats(frame: NonNullable<Stats>, face: Stats): SourceGrade {
  const notes: string[] = [];
  let brightness = 1;
  if (face) {
    const ratio = face.luma / Math.max(1, frame.luma);
    if (ratio < 0.75 || face.luma < 95) {
      brightness = Math.min(1.3, Math.max(1.05, Math.sqrt(0.75 / Math.max(0.35, ratio)), 105 / face.luma));
      notes.push(`rosto levantado (luma do rosto ${face.luma.toFixed(0)} contra ${frame.luma.toFixed(0)} do quadro)`);
    } else if (face.luma > 190) notes.push('rosto bem exposto; sem ajuste de brilho');
  } else if (frame.luma < 100) {
    brightness = Math.min(1.25, 115 / frame.luma);
    notes.push(`exposição levantada (luma média ${frame.luma.toFixed(0)})`);
  }
  // contraste: compensa um pouco o brilho para não "lavar" a imagem
  const contrast = brightness > 1.08 ? 1 + (brightness - 1) * 0.25 : 1;
  // saturação: imagem apagada ganha um pouco, imagem estourada perde
  const saturate = frame.sat < 25 ? 1.12 : frame.sat > 80 ? 0.94 : 1;
  // tom: V > 128 = avermelhado, U > 128 = azulado; sépia aquece um tom frio
  const cool = (frame.u - 128) - (frame.v - 128);
  const warmth = cool > 6 ? Math.min(0.12, cool / 120) : 0;
  if (warmth) notes.push('tom frio aquecido de leve');
  return {brightness: Math.max(1, +brightness.toFixed(3)), contrast: +contrast.toFixed(3), saturate, warmth: +warmth.toFixed(3), notes};
}

export async function measureGrade(proxyPath: string, source: Source, track?: FaceTrack): Promise<SourceGrade | null> {
  const frame = await stats(proxyPath);
  if (!frame) return null;
  const box = faceBox(track, source.width, source.height);
  const face = box ? await stats(proxyPath, box) : null;
  return gradeFromStats(frame, face);
}
