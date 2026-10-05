// Estilos (módulo 10). Um estilo é um JSON com paleta, fontes, legenda, câmera,
// transições, densidade de gráficos/B-roll, SFX e música. Formato baseado no
// kamgasimo/styles/dynamic.json e nos 7 estilos do ghost-editor (MIT).
// Imports relativos: também é usado dentro do bundle do Remotion.
import type {StyleConfig, StyleId} from '../plan/schema';

export type {StyleConfig};

export const BUILTIN_STYLE_IDS = ['dynamic', 'clean', 'pop', 'minimal'] as const;

export const STYLES: Record<(typeof BUILTIN_STYLE_IDS)[number], StyleConfig> = {
  dynamic: {
    id: 'dynamic',
    name: 'Dynamic creator',
    summary: 'Legendas em caixa alta com palavra-chave amarela, algo muda na tela a cada 2–4 s, snap zooms, transições whip/zoom e sound design denso.',
    palette: {text: '#FFFFFF', accent: '#7C5CFF', key: '#FFD400', panel: '#15123A', panelText: '#FFFFFF', bg: '#0A0A18', muted: '#B9B4E6'},
    fonts: {display: 'Montserrat', body: 'Inter', displayWeight: 900},
    captions: {preset: 'bold-pop', uppercase: true, maxWords: 3, sizePx: 84, emphasisRate: 0.12, emojiEvery: 8},
    camera: {levels: [1.0, 1.12, 1.2], push: 0.06, punchScale: [1.3, 1.42], punchEvery: 5, maxZoom: 1.45, shake: true},
    transitions: {set: ['whip', 'zoom', 'flash', 'glitch'], minGap: 8, duration: 0.24},
    graphics: {coverage: [0.25, 0.6], perMinute: 6},
    broll: {perMinute: 7, templates: ['card', 'split', 'takeover', 'pip']},
    maxStatic: 4,
    sfx: {density: 'high', transition: ['whoosh', 'swoosh'], enter: 'pop', punch: 'impact', hook: 'riser'},
    music: {mood: 'upbeat', volume: 0.16},
    grade: 'punchy',
    hook: true,
    cta: 'SIGA PARA MAIS',
    progress: true,
  },
  clean: {
    id: 'clean',
    name: 'Clean premium',
    summary: 'Visual limpo e elegante: legenda em pílula escura, zooms suaves, poucas transições, cards de vidro e som discreto.',
    palette: {text: '#FFFFFF', accent: '#4F8CFF', key: '#8FB8FF', panel: 'rgba(16,18,24,0.88)', panelText: '#F5F7FA', bg: '#0E1116', muted: '#9AA4B2'},
    fonts: {display: 'Inter', body: 'Inter', displayWeight: 800},
    captions: {preset: 'pill', uppercase: false, maxWords: 4, sizePx: 64, emphasisRate: 0.08, emojiEvery: 0},
    camera: {levels: [1.0, 1.08, 1.14], push: 0.05, punchScale: [1.18, 1.26], punchEvery: 8, maxZoom: 1.3, shake: false},
    transitions: {set: ['blur', 'zoom'], minGap: 12, duration: 0.3},
    graphics: {coverage: [0.15, 0.4], perMinute: 4},
    broll: {perMinute: 5, templates: ['card', 'split', 'pip']},
    maxStatic: 6,
    sfx: {density: 'low', transition: ['swoosh'], enter: 'click', punch: null, hook: null},
    music: {mood: 'calm', volume: 0.14},
    grade: 'clean',
    hook: false,
    cta: null,
    progress: false,
  },
  pop: {
    id: 'pop',
    name: 'Pop',
    summary: 'Colorido e divertido: karaokê com palavra ativa colorida, emojis frequentes, stickers e efeitos sonoros de pop.',
    palette: {text: '#FFFFFF', accent: '#FF3D7F', key: '#00E5FF', panel: '#FFFFFF', panelText: '#111111', bg: '#1A0B2E', muted: '#FFD1E3'},
    fonts: {display: 'Anton', body: 'Montserrat', displayWeight: 400},
    captions: {preset: 'karaoke', uppercase: true, maxWords: 3, sizePx: 88, emphasisRate: 0.15, emojiEvery: 4},
    camera: {levels: [1.0, 1.15, 1.25], push: 0.06, punchScale: [1.32, 1.45], punchEvery: 4, maxZoom: 1.48, shake: true},
    transitions: {set: ['flash', 'zoom', 'whip'], minGap: 7, duration: 0.2},
    graphics: {coverage: [0.25, 0.65], perMinute: 7},
    broll: {perMinute: 6, templates: ['card', 'takeover', 'split']},
    maxStatic: 3.5,
    sfx: {density: 'high', transition: ['whoosh'], enter: 'pop', punch: 'impact', hook: 'sparkle'},
    music: {mood: 'upbeat', volume: 0.17},
    grade: 'punchy',
    hook: true,
    cta: 'SEGUE AÍ 👉',
    progress: true,
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    summary: 'Discreto e editorial: legenda em minúsculas, quase sem gráficos, cortes secos e só o essencial de som.',
    palette: {text: '#FFFFFF', accent: '#E8E2D0', key: '#F2C14E', panel: 'rgba(0,0,0,0.55)', panelText: '#FFFFFF', bg: '#111111', muted: '#CFCFCF'},
    fonts: {display: 'Inter', body: 'Inter', displayWeight: 700},
    captions: {preset: 'editorial', uppercase: false, maxWords: 4, sizePx: 60, emphasisRate: 0.05, emojiEvery: 0},
    camera: {levels: [1.0, 1.06], push: 0.03, punchScale: [1.12, 1.18], punchEvery: 12, maxZoom: 1.2, shake: false},
    transitions: {set: ['cut'], minGap: 20, duration: 0.2},
    graphics: {coverage: [0.05, 0.2], perMinute: 2},
    broll: {perMinute: 3, templates: ['card', 'split']},
    maxStatic: 8,
    sfx: {density: 'low', transition: [], enter: 'click', punch: null, hook: null},
    music: {mood: 'calm', volume: 0.12},
    grade: 'film',
    hook: false,
    cta: null,
    progress: false,
  },
};

export const isBuiltinStyle = (id: string): id is (typeof BUILTIN_STYLE_IDS)[number] => (BUILTIN_STYLE_IDS as readonly string[]).includes(id);

/** estilo pronto pelo id (estilos próprios vêm no plano: use styleOf) */
export const getStyle = (id: StyleId | undefined): StyleConfig => (id && isBuiltinStyle(id) ? STYLES[id] : STYLES.dynamic);

/** o estilo efetivo de um plano: a cópia do estilo próprio, se houver, senão o pronto */
export const styleOf = (plan: {style: StyleId; styleConfig?: StyleConfig}): StyleConfig => plan.styleConfig ?? getStyle(plan.style);

export const STYLE_LIST = Object.values(STYLES);
