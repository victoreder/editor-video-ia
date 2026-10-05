import {getDb} from '@/lib/adapters/db';
import {enqueue} from '@/lib/pipeline/jobs';
import {fail, route} from '@/lib/server/http';

export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{id: string}>};

export async function POST(_: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    const project = await getDb().getProject(id);
    if (!project) return fail('projeto não encontrado', 404);
    if (!project.uploads.length) return fail('envie pelo menos um vídeo', 400);
    const job = await enqueue(id, 'process');
    await getDb().updateProject(id, {status: 'processing', error: undefined});
    return {job};
  });
}
