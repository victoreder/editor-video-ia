// Para o processamento/exportação em andamento do projeto (jobs na fila ou rodando).
import {getDb} from '@/lib/adapters/db';
import {cancelProjectJobs} from '@/lib/pipeline/jobs';
import {fail, route} from '@/lib/server/http';

export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{id: string}>};

export async function POST(_: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    if (!(await getDb().getProject(id))) return fail('projeto não encontrado', 404);
    const cancelled = await cancelProjectJobs(id);
    return {cancelled, project: await getDb().getProject(id)};
  });
}
