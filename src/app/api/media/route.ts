// Mídia de um storage PRIVADO (Vercel Blob privado ou bucket S3/MinIO privado): o navegador
// (logado — o proxy exige sessão) pede /api/media?u=<url do blob | chave do S3> e é
// redirecionado para um link assinado temporário.
import {getStorage} from '@/lib/adapters/storage';
import {fail} from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const KEY = /^(projects|library|styles|cache|renders)\/[^]+$/;

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get('u');
  if (!u) return fail('parâmetro u ausente', 400);
  if (/^https?:/.test(u)) {
    try {
      if (!new URL(u).hostname.endsWith('.blob.vercel-storage.com')) return fail('URL inválida', 400);
    } catch {
      return fail('URL inválida', 400);
    }
  } else if (!KEY.test(u) || u.includes('..')) return fail('chave inválida', 400);
  const storage = getStorage();
  if (!storage.signedUrl) return fail('este storage não usa links assinados', 400);
  try {
    const signed = await storage.signedUrl(u);
    return new Response(null, {status: 302, headers: {location: signed, 'cache-control': 'private, max-age=600'}});
  } catch (e) {
    return fail(e, 502);
  }
}
