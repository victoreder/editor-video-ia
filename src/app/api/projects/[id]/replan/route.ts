import {z} from 'zod';
import {enqueue} from '@/lib/pipeline/jobs';
import {route} from '@/lib/server/http';

export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{id: string}>};

const Body = z.object({variant: z.enum(['claude', 'openai', 'heuristic']), director: z.enum(['claude', 'openai', 'heuristic']).optional()});

export async function POST(req: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    const body = Body.parse(await req.json());
    return {job: await enqueue(id, 'replan', body)};
  });
}
