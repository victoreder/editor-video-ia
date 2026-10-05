// utilidades das rotas de API
import {NextResponse} from 'next/server';
import {ZodError} from 'zod';

export const json = (data: unknown, status = 200) => NextResponse.json(data, {status});

export function fail(e: unknown, status = 400) {
  if (e instanceof ZodError) return json({error: 'dados inválidos', issues: e.issues.slice(0, 10)}, 400);
  const msg = e instanceof Error ? e.message : String(e);
  return json({error: msg}, status);
}

export async function route<T>(fn: () => Promise<T>) {
  try {
    const out = await fn();
    return out instanceof Response ? out : json(out);
  } catch (e) {
    console.error(e);
    return fail(e, 500);
  }
}

export const safeName = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80) || 'arquivo';
