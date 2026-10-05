'use client';
// Preferências do usuário (só neste navegador): padrões do "Novo vídeo".
export type Prefs = {
  style?: string;
  director?: 'claude' | 'openai' | 'compare' | 'heuristic';
  platform?: string;
  aggressiveness?: 'gentle' | 'medium' | 'tight';
  removeMistakes?: boolean;
  music?: string;
  glossary?: string;
};

const KEY = 'ev:prefs';

export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Prefs;
    // compatibilidade: o último estilo usado ficava em ev:lastStyle
    const last = localStorage.getItem('ev:lastStyle');
    return {...(last ? {style: last} : {}), ...p};
  } catch {
    return {};
  }
}

export function savePrefs(patch: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify({...loadPrefs(), ...patch}));
  } catch {
    /* sem storage */
  }
}
