import {NextResponse} from 'next/server';
import {SESSION_COOKIE, SESSION_DAYS, authConfigured, checkPassword, createSession} from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!authConfigured()) return NextResponse.json({error: 'Defina APP_PASSWORD nas variáveis de ambiente.'}, {status: 503});
  const {password} = (await req.json().catch(() => ({}))) as {password?: string};
  if (!password || !checkPassword(password)) {
    // atraso fixo: atrapalha quem tenta adivinhar a senha
    await new Promise((r) => setTimeout(r, 1000));
    return NextResponse.json({error: 'Senha incorreta'}, {status: 401});
  }
  const res = NextResponse.json({ok: true});
  res.cookies.set(SESSION_COOKIE, await createSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}
