'use client';
import {Suspense, useState} from 'react';
import {useSearchParams} from 'next/navigation';

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await fetch('/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password})});
    if (r.ok) {
      const next = params.get('next');
      window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } else {
      setErr(((await r.json().catch(() => ({}))) as {error?: string}).error ?? 'Erro ao entrar');
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="card w-full max-w-sm p-8">
      <h1 className="mb-1 text-xl font-extrabold">
        Editor de Vídeo <span className="text-brand">IA</span>
      </h1>
      <p className="mb-6 text-sm text-muted">Acesso restrito.</p>
      <label className="label" htmlFor="pw">
        Senha
      </label>
      <input id="pw" type="password" className="input" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <p className="mt-3 text-sm text-red-300">{err}</p>}
      <button className="btn-primary mt-5 w-full py-2" disabled={busy || !password}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
