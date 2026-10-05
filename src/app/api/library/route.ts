// Biblioteca de assets próprios (módulo 06): a IA consulta primeiro.
// Guardada como library/index.json no storage; os arquivos sobem direto do navegador.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {z} from 'zod';
import {getStorage} from '@/lib/adapters/storage';
import {loadLibrary} from '@/lib/pipeline/process';
import {route, safeName} from '@/lib/server/http';
import {uid} from '@/lib/util/id';
import type {LibraryAsset} from '@/lib/modules/broll-assets';

export const dynamic = 'force-dynamic';

async function saveLibrary(lib: LibraryAsset[]) {
  const storage = getStorage();
  const tmp = path.join(os.tmpdir(), `lib-${Date.now()}.json`);
  await fs.writeFile(tmp, JSON.stringify(lib, null, 1));
  await storage.putFile('library/index.json', tmp, 'application/json');
}

export async function GET() {
  return route(async () => {
    const storage = getStorage();
    return {assets: (await loadLibrary()).map((a) => ({...a, url: storage.publicUrl(a.key)}))};
  });
}

/** passo 1: pede o destino do upload; passo 2 (PUT): registra o asset com tags */
export async function POST(req: Request) {
  return route(async () => {
    const {name, contentType} = z.object({name: z.string(), contentType: z.string()}).parse(await req.json());
    const ext = path.extname(name).toLowerCase() || '.mp4';
    const key = `library/${uid('a')}-${safeName(path.basename(name, ext))}${ext}`;
    return {key, target: await getStorage().uploadTarget(key, contentType)};
  });
}

export async function PUT(req: Request) {
  return route(async () => {
    const a = z.object({key: z.string(), name: z.string(), kind: z.enum(['video', 'image']), tags: z.array(z.string())}).parse(await req.json());
    const lib = (await loadLibrary()).filter((x) => x.key !== a.key);
    lib.push(a);
    await saveLibrary(lib);
    return {ok: true};
  });
}

export async function DELETE(req: Request) {
  return route(async () => {
    const key = new URL(req.url).searchParams.get('key');
    await saveLibrary((await loadLibrary()).filter((x) => x.key !== key));
    return {ok: true};
  });
}
