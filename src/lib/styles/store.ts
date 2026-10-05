// "Meu estilo": estilos próprios (criados à mão ou copiados de um reel de referência),
// guardados no storage em styles/custom.json.
import {StyleConfigSchema, type StyleConfig} from '../plan/schema';
import {readJsonKey, writeJsonKey} from '../server/json-store';
import {getStyle, isBuiltinStyle} from './index';

const KEY = 'styles/custom.json';

export async function listCustomStyles(): Promise<StyleConfig[]> {
  const raw = await readJsonKey<unknown[]>(KEY, []);
  return raw.flatMap((x) => {
    const r = StyleConfigSchema.safeParse(x);
    return r.success ? [r.data] : [];
  });
}

export async function saveCustomStyle(style: StyleConfig): Promise<StyleConfig> {
  const s = StyleConfigSchema.parse(style);
  const all = (await listCustomStyles()).filter((x) => x.id !== s.id);
  await writeJsonKey(KEY, [...all, s]);
  return s;
}

export async function deleteCustomStyle(id: string) {
  await writeJsonKey(KEY, (await listCustomStyles()).filter((x) => x.id !== id));
}

/** para o pipeline: estilo pronto → undefined (o plano usa o id); próprio → a cópia completa */
export async function resolveProjectStyle(id: string): Promise<StyleConfig | undefined> {
  if (isBuiltinStyle(id)) return undefined;
  return (await listCustomStyles()).find((s) => s.id === id) ?? {...getStyle('dynamic'), id, name: id};
}
