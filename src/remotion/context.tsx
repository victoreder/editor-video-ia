import React, {createContext, useContext} from 'react';
import {staticFile} from 'remotion';
import type {EditPlan} from '../lib/plan/schema';
import type {StyleConfig} from '../lib/styles';

export type ReelCtx = {
  plan: EditPlan;
  style: StyleConfig;
  /** chave do storage → URL acessível (o player usa URLs públicas; o render, URLs internas) */
  resolve: (key: string | undefined) => string | undefined;
  /** destaca o item selecionado no editor (contorno), nunca no render */
  selectedId?: string | null;
};

const Ctx = createContext<ReelCtx | null>(null);
export const ReelProvider = Ctx.Provider;
export function useReel(): ReelCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useReel fora do ReelProvider');
  return v;
}

export const makeResolver = (media: Record<string, string> | undefined) => (key: string | undefined) => {
  if (!key) return undefined;
  // o mapa vale também para chaves que já são URLs (Blob: link assinado / prévia leve)
  if (media?.[key]) return media[key];
  if (/^(https?:|data:|blob:)/.test(key)) return key;
  // arquivos que vêm com o app (public/): trilhas e sons sintetizados
  if (key.startsWith('builtin:')) return staticFile(key.slice('builtin:'.length));
  return media?.[key] ?? key;
};

export const Selectable: React.FC<{id: string; children: React.ReactNode; style?: React.CSSProperties}> = ({id, children, style}) => {
  const {selectedId} = useReel();
  return (
    <div data-item={id} style={{...style, outline: selectedId === id ? '4px dashed #22d3ee' : undefined, outlineOffset: 6}}>
      {children}
    </div>
  );
};
