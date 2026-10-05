// "Meu estilo": estilos prontos + próprios (criados à mão ou copiados de um reel).
import {StyleConfigSchema} from '@/lib/plan/schema';
import {STYLE_LIST} from '@/lib/styles';
import {deleteCustomStyle, listCustomStyles, saveCustomStyle} from '@/lib/styles/store';
import {route} from '@/lib/server/http';
import {uid} from '@/lib/util/id';

export const dynamic = 'force-dynamic';

export async function GET() {
  return route(async () => ({builtin: STYLE_LIST, custom: await listCustomStyles()}));
}

export async function POST(req: Request) {
  return route(async () => {
    const body = StyleConfigSchema.parse(await req.json());
    const id = body.id.startsWith('custom_') ? body.id : `custom_${uid('st').slice(3)}`;
    return {style: await saveCustomStyle({...body, id})};
  });
}

export async function DELETE(req: Request) {
  return route(async () => {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    await deleteCustomStyle(id);
    return {ok: true};
  });
}
