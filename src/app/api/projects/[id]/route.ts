import {getDb} from '@/lib/adapters/db';
import {getStorage} from '@/lib/adapters/storage';
import {fail, json, route} from '@/lib/server/http';
import {CreateProjectSchema} from '@/lib/server/schemas';

export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{id: string}>};

export async function GET(_: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    const db = getDb();
    const project = await db.getProject(id);
    if (!project) return fail('projeto não encontrado', 404);
    const storage = getStorage();
    const jobs = (await db.listJobs(id)).slice(0, 10);
    return {
      project: {...project, thumbUrl: project.thumbKey ? storage.publicUrl(project.thumbKey) : null},
      exports: project.exports.map((e) => ({...e, videoUrl: storage.publicUrl(e.videoKey), srtUrl: e.srtKey ? storage.publicUrl(e.srtKey) : null, thumbUrl: e.thumbKey ? storage.publicUrl(e.thumbKey) : null})),
      jobs,
    };
  });
}

export async function PATCH(req: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    const patch = CreateProjectSchema.partial().extend({activeVariant: CreateProjectSchema.shape.director.optional()}).parse(await req.json());
    const {activeVariant, ...rest} = patch;
    const project = await getDb().updateProject(id, {...rest, ...(activeVariant && activeVariant !== 'compare' ? {activeVariant} : {})});
    return {project};
  });
}

export async function DELETE(_: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    await getStorage().delete(`projects/${id}`).catch(() => undefined);
    await getDb().deleteProject(id);
    return json({ok: true});
  });
}
