// Registra um upload e devolve para onde o navegador deve enviar o arquivo
// (direto ao Blob/S3, ou ao disco local). Funções da Vercel aceitam no máx. 4,5 MB,
// por isso o arquivo nunca passa por aqui.
import path from 'node:path';
import {z} from 'zod';
import {getDb} from '@/lib/adapters/db';
import {getStorage} from '@/lib/adapters/storage';
import {fail, route, safeName} from '@/lib/server/http';
import {uid} from '@/lib/util/id';

export const dynamic = 'force-dynamic';
type Ctx = {params: Promise<{id: string}>};

const Body = z.object({
  name: z.string(),
  size: z.number(),
  contentType: z.string().default('video/mp4'),
  kind: z.enum(['source', 'music']).default('source'),
});

export async function POST(req: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    const body = Body.parse(await req.json());
    const db = getDb();
    const project = await db.getProject(id);
    if (!project) return fail('projeto não encontrado', 404);
    const upId = uid(body.kind === 'music' ? 'mus' : 'src');
    const ext = path.extname(body.name) || (body.kind === 'music' ? '.mp3' : '.mp4');
    const key = `projects/${id}/${body.kind === 'music' ? 'music' : 'uploads'}/${upId}-${safeName(path.basename(body.name, ext))}${ext.toLowerCase()}`;
    const target = await getStorage().uploadTarget(key, body.contentType);
    return {upload: {id: upId, name: body.name, key, size: body.size, contentType: body.contentType}, target};
  });
}

/** confirma o upload concluído (com a chave/URL final, no caso do Blob) */
const Confirm = z.object({
  upload: z.object({id: z.string(), name: z.string(), key: z.string(), size: z.number(), contentType: z.string()}),
  kind: z.enum(['source', 'music']).default('source'),
});

export async function PUT(req: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    const {upload, kind} = Confirm.parse(await req.json());
    const db = getDb();
    const project = await db.getProject(id);
    if (!project) return fail('projeto não encontrado', 404);
    if (kind === 'music') return {project: await db.updateProject(id, {musicKey: upload.key})};
    return {project: await db.updateProject(id, {uploads: [...project.uploads.filter((u) => u.id !== upload.id), upload]})};
  });
}

export async function DELETE(req: Request, {params}: Ctx) {
  return route(async () => {
    const {id} = await params;
    const upId = new URL(req.url).searchParams.get('upload');
    const db = getDb();
    const project = await db.getProject(id);
    if (!project) return fail('projeto não encontrado', 404);
    return {project: await db.updateProject(id, {uploads: project.uploads.filter((u) => u.id !== upId)})};
  });
}
