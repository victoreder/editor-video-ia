import {getDb, type PlanVariant} from '@/lib/adapters/db';
import {getStorage} from '@/lib/adapters/storage';
import {EditPlanSchema} from '@/lib/plan/schema';
import {browserMediaMap} from '@/lib/pipeline/media-map';
import {fail, route} from '@/lib/server/http';

export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{id: string; variant: string}>};

const VARIANTS = ['claude', 'openai', 'heuristic'];

export async function GET(_: Request, {params}: Ctx) {
  return route(async () => {
    const {id, variant} = await params;
    if (!VARIANTS.includes(variant)) return fail('variante inválida', 400);
    const db = getDb();
    const [plan, project] = await Promise.all([db.getPlan(id, variant as PlanVariant), db.getProject(id)]);
    if (!plan) return fail('plano não encontrado', 404);
    const previews = project?.previews ?? {};
    // fontes sem prévia leve (projetos antigos): o editor dispara o job "preview"
    const missingPreview = plan.sources.some((s) => !previews[s.id]);
    return {plan, media: await browserMediaMap(plan, getStorage(), previews), missingPreview};
  });
}

export async function PUT(req: Request, {params}: Ctx) {
  return route(async () => {
    const {id, variant} = await params;
    if (!VARIANTS.includes(variant)) return fail('variante inválida', 400);
    const plan = EditPlanSchema.parse((await req.json()).plan);
    const db = getDb();
    await db.savePlan(id, variant as PlanVariant, plan);
    const project = await db.getProject(id);
    return {ok: true, media: await browserMediaMap(plan, getStorage(), project?.previews)};
  });
}
