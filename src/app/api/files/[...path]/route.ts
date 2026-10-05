// Serve arquivos do storage LOCAL com suporte a Range (o <video> precisa para buscar).
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {getStorage, LocalStorage} from '@/lib/adapters/storage';
import {MIME} from '@/lib/media/static-server';

export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{path: string[]}>};

export async function GET(req: Request, {params}: Ctx) {
  const storage = getStorage();
  if (!(storage instanceof LocalStorage)) return new Response('not found', {status: 404});
  const {path: parts} = await params;
  const key = parts.map(decodeURIComponent).join('/');
  let file: string;
  try {
    file = storage.file(key);
  } catch {
    return new Response('forbidden', {status: 403});
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('not found', {status: 404});
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers: Record<string, string> = {'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600'};
  if (new URL(req.url).searchParams.has('download')) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
  const range = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[2] && range[1] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start >= size) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${size}`}});
    const stream = Readable.toWeb(fs.createReadStream(file, {start, end})) as ReadableStream;
    return new Response(stream, {status: 206, headers: {...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1)}});
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {headers: {...headers, 'Content-Length': String(size)}});
}
