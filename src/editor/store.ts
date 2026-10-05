'use client';
// Estado do editor (zustand) com desfazer/refazer por snapshot do plano inteiro.
// Baseado em autobroll/editor/store.ts (MIT), ampliado para o EditPlan completo.
import {create} from 'zustand';
import type {EditPlan} from '../lib/plan/schema';
import {finalize} from '../lib/pipeline/plan-builder';
import type {Selection} from './ops';

const HISTORY = 100;

type EditorState = {
  projectId: string;
  variant: string;
  plan: EditPlan | null;
  media: Record<string, string>;
  past: EditPlan[];
  future: EditPlan[];
  selected: Selection;
  frame: number;
  dirty: boolean;
  saving: boolean;
  lastSaved: number | null;
  pxPerSec: number;
  init: (projectId: string, variant: string, plan: EditPlan, media: Record<string, string>) => void;
  /** aplica uma edição. history=false para gestos contínuos (arrastar) — chame pushHistory() no início */
  apply: (fn: (p: EditPlan) => EditPlan, opts?: {history?: boolean; refresh?: boolean}) => void;
  pushHistory: () => void;
  /** recalcula posições de legenda/cards e SFX automáticos (após mudanças estruturais) */
  refresh: () => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  setFrame: (f: number) => void;
  setMedia: (m: Record<string, string>) => void;
  setPxPerSec: (n: number) => void;
  markSaved: () => void;
  setSaving: (b: boolean) => void;
};

const safeFinalize = (p: EditPlan) => {
  try {
    return finalize(p);
  } catch (e) {
    console.warn('finalize falhou', e);
    return p;
  }
};

export const useEditor = create<EditorState>((set, get) => ({
  projectId: '',
  variant: '',
  plan: null,
  media: {},
  past: [],
  future: [],
  selected: null,
  frame: 0,
  dirty: false,
  saving: false,
  lastSaved: null,
  pxPerSec: 80,
  init: (projectId, variant, plan, media) => set({projectId, variant, plan, media, past: [], future: [], selected: null, frame: 0, dirty: false}),
  apply: (fn, opts = {}) => {
    const {plan, past} = get();
    if (!plan) return;
    let next = fn(plan);
    if (next === plan) return;
    if (opts.refresh) next = safeFinalize(next);
    set({plan: next, dirty: true, ...(opts.history === false ? {} : {past: [...past, plan].slice(-HISTORY), future: []})});
  },
  pushHistory: () => {
    const {plan, past} = get();
    if (plan) set({past: [...past, plan].slice(-HISTORY), future: []});
  },
  refresh: () => {
    const {plan} = get();
    if (plan) set({plan: safeFinalize(plan), dirty: true});
  },
  undo: () => {
    const {past, plan, future} = get();
    if (!past.length || !plan) return;
    set({plan: past[past.length - 1], past: past.slice(0, -1), future: [plan, ...future], dirty: true});
  },
  redo: () => {
    const {past, plan, future} = get();
    if (!future.length || !plan) return;
    set({plan: future[0], future: future.slice(1), past: [...past, plan], dirty: true});
  },
  select: (selected) => set({selected}),
  setFrame: (frame) => set({frame}),
  setMedia: (media) => set({media}),
  setPxPerSec: (pxPerSec) => set({pxPerSec: Math.max(15, Math.min(400, pxPerSec))}),
  markSaved: () => set({dirty: false, saving: false, lastSaved: Date.now()}),
  setSaving: (saving) => set({saving}),
}));
