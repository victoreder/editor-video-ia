// Client upload do Vercel Blob: o navegador envia direto ao Blob; esta rota só
// emite o token (e restringe tipos e tamanho).
import {handleUpload, type HandleUploadBody} from '@vercel/blob/client';
import {fail, json} from '@/lib/server/http';
import {isAuthorized} from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody;
  // o pedido de token vem do navegador e precisa de login; o aviso de "upload concluído"
  // vem da Vercel (sem cookie) e é validado pela assinatura dentro de handleUpload
  if (body.type === 'blob.generate-client-token' && !(await isAuthorized(req))) return fail('não autorizado: faça login', 401);
  try {
    const out = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^(projects|library|styles)\//.test(pathname)) throw new Error('caminho inválido');
        return {
          allowedContentTypes: ['video/*', 'audio/*', 'image/*'],
          maximumSizeInBytes: 5 * 1024 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
      onUploadCompleted: async () => undefined,
    });
    return json(out);
  } catch (e) {
    return fail(e, 400);
  }
}
