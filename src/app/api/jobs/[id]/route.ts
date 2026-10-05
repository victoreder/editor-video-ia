import {getDb} from '@/lib/adapters/db';
import {fail, route} from '@/lib/server/http';

export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{id: string}>};

export async function GET(_: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    const job = await getDb().getJob(id);
    if (!job) return fail('job não encontrado', 404);
    return {job};
  });
}
