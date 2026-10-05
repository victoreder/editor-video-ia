// Busca B-roll para um segmento (sugestões para o editor) ou dispara o job que
// preenche todos os B-rolls sem arquivo.
import {z} from 'zod';
import {enqueue} from '@/lib/pipeline/jobs';
import {searchStockPhotos, searchStockVideos, libraryMatch} from '@/lib/modules/broll-assets';
import {loadLibrary} from '@/lib/pipeline/process';
import {getStorage} from '@/lib/adapters/storage';
import {route} from '@/lib/server/http';

export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{id: string}>};

const Body = z.object({variant: z.enum(['claude', 'openai', 'heuristic'])});

export async function POST(req: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    return {job: await enqueue(id, 'broll', Body.parse(await req.json()))};
  });
}

/** GET ?q=termos&orientation=portrait → resultados da biblioteca própria + Pexels/Pixabay */
export async function GET(req: Request) {
  return route(async () => {
    const u = new URL(req.url);
    const q = u.searchParams.get('q') ?? '';
    const orientation = (u.searchParams.get('orientation') ?? 'portrait') as 'portrait' | 'landscape' | 'square';
    const storage = getStorage();
    const own = libraryMatch(await loadLibrary(), q).map((a) => ({src: a.key, url: storage.publicUrl(a.key), kind: a.kind, origin: 'own', credit: a.name}));
    const [videos, photos] = await Promise.all([searchStockVideos(q, orientation, 8), searchStockPhotos(q, orientation, 8)]);
    return {
      results: [
        ...own,
        ...videos.map((v) => ({src: v.url, url: v.url, kind: 'video', origin: v.credit.startsWith('Pixabay') ? 'pixabay' : 'pexels', credit: v.credit})),
        ...photos.map((p) => ({src: p.url, url: p.url, kind: 'image', origin: p.credit.startsWith('Pixabay') ? 'pixabay' : 'pexels', credit: p.credit})),
      ],
    };
  });
}
