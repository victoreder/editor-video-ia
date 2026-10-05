// Destino de upload direto para arquivos fora de um projeto (reel de referência, biblioteca).
import path from 'node:path';
import {z} from 'zod';
import {getStorage} from '@/lib/adapters/storage';
import {route, safeName} from '@/lib/server/http';
import {uid} from '@/lib/util/id';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return route(async () => {
    const {prefix, name, contentType} = z.object({prefix: z.enum(['styles', 'library']), name: z.string(), contentType: z.string()}).parse(await req.json());
    const ext = path.extname(name).toLowerCase() || '.mp4';
    const key = `${prefix}/${prefix === 'styles' ? 'ref/' : ''}${uid('f')}-${safeName(path.basename(name, ext))}${ext}`;
    return {key, target: await getStorage().uploadTarget(key, contentType)};
  });
}
