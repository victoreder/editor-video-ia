// Proteção do sistema inteiro: sem sessão válida, as páginas vão para /login e
// a API responde 401. Assim ninguém usa o editor (nem as suas chaves de IA) sem a senha.
import {NextResponse, type NextRequest} from 'next/server';
import {authConfigured, isAuthorized} from './lib/auth';

// rotas que precisam funcionar sem login
const PUBLIC = [/^\/login$/, /^\/api\/auth\/(login|logout)$/, /^\/api\/upload\/blob$/];

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((re) => re.test(path))) return NextResponse.next();
  if (await isAuthorized(req)) return NextResponse.next();
  const isApi = path.startsWith('/api/');
  if (!authConfigured()) {
    // publicado sem senha: bloqueia tudo em vez de deixar aberto
    const msg = 'Defina a variável de ambiente APP_PASSWORD para acessar o sistema.';
    return isApi ? NextResponse.json({error: msg}, {status: 503}) : new NextResponse(msg, {status: 503, headers: {'content-type': 'text/plain; charset=utf-8'}});
  }
  if (isApi) return NextResponse.json({error: 'não autorizado: faça login'}, {status: 401});
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = path === '/' ? '' : `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // tudo, menos os arquivos estáticos do Next e do public/ (fontes, sons, trilhas)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/|sfx/|music/).*)'],
};
