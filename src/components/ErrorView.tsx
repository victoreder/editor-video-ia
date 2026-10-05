'use client';
// Tela de erro que mostra a mensagem real (em vez do genérico "This page couldn't load"),
// com botão para copiar e mandar para o suporte.
import {useEffect} from 'react';

export function ErrorView({error, reset}: {error: Error & {digest?: string}; reset?: () => void}) {
  const detail = [error.message, error.digest ? `digest: ${error.digest}` : '', (error.stack ?? '').split('\n').slice(1, 6).join('\n')].filter(Boolean).join('\n');
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div style={{minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0b0b10', color: '#eee', fontFamily: 'system-ui, sans-serif'}}>
      <div style={{maxWidth: 640, width: '100%', background: '#15151d', border: '1px solid #2a2a36', borderRadius: 16, padding: 24}}>
        <h1 style={{fontSize: 20, fontWeight: 700, marginBottom: 8}}>Algo quebrou nesta tela</h1>
        <p style={{fontSize: 14, color: '#aaa', marginBottom: 12}}>Suas edições ficam salvas automaticamente. Copie o erro abaixo e mande para o suporte.</p>
        <pre style={{whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, background: '#0b0b10', padding: 12, borderRadius: 8, maxHeight: 260, overflow: 'auto', color: '#fca5a5'}}>{detail}</pre>
        <div style={{display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap'}}>
          <button style={btn('#7c5cff')} onClick={() => navigator.clipboard?.writeText(detail)}>
            Copiar erro
          </button>
          {reset && (
            <button style={btn('#2a2a36')} onClick={() => reset()}>
              Tentar de novo
            </button>
          )}
          <button style={btn('#2a2a36')} onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      </div>
    </div>
  );
}

const btn = (bg: string): React.CSSProperties => ({background: bg, color: '#fff', border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: 'pointer'});
