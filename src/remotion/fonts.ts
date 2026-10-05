// Fontes OFL empacotadas com o app (public/fonts, vindas do @fontsource) — o render
// não depende do Google Fonts. A Montra do motion-script NÃO é redistribuível;
// usamos Montserrat, Inter e Anton.
import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';

const FAMILIES: Record<string, string> = {
  Montserrat: '"Montserrat", system-ui, sans-serif',
  Inter: '"Inter", system-ui, sans-serif',
  Anton: '"Anton", Impact, sans-serif',
};

const RANGES = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
};

const FILES: Array<[family: string, file: string, weights: string[]]> = [
  ['Montserrat', 'montserrat', ['600', '700', '800', '900']],
  ['Inter', 'inter', ['400', '500', '700', '800']],
  ['Anton', 'anton', ['400']],
];

let loaded = false;
export function ensureFonts() {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  for (const [family, file, weights] of FILES)
    for (const weight of weights)
      for (const sub of ['latin', 'latin-ext'] as const)
        loadFont({family, weight, url: staticFile(`fonts/${file}-${sub}-${weight}-normal.woff2`), unicodeRange: RANGES[sub], format: 'woff2'}).catch(() => undefined);
}

export const fontStack = (name: string) => FAMILIES[name] ?? `"${name}", system-ui, sans-serif`;
