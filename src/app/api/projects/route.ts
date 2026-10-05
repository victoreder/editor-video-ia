import {getDb, type Project} from '@/lib/adapters/db';
import {getStorage} from '@/lib/adapters/storage';
import {CreateProjectSchema} from '@/lib/server/schemas';
import {route} from '@/lib/server/http';
import {uid} from '@/lib/util/id';

export const dynamic = 'force-dynamic';

export async function GET() {
  return route(async () => {
    const storage = getStorage();
    const projects = await getDb().listProjects();
    return {projects: projects.map((p) => ({...p, thumbUrl: p.thumbKey ? storage.publicUrl(p.thumbKey) : null}))};
  });
}

export async function POST(req: Request) {
  return route(async () => {
    const body = CreateProjectSchema.parse(await req.json());
    const now = new Date().toISOString();
    const p: Project = {id: uid('prj'), createdAt: now, updatedAt: now, status: 'draft', uploads: [], variants: [], exports: [], ...body};
    await getDb().createProject(p);
    return {project: p};
  });
}
