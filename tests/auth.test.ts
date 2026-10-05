import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkApiToken, checkPassword, createSession, isAuthorized, safeEqual, verifySession} from '../src/lib/auth';

test('login: sessão assinada, expira e cai quando a senha muda', async () => {
  process.env.APP_PASSWORD = 'senha-forte-123';
  delete process.env.AUTH_SECRET;
  assert.ok(checkPassword('senha-forte-123'));
  assert.ok(!checkPassword('senha-forte-12'));
  const s = await createSession();
  assert.ok(await verifySession(s));
  assert.ok(!(await verifySession(s.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))), 'assinatura adulterada');
  assert.ok(!(await verifySession(`1.${s.split('.')[1]}`)), 'expirada');
  const req = (h: Record<string, string>) => new Request('http://x/api/projects', {headers: h});
  assert.ok(await isAuthorized(req({cookie: `ev_session=${s}`})));
  assert.ok(!(await isAuthorized(req({}))));
  process.env.APP_PASSWORD = 'outra-senha';
  assert.ok(!(await verifySession(s)), 'trocar a senha derruba as sessões');
  process.env.APP_API_TOKEN = 'token-de-api-bem-longo';
  assert.ok(checkApiToken('Bearer token-de-api-bem-longo'));
  assert.ok(!checkApiToken('Bearer errado'));
  assert.ok(await isAuthorized(req({authorization: 'Bearer token-de-api-bem-longo'})));
  assert.ok(safeEqual('abc', 'abc') && !safeEqual('abc', 'abd') && !safeEqual('abc', 'abcd'));
  delete process.env.APP_PASSWORD;
  delete process.env.APP_API_TOKEN;
});
