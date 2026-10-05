// Gera os recortes (vídeo com alfa) para os gráficos "behind" (texto atrás da pessoa).
import path from 'node:path';
import fs from 'node:fs/promises';
import type {EditPlan} from '../plan/schema';
import {getStorage} from '../adapters/storage';
import {run} from './ffmpeg';

const PYTHON = process.env.PYTHON_PATH ?? 'python3';

export async function makeMatte(proxy: string, start: number, end: number, out: string) {
  await run(PYTHON, [path.join(process.cwd(), 'worker', 'matte.py'), '--input', proxy, '--start', start.toFixed(3), '--end', end.toFixed(3), '--output', out]);
}

/** recorta a pessoa para cada "behind" sem recorte; devolve o plano atualizado */
export async function generateMattes(plan: EditPlan, projectId: string, workDir: string, log: (s: string) => void): Promise<EditPlan> {
  const pending = plan.overlays.filter((o) => o.kind === 'behind' && !o.props.matteSrc);
  if (!pending.length) return plan;
  const storage = getStorage();
  const proxies = new Map<string, string>();
  const overlays = [...plan.overlays];
  for (const o of pending) {
    const src = plan.sources.find((s) => s.id === o.sourceId);
    if (!src) continue;
    try {
      let proxy = proxies.get(src.id);
      if (!proxy) {
        proxy = path.join(workDir, `matte-src-${src.id}.mp4`);
        await storage.download(src.proxyKey ?? src.key, proxy);
        proxies.set(src.id, proxy);
      }
      const a = Math.max(0, o.start - 0.2);
      const b = Math.min(src.duration, o.end + 0.2);
      const out = path.join(workDir, `matte-${o.id}.webm`);
      await makeMatte(proxy, a, b, out);
      const key = await storage.putFile(`projects/${projectId}/matte/${o.id}.webm`, out, 'video/webm');
      const i = overlays.findIndex((x) => x.id === o.id);
      overlays[i] = {...o, props: {...o.props, matteSrc: key, matteStart: a}};
      log(`recorte da pessoa pronto para "${o.props.text ?? ''}"`);
      await fs.rm(out, {force: true});
    } catch (e) {
      log(`recorte falhou (${String(e).slice(0, 160)}); o texto fica na frente`);
    }
  }
  return {...plan, overlays};
}
