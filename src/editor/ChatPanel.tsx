'use client';
// Edição por chat (fase 3): peça mudanças em português; a IA devolve operações
// que o editor aplica (com desfazer). Sem chave, entende comandos simples.
import {useEffect, useRef, useState} from 'react';
import {api} from '../lib/client/api';
import type {EditPlan} from '../lib/plan/schema';
import {useEditor} from './store';
import {Icon, Spinner} from '../components/ui/Icon';

type Msg = {role: 'user' | 'assistant'; text: string};
const EXAMPLES = ['deixa a legenda maior', 'coloca um número 87% quando eu falo do resultado', 'tira o B-roll do começo', 'gancho: O ERRO QUE TODO MUNDO COMETE', 'música mais baixa', 'muda pro estilo pop'];

export function ChatPanel() {
  const projectId = useEditor((s) => s.projectId);
  const variant = useEditor((s) => s.variant);
  const [msgs, setMsgs] = useState<Msg[]>([{role: 'assistant', text: 'Me diga o que mudar no vídeo. Ex.: "deixa a legenda maior", "tira os zooms do final", "coloca confete quando eu falo que consegui".'}]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  // chaves: o Chrome novo devolve uma Promise no scrollIntoView, e o React trataria
  // esse retorno como função de limpeza ("i is not a function" ao trocar de aba/enviar)
  useEffect(() => {
    end.current?.scrollIntoView({behavior: 'smooth'});
  }, [msgs]);

  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    setText('');
    setMsgs((m) => [...m, {role: 'user', text: message}]);
    setBusy(true);
    try {
      const plan = useEditor.getState().plan!;
      const r = await api<{plan: EditPlan; reply: string; applied: number; skipped?: string[]; engine: string}>(`/api/projects/${projectId}/plans/${variant}/chat`, {
        method: 'POST',
        json: {plan, message, history: msgs.slice(-6)},
      });
      if (r.applied > 0) useEditor.getState().apply(() => r.plan);
      const skipped = r.skipped?.length ? ` · ${r.skipped.length} parte${r.skipped.length > 1 ? 's' : ''} do pedido não deu para aplicar` : '';
      setMsgs((m) => [...m, {role: 'assistant', text: `${r.reply}${r.applied ? ` (${r.applied} alteração${r.applied > 1 ? 'ões' : ''} — ⌘Z desfaz)` : ''}${skipped}`}]);
    } catch (e) {
      setMsgs((m) => [...m, {role: 'assistant', text: `Erro: ${e instanceof Error ? e.message : String(e)}`}]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto pb-3">
        {msgs.map((m, i) => (
          <div key={i} className={`animate-fade-in rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === 'user' ? 'ml-8 rounded-br-md bg-brand text-white' : 'mr-8 rounded-bl-md border border-line bg-panel2'}`}>
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="mr-8 flex items-center gap-2 rounded-2xl rounded-bl-md border border-line bg-panel2 px-3.5 py-2 text-sm text-muted">
            <Spinner size={14} className="text-brand" /> Editando…
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {EXAMPLES.map((e) => (
          <button key={e} className="rounded-full border border-line bg-panel2 px-2.5 py-1 text-[11px] text-muted transition hover:border-line2 hover:text-text" onClick={() => send(e)} disabled={busy}>
            {e}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="O que mudar?" disabled={busy} />
        <button className="btn-primary px-2.5" disabled={busy || !text.trim()} title="Enviar">
          <Icon name="send" />
        </button>
      </form>
    </div>
  );
}
