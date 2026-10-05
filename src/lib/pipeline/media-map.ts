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
  // URLs entram também: no Blob as chaves SÃO URLs (privadas → precisam de link assinado)
  return [...keys].filter((k) => !/^(data:|blob:|builtin:)/.test(k));
}

export function mediaMap(plan: EditPlan, toUrl: (key: string) => string): Record<string, string> {
  return Object.fromEntries(mediaKeys(plan).map((k) => [k, toUrl(k)]));
}

export const publicMediaMap = (plan: EditPlan, storage: Storage) => mediaMap(plan, (k) => storage.publicUrl(k));

/**
 * Mapa do editor (navegador): o vídeo do apresentador aponta para a prévia leve
 * (quando existe) e, no Blob privado, já vem com o link assinado — o player baixa
 * direto do Blob, sem um desvio pela função a cada pedaço do vídeo.
 */
export async function browserMediaMap(plan: EditPlan, storage: Storage, previews: Record<string, string> = {}): Promise<Record<string, string>> {
  const byProxy = new Map(plan.sources.filter((s) => previews[s.id]).map((s) => [s.proxyKey ?? s.key, previews[s.id]]));
  const signed = storage.signedUrl ? storage : null;
  const out: Record<string, string> = {};
  await Promise.all(
    mediaKeys(plan).map(async (k) => {
      const src = byProxy.get(k) ?? k;
      out[k] = signed?.signedUrl ? await signed.signedUrl(src).catch(() => storage.publicUrl(src)) : storage.publicUrl(src);
    }),
  );
  return out;
}
