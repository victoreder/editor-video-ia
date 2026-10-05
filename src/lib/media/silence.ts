// Pausas e respiros medidos NO ÁUDIO (não na transcrição).
// O Whisper/Scribe "estica" as palavras e esconde pausas curtas; aqui o áudio é
// lido em janelas de 10 ms e cada janela vira fala ou não-fala com um limiar
// ADAPTATIVO: abaixo do nível da fala do próprio vídeo (p90) menos uma margem, ou
// perto do ruído de fundo (p10). Respiradas ficam ~25–35 dB abaixo da voz, então
// entram como "pausa" — que é exatamente o que queremos cortar.
import {spawn} from 'node:child_process';

export type Pause = {start: number; end: number; kind: 'silence' | 'breath'};
export type AudioAnalysis = {frameSec: number; db: number[]; speechDb: number; floorDb: number; threshold: number; pauses: Pause[]};

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const SR = 16000;

/** decodifica para PCM 16 kHz mono e devolve o nível (dBFS) a cada `frameSec` */
export function levels(file: string, frameSec = 0.01): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', '-']);
    const n = Math.round(SR * frameSec);
    const out: number[] = [];
    let carry: Buffer = Buffer.alloc(0);
    p.stdout.on('data', (d: Buffer) => {
      const buf: Buffer = carry.length ? Buffer.concat([carry, d]) : d;
      const bytes = n * 2;
      let off = 0;
      for (; off + bytes <= buf.length; off += bytes) {
        let s = 0;
        for (let i = 0; i < n; i++) {
          const v = buf.readInt16LE(off + i * 2) / 32768;
          s += v * v;
        }
        out.push(10 * Math.log10(s / n + 1e-10));
      }
      carry = buf.subarray(off);
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`ffmpeg saiu com ${code}`))));
  });
}

const pct = (arr: number[], p: number) => {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : -90;
};

/**
 * Cálculo puro (testável): níveis → pausas.
 * minPause: pausas menores que isso são o ritmo natural da fala e ficam.
 * marginDb: quanto abaixo da fala conta como "não-fala" (respiro incluído).
 */
export function findPauses(db: number[], frameSec = 0.01, opts: {minPause?: number; marginDb?: number} = {}): Omit<AudioAnalysis, 'db' | 'frameSec'> {
  const minPause = opts.minPause ?? 0.25;
  const marginDb = opts.marginDb ?? 26;
  const speechDb = pct(db, 90);
  const floorDb = pct(db, 10);
  // limiar: o maior entre (fala − margem) e (fundo + 6 dB), mas nunca acima de (fala − 10 dB)
  const threshold = Math.min(speechDb - 10, Math.max(speechDb - marginDb, floorDb + 6));
  // suaviza 30 ms para uma consoante curta não "quebrar" a fala
  const sm = db.map((_, i) => Math.max(db[i - 1] ?? -90, db[i], db[i + 1] ?? -90));
  const pauses: Pause[] = [];
  let i = 0;
  while (i < sm.length) {
    if (sm[i] >= threshold) {
      i++;
      continue;
    }
    let j = i;
    let peak = -90;
    while (j < sm.length && sm[j] < threshold) peak = Math.max(peak, sm[j++]);
    const start = i * frameSec;
    const end = j * frameSec;
    if (end - start >= minPause) pauses.push({start: +start.toFixed(3), end: +end.toFixed(3), kind: peak > floorDb + 8 ? 'breath' : 'silence'});
    i = j;
  }
  return {speechDb, floorDb, threshold, pauses};
}

export async function analyzeAudio(file: string, opts: {minPause?: number; marginDb?: number} = {}): Promise<AudioAnalysis> {
  const frameSec = 0.01;
  const db = await levels(file, frameSec);
  return {frameSec, db, ...findPauses(db, frameSec, opts)};
}
