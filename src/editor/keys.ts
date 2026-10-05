// Atalhos do editor (puro, testável). Portado de autobroll/editor/keys.ts (MIT).
//   Espaço play/pause · ←/→ 1 frame (Shift = 10) · Home/End · S dividir clipe
//   Delete/⌫ apagar seleção · Esc limpar seleção · ⌘Z/⌘⇧Z/⌘Y desfazer/refazer
export type KeyLike = {key: string; code?: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean};
export type KeyAction =
  | {type: 'toggle-play'}
  | {type: 'seek'; frame: number}
  | {type: 'split'}
  | {type: 'delete-selection'}
  | {type: 'escape'}
  | {type: 'undo'}
  | {type: 'redo'}
  | null;

export const isTypingTarget = (el: {tagName?: string; isContentEditable?: boolean} | null | undefined): boolean => {
  if (!el) return false;
  const tag = (el.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
};

export function resolveKey(e: KeyLike, ctx: {frame: number; totalFrames: number; targetIsFocusedButton?: boolean}): KeyAction {
  const mod = !!(e.metaKey || e.ctrlKey);
  const k = e.key;
  if (e.code === 'Space' || k === ' ') return ctx.targetIsFocusedButton ? null : {type: 'toggle-play'};
  if (mod && k.toLowerCase() === 'z') return e.shiftKey ? {type: 'redo'} : {type: 'undo'};
  if (mod && k.toLowerCase() === 'y') return {type: 'redo'};
  if (mod) return null;
  const last = Math.max(0, ctx.totalFrames - 1);
  const step = e.shiftKey ? 10 : 1;
  switch (k) {
    case 'ArrowLeft':
      return {type: 'seek', frame: Math.max(0, ctx.frame - step)};
    case 'ArrowRight':
      return {type: 'seek', frame: Math.min(last, ctx.frame + step)};
    case 'Home':
      return {type: 'seek', frame: 0};
    case 'End':
      return {type: 'seek', frame: last};
    case 'Delete':
    case 'Backspace':
      return {type: 'delete-selection'};
    case 'Escape':
      return {type: 'escape'};
    case 's':
    case 'S':
      return {type: 'split'};
    default:
      return null;
  }
}
