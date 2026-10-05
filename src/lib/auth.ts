// Acesso ao sistema (uso próprio): uma senha (APP_PASSWORD) → cookie de sessão
// assinado com HMAC-SHA256. Ferramentas (MCP, scripts) usam um token de API
// (APP_API_TOKEN) no cabeçalho Authorization. Usa só Web Crypto, então roda
// tanto no proxy quanto nas rotas.
export const SESSION_COOKIE = 'ev_session';
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** a senha está configurada? (sem ela, o deploy fica bloqueado; localmente fica aberto) */
export const authConfigured = () => Boolean(process.env.APP_PASSWORD);
export const authRequired = () => authConfigured() || Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';

/** chave de assinatura: AUTH_SECRET, ou derivada da senha (trocar a senha derruba todas as sessões) */
async function key(): Promise<CryptoKey> {
  const secret = process.env.AUTH_SECRET || `ev:${process.env.APP_PASSWORD ?? ''}`;
  return crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
}

async function sign(payload: string): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await key(), enc.encode(payload)));
}

/** comparação em tempo constante */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function createSession(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return `${exp}.${await sign(String(exp))}`;
}

export async function verifySession(token: string | undefined | null): Promise<boolean> {
  if (!token || !authConfigured()) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await sign(exp));
}

export function checkPassword(password: string): boolean {
  const expected = process.env.APP_PASSWORD;
  return Boolean(expected) && safeEqual(password, expected!);
}

/** token de API para ferramentas (MCP, scripts): Authorization: Bearer <APP_API_TOKEN> */
export function checkApiToken(header: string | null): boolean {
  const token = process.env.APP_API_TOKEN;
  if (!token || token.length < 16 || !header?.startsWith('Bearer ')) return false;
  return safeEqual(header.slice(7), token);
}

const cookieOf = (cookieHeader: string | null, name: string) =>
  cookieHeader
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/** a requisição está autorizada? (cookie de sessão ou token de API) */
export async function isAuthorized(req: Request): Promise<boolean> {
  if (!authRequired()) return true;
  if (checkApiToken(req.headers.get('authorization'))) return true;
  return verifySession(cookieOf(req.headers.get('cookie'), SESSION_COOKIE));
}
