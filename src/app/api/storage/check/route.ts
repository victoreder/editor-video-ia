// Testa o armazenamento configurado (abrir logado: /api/storage/check).
// No S3/MinIO: cria o bucket se faltar, grava, lê por link assinado e apaga.
import {getStorage, S3Storage} from '@/lib/adapters/storage';
import {config} from '@/lib/config';
import {json} from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const storage = getStorage();
  const info = {storage: storage.kind, ...(storage.kind === 's3' ? {endpoint: config.s3.endpoint, bucket: config.s3.bucket, region: config.s3.region, bucketPublico: Boolean(config.s3.publicUrl)} : {})};
  if (!(storage instanceof S3Storage)) return json({...info, ok: true, steps: ['nada a testar para este storage']});
  try {
    return json({...info, ...(await storage.check())});
  } catch (e) {
    return json({...info, ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e)}, 500);
  }
}
