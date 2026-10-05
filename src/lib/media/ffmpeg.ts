// ffmpeg/ffprobe: proxy de edição, extração de áudio, detecção de fala,
// normalização de loudness (−14 LUFS) e frames para análise.
import {spawn} from 'node:child_process';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

export function run(cmd: string, args: string[], onStderr?: (line: string) => void): Promise<{stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => {
      const s = String(d);
      stderr += s;
      if (stderr.length > 2e6) stderr = stderr.slice(-1e6);
      if (onStderr) s.split(/\r|\n/).forEach((l) => l && onStderr(l));
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({stdout, stderr}) : reject(new Error(`${cmd} saiu com ${code}: ${stderr.slice(-800)}`))));
  });
}

export type Probe = {duration: number; width: number; height: number; fps: number; hasAudio: boolean; rotation: number};

export async function probe(file: string): Promise<Probe> {
  let stdout: string;
  try {
    ({stdout} = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]));
  } catch (e) {
    // sem ffprobe instalado: lê as mesmas informações da saída do ffmpeg
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return probeWithFfmpeg(file);
    throw e;
  }
  return parseProbeJson(stdout);
}

/** fallback: `ffmpeg -i` imprime duração, resolução, fps, rotação e faixas no stderr */
export async function probeWithFfmpeg(file: string): Promise<Probe> {
  const stderr = await new Promise<string>((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-i', file], {stdio: ['ignore', 'ignore', 'pipe']});
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('ffmpeg não está instalado no servidor de processamento') : e));
    p.on('close', () => resolve(err)); // sem saída definida o ffmpeg sai com erro; o que importa é o stderr
  });
  return parseFfmpegInfo(stderr);
}

export function parseFfmpegInfo(stderr: string): Probe {
  const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
  const vLine = stderr.split('\n').find((l) => /Stream #.*Video:/.test(l)) ?? '';
  const size = vLine.match(/,\s*(\d{2,5})x(\d{2,5})/);
  const fps = vLine.match(/([\d.]+)\s*fps/) ?? vLine.match(/([\d.]+)\s*tbr/);
  const rot = stderr.match(/rotation of\s*(-?[\d.]+)\s*degrees/) ?? stderr.match(/rotate\s*:\s*(-?\d+)/);
  const rotation = Math.abs(Number(rot?.[1] ?? 0)) % 180;
  let width = size ? +size[1] : 0;
  let height = size ? +size[2] : 0;
  if (rotation === 90) [width, height] = [height, width];
  if (!duration || !width) throw new Error(`não consegui ler o vídeo: ${stderr.slice(-400)}`);
  return {duration, width, height, fps: Math.round(Number(fps?.[1] ?? 30)) || 30, hasAudio: /Stream #.*Audio:/.test(stderr), rotation};
}

function parseProbeJson(stdout: string): Probe {
  const j = JSON.parse(stdout) as {
    format: {duration?: string};
    streams: {codec_type: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string; tags?: {rotate?: string}; side_data_list?: {rotation?: number}[]}[];
  };
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const rate = (r?: string) => {
    if (!r) return 0;
    const [n, d] = r.split('/').map(Number);
    return d ? n / d : n;
  };
  const rotation = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0)) % 180;
  let width = v?.width ?? 0;
  let height = v?.height ?? 0;
  if (rotation === 90) [width, height] = [height, width];
  return {
    duration: Number(j.format.duration ?? v?.duration ?? 0),
    width,
    height,
    fps: Math.round(rate(v?.avg_frame_rate) || rate(v?.r_frame_rate) || 30),
    hasAudio: Boolean(a),
    rotation,
  };
}

const progressFrom = (total: number, cb?: (f: number) => void) => (line: string) => {
  const m = line.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
  if (m && cb && total > 0) cb(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / total));
};

/**
 * Proxy de edição: H.264 30 fps, GOP curto (seek rápido no preview), lado maior
 * até 1920, áudio AAC 48 kHz, faststart. É o arquivo usado no preview e no render.
 */
export async function makeProxy(input: string, output: string, duration: number, onProgress?: (f: number) => void) {
  await run(
    FFMPEG,
    [
      '-y', '-i', input,
      '-vf', "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',fps=30,format=yuv420p",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart', output,
    ],
    progressFrom(duration, onProgress),
  );
}

/**
 * Prévia leve só para o editor (o render usa o proxy em qualidade cheia): lado maior
 * 960 px, CRF 28, keyframe a cada 0,5 s (pular entre cortes é instantâneo) e
 * faststart (toca antes de baixar tudo). ~10x menor que o proxy.
 */
export async function makePreview(input: string, output: string, duration: number, onProgress?: (f: number) => void) {
  await run(
    FFMPEG,
    [
      '-y', '-i', input,
      '-vf', "scale='if(gt(iw,ih),min(960,iw),-2)':'if(gt(iw,ih),-2,min(960,ih))',format=yuv420p",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
      '-movflags', '+faststart', output,
    ],
    progressFrom(duration, onProgress),
  );
}

/** áudio mono 16 kHz em MP3 (pequeno, aceito por todas as APIs de transcrição) */
export async function extractAudio(input: string, output: string) {
  await run(FFMPEG, ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', output]);
}

/** trechos com fala (o inverso do silencedetect) */
export async function detectSpeech(input: string, duration: number, noiseDb = -32, minSilence = 0.35): Promise<{start: number; end: number}[]> {
  const {stderr} = await run(FFMPEG, ['-i', input, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`, '-f', 'null', '-']);
  const silences: {start: number; end: number}[] = [];
  let s: number | null = null;
  for (const line of stderr.split('\n')) {
    const a = line.match(/silence_start: (-?[\d.]+)/);
    const b = line.match(/silence_end: ([\d.]+)/);
    if (a) s = Math.max(0, Number(a[1]));
    if (b && s !== null) {
      silences.push({start: s, end: Number(b[1])});
      s = null;
    }
  }
  if (s !== null) silences.push({start: s, end: duration});
  const speech: {start: number; end: number}[] = [];
  let t = 0;
  for (const si of silences) {
    if (si.start - t > 0.15) speech.push({start: t, end: si.start});
    t = si.end;
  }
  if (duration - t > 0.15) speech.push({start: t, end: duration});
  return speech;
}

/** normaliza o loudness para −14 LUFS (padrão das redes) sem re-encodar o vídeo */
export async function loudnorm(input: string, output: string, lufs = -14) {
  await run(FFMPEG, ['-y', '-i', input, '-c:v', 'copy', '-af', `loudnorm=I=${lufs}:TP=-1.5:LRA=11`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', output]);
}

/** frames a cada `every` segundos, reduzidos, para rastrear rosto ou para a IA ver */
export async function sampleFrames(input: string, outDir: string, every = 0.5, width = 360) {
  await run(FFMPEG, ['-y', '-i', input, '-vf', `fps=${1 / every},scale=${width}:-2`, '-q:v', '5', `${outDir}/f_%05d.jpg`]);
}

export async function frameAt(input: string, t: number, output: string, width = 720) {
  await run(FFMPEG, ['-y', '-ss', String(Math.max(0, t)), '-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '3', output]);
}

/** energia (RMS) do áudio por janela: usada para escolher o frame mais expressivo, viral score etc. */
export async function loudnessCurve(input: string, windowSec = 0.5): Promise<number[]> {
  const {stderr} = await run(FFMPEG, ['-i', input, '-af', `astats=metadata=1:reset=${Math.max(1, Math.round(windowSec * 50))},ametadata=print:key=lavfi.astats.Overall.RMS_level`, '-f', 'null', '-']);
  return [...stderr.matchAll(/RMS_level=(-?[\d.inf]+)/g)].map((m) => (m[1].includes('inf') ? -90 : Number(m[1])));
}

export type RenderQa = {lufs: number | null; truePeak: number | null; black: Array<[number, number]>; freeze: Array<[number, number]>; silence: Array<[number, number]>; ok: boolean; notes: string[]};

/** QA do vídeo renderizado (fase 2): loudness, telas pretas, imagem congelada e silêncio longo */
export async function qaRendered(file: string): Promise<RenderQa> {
  const {stderr} = await run(FFMPEG, [
    '-hide_banner', '-nostats', '-i', file,
    '-vf', 'blackdetect=d=0.4:pix_th=0.08,freezedetect=n=0.002:d=2.5',
    '-af', 'ebur128=peak=true,silencedetect=n=-45dB:d=2',
    '-f', 'null', '-',
  ]);
  const pairs = (re: RegExp) => [...stderr.matchAll(re)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
  const black = pairs(/black_start:([\d.]+) black_end:([\d.]+)/g);
  const fs = [...stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const fe = [...stderr.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const freeze = fs.map((a, i) => [a, fe[i] ?? a] as [number, number]);
  const ss = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const se = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const silence = ss.map((a, i) => [a, se[i] ?? a] as [number, number]);
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const lufs = Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1] ?? NaN);
  const tp = Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1] ?? NaN);
  const notes: string[] = [];
  if (Number.isFinite(lufs) && Math.abs(lufs + 14) > 2) notes.push(`loudness ${lufs.toFixed(1)} LUFS (meta −14)`);
  if (Number.isFinite(tp) && tp > -0.5) notes.push(`pico ${tp.toFixed(1)} dBFS (risco de distorção)`);
  if (black.length) notes.push(`${black.length} trecho(s) de tela preta`);
  if (freeze.length) notes.push(`${freeze.length} trecho(s) de imagem congelada`);
  if (silence.length) notes.push(`${silence.length} silêncio(s) acima de 2 s`);
  return {lufs: Number.isFinite(lufs) ? lufs : null, truePeak: Number.isFinite(tp) ? tp : null, black, freeze, silence, ok: notes.length === 0, notes};
}
