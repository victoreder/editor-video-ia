// Servidor HTTP mínimo (com Range) para o render local acessar arquivos do
// storage local sem depender do Next estar rodando.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type {AddressInfo} from 'node:net';

export const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.srt': 'application/x-subrip', '.txt': 'text/plain',
};

export function serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  const headers = {'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*'};
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[2] && range[1] ? Math.min(size - 1, Number(range[2])) : size - 1;
    res.writeHead(206, {...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1});
    fs.createReadStream(file, {start, end}).pipe(res);
  } else {
    res.writeHead(200, {...headers, 'Content-Length': size});
    fs.createReadStream(file).pipe(res);
  }
}

export async function startStaticServer(root: string): Promise<{url: string; close: () => Promise<void>}> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root))) {
      res.writeHead(403).end();
      return;
    }
    serveFile(req, res, file);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const {port} = server.address() as AddressInfo;
  return {url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r()))};
}
