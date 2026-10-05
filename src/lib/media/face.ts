// Wrapper do rastreamento de rosto (worker/face_track.py). Se o Python/OpenCV não
// estiver disponível, devolve null e o app usa o enquadramento padrão (rosto no
// terço superior) — o vídeo continua funcionando, só sem zoom centrado.
import fs from 'node:fs/promises';
import path from 'node:path';
import type {FaceSample, FaceTrack} from '../plan/schema';
import {run} from './ffmpeg';

const PYTHON = process.env.PYTHON_PATH ?? 'python3';

/** remove saltos isolados do detector (mediana de 3) */
export function cleanSamples(s: FaceSample[]): FaceSample[] {
  if (s.length < 3) return s;
  const med = (a: number, b: number, c: number) => a + b + c - Math.max(a, b, c) - Math.min(a, b, c);
  return s.map((x, i) => {
    if (i === 0 || i === s.length - 1) return x;
    const p = s[i - 1];
    const n = s[i + 1];
    return {...x, cx: med(p.cx, x.cx, n.cx), cy: med(p.cy, x.cy, n.cy), chinY: med(p.chinY, x.chinY, n.chinY)};
  });
}

export async function trackFace(video: string, sourceId: string, workDir: string): Promise<FaceTrack | null> {
  const out = path.join(workDir, `face-${sourceId}.json`);
  try {
    await run(PYTHON, [path.join(process.cwd(), 'worker', 'face_track.py'), '--input', video, '--output', out, '--fps', '5']);
    const j = JSON.parse(await fs.readFile(out, 'utf8')) as {samples: FaceSample[]; method: string};
    if (!j.samples.length) return null;
    return {sourceId, samples: cleanSamples(j.samples), method: j.method};
  } catch (e) {
    console.warn(`[face] rastreamento indisponível (${String(e).slice(0, 160)}); usando enquadramento padrão`);
    return null;
  }
}
