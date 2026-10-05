// Troca os efeitos sintetizados (public/sfx/*.wav) por GRAVAÇÕES REAIS do Mixkit
// (licença gratuita do Mixkit, uso comercial liberado). Mesmo método do
// ghost-editor/sfx_fetch.py (codigo-base/08-som-musica), que explica por que os
// sons sintetizados soam "baratos": são bipes de seno, nada parecido com um whoosh real.
//
//   npm run sfx:fetch            (precisa de ffmpeg e internet)
//
// Cada arquivo é cortado, normalizado em −1 dBFS e alinhado para o PICO cair no
// mesmo ponto que o código espera (SFX_LEAD em src/lib/modules/sfx.ts): o whoosh
// "passa" exatamente quando a cena entra. Se algo falhar, o som sintetizado fica.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {SFX_LEAD} from '../src/lib/modules/sfx';
import type {SfxKind} from '../src/lib/plan/schema';

const OUT = path.resolve('public/sfx');
const SR = 48000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// kind → [categoria do Mixkit, padrões de título em ordem de preferência (um por variação), duração máx.]
const KIT: Record<SfxKind, {cat: string[]; patterns: RegExp[]; max: number}> = {
  whoosh: {cat: ['whoosh', 'transition'], patterns: [/^Fast whoosh transition$/i, /^Air woosh$/i, /^Arrow whoosh$/i, /whoosh/i], max: 0.9},
  swoosh: {cat: ['whoosh', 'transition'], patterns: [/swoosh|swish/i, /quick|short|fast/i, /whoosh/i], max: 0.6},
  pop: {cat: ['pop', 'bubbles'], patterns: [/bubble pop/i, /^Hard pop click$/i, /pop/i], max: 0.4},
  click: {cat: ['click', 'interface'], patterns: [/mouse/i, /click/i, /tap|button/i], max: 0.25},
  impact: {cat: ['impact', 'hit'], patterns: [/cinematic.*(hit|impact|boom)/i, /(hit|impact|thud)/i, /boom/i], max: 1.2},
  riser: {cat: ['cinematic', 'riser'], patterns: [/riser|rising|build/i, /swell|tension/i], max: 2.0},
  sparkle: {cat: ['magic', 'notification'], patterns: [/sparkle|shimmer|magic/i, /chime|twinkle/i], max: 0.9},
  ding: {cat: ['notification', 'bell'], patterns: [/correct|success|positive/i, /ding|bell/i], max: 1.0},
  glitch: {cat: ['glitch'], patterns: [/^Glitch short$/i, /glitch/i], max: 0.5},
  typing: {cat: ['typing', 'keyboard'], patterns: [/typing/i, /keyboard|keys/i], max: 1.0},
};

async function fetchText(url: string) {
  const r = await fetch(url, {headers: {'User-Agent': UA}});
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

const pages = new Map<string, Array<{id: string; title: string}>>();
async function candidates(cat: string) {
  if (pages.has(cat)) return pages.get(cat)!;
  const items: Array<{id: string; title: string}> = [];
  for (const page of [1, 2]) {
    try {
      const html = await fetchText(`https://mixkit.co/free-sound-effects/${cat}/${page > 1 ? `?page=${page}` : ''}`);
      // card a card: o título fica DEPOIS da URL do preview dentro do mesmo card
      for (const card of html.split('class="item-grid-card ').slice(1)) {
        const id = card.match(/sfx\/(\d+)\/\1-preview\.mp3/)?.[1];
        const title = card.match(/item-grid-card__title">\s*([^<]+?)\s*<\/h2>/)?.[1];
        if (id && title && !items.some((x) => x.id === id)) items.push({id, title: title.trim()});
      }
    } catch {
      break;
    }
  }
  pages.set(cat, items);
  return items;
}

/** decodifica para PCM mono float, corta o silêncio do início e alinha o pico em `lead` segundos */
export function prepare(mp3: Buffer, lead: number, max: number): Float32Array {
  const tmp = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'sfx-')), 'in.mp3');
  fs.writeFileSync(tmp, mp3);
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', tmp, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], {maxBuffer: 64 * 1024 * 1024});
  fs.rmSync(path.dirname(tmp), {recursive: true, force: true});
  const pcm = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  let peak = 0;
  let peakAt = 0;
  // o pico procurado é o do começo do som (os primeiros 1,5 s), não um eco no fim
  for (let i = 0; i < Math.min(pcm.length, SR * 1.5); i++) {
    const v = Math.abs(pcm[i]);
    if (v > peak) {
      peak = v;
      peakAt = i;
    }
  }
  if (peak < 1e-4) throw new Error('arquivo sem som');
  // o início real do som: primeira amostra acima de −40 dB do pico
  let onset = 0;
  while (onset < peakAt && Math.abs(pcm[onset]) < peak * 0.01) onset++;
  const leadSamples = Math.round(lead * SR);
  const start = Math.max(onset, peakAt - leadSamples); // nunca começa antes do som (sem silêncio extra)
  const pad = Math.max(0, leadSamples - (peakAt - start)); // se o som "sobe" mais rápido que o lead, completa com silêncio
  const len = Math.min(Math.round(max * SR), pad + pcm.length - start);
  const out = new Float32Array(len);
  const g = 0.89 / peak; // −1 dBFS
  for (let i = pad; i < len; i++) out[i] = (pcm[start + i - pad] ?? 0) * g;
  // fade de saída de 20 ms (sem clique ao cortar)
  const f = Math.min(len, Math.round(0.02 * SR));
  for (let i = 0; i < f; i++) out[len - 1 - i] *= i / f;
  return out;
}

function writeWav(file: string, data: Float32Array) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  fs.writeFileSync(file, buf);
}

async function main() {
  const manifest: Record<string, {source: string; licence: string}> = {};
  const used = new Set<string>();
  let ok = 0;
  let failed = 0;
  for (const [kind, spec] of Object.entries(KIT) as Array<[SfxKind, (typeof KIT)[SfxKind]]>) {
    const cands = (await Promise.all(spec.cat.map(candidates))).flat();
    for (let v = 0; v < 3; v++) {
      const file = `${kind}${v ? `-${v + 1}` : ''}.wav`;
      // um padrão por variação; se acabar, qualquer título dos padrões que ainda não foi usado
      const pats = [spec.patterns[Math.min(v, spec.patterns.length - 1)], ...spec.patterns];
      const pick = pats.map((re) => cands.find((c) => !used.has(c.id) && re.test(c.title))).find(Boolean);
      if (!pick) {
        console.warn(`-    ${file}: nenhum som do Mixkit encontrado (fica o sintetizado)`);
        failed++;
        continue;
      }
      try {
        const r = await fetch(`https://assets.mixkit.co/active_storage/sfx/${pick.id}/${pick.id}-preview.mp3`, {headers: {'User-Agent': UA}});
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const pcm = prepare(Buffer.from(await r.arrayBuffer()), SFX_LEAD[kind], spec.max);
        writeWav(path.join(OUT, file), pcm);
        used.add(pick.id);
        manifest[file] = {source: `https://mixkit.co/free-sound-effects/ #${pick.id} ${pick.title}`, licence: 'Mixkit Free Sound Effects License'};
        console.log(`ok   ${file.padEnd(14)} ${pick.title}`);
        ok++;
      } catch (e) {
        console.warn(`-    ${file}: ${String(e).slice(0, 160)} (fica o sintetizado)`);
        failed++;
      }
    }
  }
  if (ok) fs.writeFileSync(path.join(OUT, 'SOURCES.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n${ok} sons reais, ${failed} mantidos sintetizados`);
}

// só roda quando chamado direto (npm run sfx:fetch), não quando importado nos testes
if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'fetch-sfx.ts'))) {
  main().catch((e) => {
    // nunca derruba o job: sem internet/ffmpeg, os sons sintetizados continuam valendo
    console.warn('sfx:fetch falhou:', String(e).slice(0, 300));
  });
}
