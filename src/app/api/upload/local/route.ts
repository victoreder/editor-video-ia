// Upload direto para o storage LOCAL (dev / VPS): o corpo do PUT é gravado em
// disco em streaming (sem limite de tamanho de memória).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {getStorage, LocalStorage} from '@/lib/adapters/storage';
import {fail, json} from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  const storage = getStorage();
  if (!(storage instanceof LocalStorage)) return fail('upload local desativado (STORAGE != local)', 400);
  const key = new URL(req.url).searchParams.get('key');
  if (!key || !/^(projects|library)\//.test(key) || key.includes('..')) return fail('chave inválida', 400);
  if (!req.body) return fail('corpo vazio', 400);
  const file = storage.file(key);
  await fsp.mkdir(path.dirname(file), {recursive: true});
  await pipeline(Readable.fromWeb(req.body as import('node:stream/web').ReadableStream), fs.createWriteStream(file));
  return json({key, size: (await fsp.stat(file)).size});
}
