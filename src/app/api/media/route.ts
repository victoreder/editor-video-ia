// Mídia de um Blob store PRIVADO: o navegador (logado — o proxy exige sessão)
// pede /api/media?u=<url do blob> e é redirecionado para um link assinado temporário.
import {getStorage, VercelBlobStorage} from '@/lib/adapters/storage';
import {fail} from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get('u');
  if (!u) return fail('parâmetro u ausente', 400);
  let host: string;
  try {
    host = new URL(u).hostname;
  } catch {
    return fail('URL inválida', 400);
  }
  if (!host.endsWith('.blob.vercel-storage.com')) return fail('URL inválida', 400);
  const storage = getStorage();
  if (!(storage instanceof VercelBlobStorage)) return fail('storage não é o Vercel Blob', 400);
  try {
    const signed = await storage.signedUrl(u);
    return new Response(null, {status: 302, headers: {location: signed, 'cache-control': 'private, max-age=600'}});
  } catch (e) {
    return fail(e, 502);
  }
}
