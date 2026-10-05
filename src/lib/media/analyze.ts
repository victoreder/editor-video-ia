// Medições objetivas de um vídeo (sem IA): cortes de cena, ritmo, paleta e cor.
// Alimentam o "copiar estilo de referência" (módulo 11) e servem de fallback.
import fs from 'node:fs/promises';
import path from 'node:path';
import {run} from './ffmpeg';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';

/** instantes de troca de plano (cortes duros, transições bruscas) */
export async function sceneCuts(file: string, threshold = 0.32): Promise<number[]> {
  const {stderr} = await run(FFMPEG, ['-hide_banner', '-i', file, '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-']);
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

/** cor média do vídeo (signalstats) */
export async function colorStats(file: string) {
  const {stdout} = await run(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-vf', 'fps=1,scale=320:-2,signalstats,metadata=print:file=-', '-an', '-f', 'null', '-']);
  const take = (k: string) => {
    const v = [...stdout.matchAll(new RegExp(`signalstats\\.${k}=([\\d.]+)`, 'g'))].map((m) => Number(m[1])).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };
  return {luma: take('YAVG'), sat: take('SATAVG'), u: take('UAVG'), v: take('VAVG')};
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** cores dominantes SATURADAS (k-means simples em pixels amostrados) — candidatas a destaque */
export async function dominantColors(file: string, workDir: string, k = 5): Promise<string[]> {
  const raw = path.join(workDir, 'palette.rgb');
  await run(FFMPEG, ['-y', '-i', file, '-vf', 'fps=1,scale=48:-2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
  const buf = await fs.readFile(raw);
  const px: [number, number, number][] = [];
  for (let i = 0; i + 2 < buf.length; i += 3) {
    const [r, g, b] = [buf[i], buf[i + 1], buf[i + 2]];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // só cores vivas e não muito escuras (pele e fundo neutro ficam de fora)
    if (max > 90 && (max - min) / max > 0.45) px.push([r, g, b]);
  }
  if (px.length < k) return [];
  let cent = Array.from({length: k}, (_, i) => px[Math.floor((i * px.length) / k)]);
  let counts: number[] = [];
  for (let it = 0; it < 10; it++) {
    const acc = cent.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let best = 0;
      let bd = Infinity;
      cent.forEach((c, j) => {
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      acc[best][0] += p[0];
      acc[best][1] += p[1];
      acc[best][2] += p[2];
      acc[best][3]++;
    }
    cent = acc.map((a, j) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : cent[j])) as typeof cent;
    counts = acc.map((a) => a[3]);
  }
  const order = cent.map((c, j) => ({c, n: counts[j]})).sort((a, b) => b.n - a.n);
  return order.filter((x) => x.n > px.length * 0.04).map((x) => hex(...x.c));
}

/** frames a cada `every` s, em JPEG base64 (para a IA ver) */
export async function framesBase64(file: string, workDir: string, every: number, max: number, width = 360): Promise<{t: number; base64: string}[]> {
  const dir = path.join(workDir, 'frames');
  await fs.mkdir(dir, {recursive: true});
  await run(FFMPEG, ['-y', '-i', file, '-vf', `fps=${1 / every},scale=${width}:-2`, '-q:v', '6', '-frames:v', String(max), path.join(dir, 'f_%04d.jpg')]);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jpg')).sort();
  return Promise.all(files.map(async (f, i) => ({t: +(i * every).toFixed(2), base64: (await fs.readFile(path.join(dir, f))).toString('base64')})));
}
