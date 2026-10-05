// Jobs extras de um projeto: Shorts, post pack, capa, recorte da pessoa, música por IA.
import {z} from 'zod';
import {getDb} from '@/lib/adapters/db';
import {enqueue} from '@/lib/pipeline/jobs';
import {fail, route} from '@/lib/server/http';

export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{id: string}>};

const Body = z.object({
  type: z.enum(['shorts', 'postpack', 'thumbnail', 'matte', 'music']),
  input: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    if (!(await getDb().getProject(id))) return fail('projeto não encontrado', 404);
    const {type, input} = Body.parse(await req.json());
    return {job: await enqueue(id, type, input)};
  });
}
