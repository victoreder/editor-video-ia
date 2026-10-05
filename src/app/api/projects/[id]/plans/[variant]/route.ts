import {getDb, type PlanVariant} from '@/lib/adapters/db';
import {getStorage} from '@/lib/adapters/storage';
import {EditPlanSchema} from '@/lib/plan/schema';
import {publicMediaMap} from '@/lib/pipeline/media-map';
import {fail, route} from '@/lib/server/http';

export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{id: string; variant: string}>};

const VARIANTS = ['claude', 'openai', 'heuristic'];

export async function GET(_: Request, {params}: Ctx) {
  return route(async () => {
    const {id, variant} = await params;
    if (!VARIANTS.includes(variant)) return fail('variante inválida', 400);
    const plan = await getDb().getPlan(id, variant as PlanVariant);
    if (!plan) return fail('plano não encontrado', 404);
    return {plan, media: publicMediaMap(plan, getStorage())};
  });
}

export async function PUT(req: Request, {params}: Ctx) {
  return route(async () => {
    const {id, variant} = await params;
    if (!VARIANTS.includes(variant)) return fail('variante inválida', 400);
    const plan = EditPlanSchema.parse((await req.json()).plan);
    await getDb().savePlan(id, variant as PlanVariant, plan);
    return {ok: true, media: publicMediaMap(plan, getStorage())};
  });
}
