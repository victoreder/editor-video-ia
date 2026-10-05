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
  const {stdout} = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
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
