// Client upload do Vercel Blob: o navegador envia direto ao Blob; esta rota só
// autoriza o envio (e restringe caminho, tipos e tamanho). Funciona com os dois
// tipos de store: com chave (BLOB_READ_WRITE_TOKEN → token de cliente) e no modo
// novo sem chave (BLOB_STORE_ID + OIDC da Vercel → URL pré-assinada).
import {handleUpload, handleUploadPresigned, type HandleUploadBody} from '@vercel/blob/client';
import {issueSignedToken} from '@vercel/blob';
import {fail, json} from '@/lib/server/http';
import {isAuthorized} from '@/lib/auth';

export const dynamic = 'force-dynamic';

const LIMITS = {allowedContentTypes: ['video/*', 'audio/*', 'image/*'], maximumSizeInBytes: 5 * 1024 * 1024 * 1024};

function checkPath(pathname: string) {
  if (!/^(projects|library|styles)\//.test(pathname) || pathname.includes('..')) throw new Error('caminho inválido');
}

export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody | {type: 'blob.generate-presigned-url'; payload: {pathname: string; clientPayload: string | null; multipart: boolean}};
  // o pedido de autorização vem do navegador e precisa de login; o aviso de "upload concluído"
  // vem da Vercel (sem cookie) e é validado pela assinatura dentro do SDK
  if (body.type !== 'blob.upload-completed' && !(await isAuthorized(req))) return fail('não autorizado: faça login', 401);
  try {
    if (body.type === 'blob.generate-presigned-url' || (!process.env.BLOB_READ_WRITE_TOKEN && body.type === 'blob.upload-completed')) {
      const out = await handleUploadPresigned({
        body: body as Parameters<typeof handleUploadPresigned>[0]['body'],
        request: req,
        getSignedToken: async (pathname) => {
          checkPath(pathname);
          const token = await issueSignedToken({pathname, operations: ['put'], ...LIMITS});
          return {token, urlOptions: {...LIMITS, addRandomSuffix: false, allowOverwrite: true}};
        },
      });
      return json(out);
    }
    const out = await handleUpload({
      body: body as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        checkPath(pathname);
        return {...LIMITS, addRandomSuffix: false, allowOverwrite: true};
      },
      onUploadCompleted: async () => undefined,
    });
    return json(out);
  } catch (e) {
    return fail(e, 400);
  }
}
