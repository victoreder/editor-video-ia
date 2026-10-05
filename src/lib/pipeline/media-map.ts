// Coleta todas as chaves de mídia de um plano e monta o mapa chave → URL.
import type {EditPlan} from '../plan/schema';
import type {Storage} from '../adapters/storage';

export function mediaKeys(plan: EditPlan): string[] {
  const keys = new Set<string>();
  for (const s of plan.sources) keys.add(s.proxyKey ?? s.key);
  for (const b of plan.broll) {
    if (b.asset.src) keys.add(b.asset.src);
  }
  for (const o of plan.overlays) {
    if (o.props.src) keys.add(o.props.src); // sticker/meme
    if (o.props.matteSrc) keys.add(o.props.matteSrc); // recorte da pessoa
  }
  if (plan.audio.music?.src) keys.add(plan.audio.music.src);
  return [...keys].filter((k) => !/^(https?:|data:|blob:|builtin:)/.test(k));
}

export function mediaMap(plan: EditPlan, toUrl: (key: string) => string): Record<string, string> {
  return Object.fromEntries(mediaKeys(plan).map((k) => [k, toUrl(k)]));
}

export const publicMediaMap = (plan: EditPlan, storage: Storage) => mediaMap(plan, (k) => storage.publicUrl(k));
