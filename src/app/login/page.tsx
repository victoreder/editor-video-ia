'use client';
import {Suspense, useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {Logo} from '@/components/ui/Icon';

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
    <form onSubmit={submit} className="card relative w-full max-w-sm animate-fade-in p-8 shadow-pop">
      <div className="mb-6 flex items-center gap-3">
        <Logo size={36} />
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">
            Editor de Vídeo <span className="text-brand">IA</span>
          </h1>
          <p className="text-xs text-muted">Acesso restrito — entre com a senha.</p>
        </div>
      </div>
      <label className="label" htmlFor="pw">
        Senha
      </label>
      <input id="pw" type="password" className="input" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <p className="mt-3 text-sm text-red-300">{err}</p>}
      <button className="btn-primary btn-lg mt-5 w-full" disabled={busy || !password}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute top-1/4 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-brand/15 blur-3xl" />
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
