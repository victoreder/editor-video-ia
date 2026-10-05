// Módulo 11: estuda um reel de referência (já enviado ao storage) e cria um estilo.
import {z} from 'zod';
import {enqueue} from '@/lib/pipeline/jobs';
import {route} from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return route(async () => {
    const body = z.object({key: z.string().regex(/^(styles\/|https?:)/), name: z.string().max(80).default('Estilo da referência'), director: z.enum(['claude', 'openai']).optional()}).parse(await req.json());
    return {job: await enqueue('', 'reference', body)};
  });
}
