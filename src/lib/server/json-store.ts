// JSON pequeno guardado no storage (biblioteca, estilos próprios): funciona igual
// no disco local, no Vercel Blob e no S3.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getStorage} from '../adapters/storage';

export async function readJsonKey<T>(key: string, fallback: T): Promise<T> {
  const storage = getStorage();
  const tmp = path.join(os.tmpdir(), `js-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  try {
    await storage.download(key, tmp);
    return JSON.parse(await fs.readFile(tmp, 'utf8')) as T;
  } catch {
    return fallback;
  } finally {
    await fs.rm(tmp, {force: true});
  }
}

export async function writeJsonKey(key: string, data: unknown) {
  const storage = getStorage();
  await storage.put(key, JSON.stringify(data, null, 1), 'application/json');
}

