// Transcriber: ElevenLabs Scribe (padrão) | OpenAI whisper-1 | Groq whisper |
// ScriptAligner (sem API: distribui o roteiro colado nos trechos de fala).
// Todos devolvem palavras com tempo (a legenda karaokê precisa disso).
// gpt-4o-transcribe NÃO devolve tempo por palavra, por isso a OpenAI usa whisper-1.
import fs from 'node:fs';
import {config} from '../../config';
import {detectSpeech} from '../../media/ffmpeg';

export type RawWord = {text: string; start: number; end: number; speaker?: string};
export type Transcript = {engine: string; words: RawWord[]; events: {text: string; start: number; end: number}[]; language?: string};

export interface Transcriber {
  readonly id: string;
  transcribe(audioPath: string, opts: {language?: string; script?: string; duration: number}): Promise<Transcript>;
}

/** devolve a pontuação do texto completo às palavras do Whisper (que vêm sem ela) */
export function restorePunctuation(words: RawWord[], fullText: string): RawWord[] {
  const toks = fullText.split(/\s+/).filter(Boolean);
  const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  let j = 0;
  return words.map((w) => {
    for (let k = j; k < Math.min(toks.length, j + 4); k++) {
      if (n(toks[k]) === n(w.text)) {
        j = k + 1;
        return {...w, text: toks[k]};
      }
    }
    return w;
  });
}

export class ElevenLabsScribe implements Transcriber {
  readonly id = 'elevenlabs';
  async transcribe(audioPath: string, opts: {language?: string}): Promise<Transcript> {
    const form = new FormData();
    form.append('model_id', process.env.ELEVENLABS_STT_MODEL ?? 'scribe_v1');
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'true');
    form.append('diarize', 'false');
    if (opts.language) form.append('language_code', opts.language);
    form.append('file', new Blob([fs.readFileSync(audioPath)]), 'audio.mp3');
    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {method: 'POST', headers: {'xi-api-key': config.keys.elevenlabs}, body: form});
    if (!r.ok) throw new Error(`ElevenLabs Scribe ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const raw = (await r.json()) as {language_code?: string; words?: {type: string; text: string; start: number; end: number; speaker_id?: string}[]};
    const words: RawWord[] = [];
    const events: Transcript['events'] = [];
    for (const w of raw.words ?? []) {
      if (w.type === 'word') words.push({text: w.text.trim(), start: w.start, end: w.end, speaker: w.speaker_id});
      else if (w.type === 'audio_event') events.push({text: w.text, start: w.start, end: w.end});
    }
    return {engine: 'elevenlabs-scribe', words: words.filter((w) => w.text), events, language: raw.language_code};
  }
}

class WhisperCompatible implements Transcriber {
  constructor(
    readonly id: string,
    private apiKey: string,
    private model: string,
    private baseURL?: string,
  ) {}
  async transcribe(audioPath: string, opts: {language?: string}): Promise<Transcript> {
    const {default: OpenAI, toFile} = await import('openai');
    const client = new OpenAI({apiKey: this.apiKey, baseURL: this.baseURL});
    const res = (await client.audio.transcriptions.create({
      file: await toFile(fs.createReadStream(audioPath), 'audio.mp3'),
      model: this.model,
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
      language: opts.language?.slice(0, 2),
    })) as unknown as {text: string; language?: string; words?: {word: string; start: number; end: number}[]};
    const words = (res.words ?? []).map((w) => ({text: w.word.trim(), start: w.start, end: w.end})).filter((w) => w.text);
    return {engine: this.id, words: restorePunctuation(words, res.text ?? ''), events: [], language: res.language};
  }
}

export class OpenAIWhisper extends WhisperCompatible {
  constructor() {
    super('openai-whisper', config.keys.openai, 'whisper-1');
  }
}
export class GroqWhisper extends WhisperCompatible {
  constructor() {
    super('groq-whisper', config.keys.groq, process.env.GROQ_STT_MODEL ?? 'whisper-large-v3-turbo', 'https://api.groq.com/openai/v1');
  }
}

/**
 * Sem API: o roteiro colado é distribuído pelos trechos de fala detectados pelo
 * ffmpeg (silencedetect), proporcional ao tamanho de cada palavra. Bom para
 * testar e para quem grava lendo roteiro; a precisão é menor que a do Scribe.
 */
export class ScriptAligner implements Transcriber {
  readonly id = 'script';
  async transcribe(audioPath: string, opts: {script?: string; duration: number}): Promise<Transcript> {
    const tokens = (opts.script ?? '').split(/\s+/).filter(Boolean);
    if (!tokens.length) return {engine: 'script', words: [], events: []};
    let regions = await detectSpeech(audioPath, opts.duration);
    if (!regions.length) regions = [{start: 0, end: opts.duration}];
    const total = regions.reduce((n, r) => n + (r.end - r.start), 0);
    const weight = (t: string) => Math.max(2, t.replace(/[^\p{L}\p{N}]/gu, '').length) + (/[.!?]$/.test(t) ? 3 : /[,;:]$/.test(t) ? 1.5 : 0);
    const totalW = tokens.reduce((n, t) => n + weight(t), 0);
    // cada região recebe palavras proporcionais à sua duração (frases não quebram no meio, se possível)
    const words: RawWord[] = [];
    let ti = 0;
    regions.forEach((r, ri) => {
      const isLast = ri === regions.length - 1;
      const share = ((r.end - r.start) / total) * totalW;
      const chunk: string[] = [];
      let acc = 0;
      while (ti < tokens.length && (isLast || acc + weight(tokens[ti]) * 0.5 <= share || !chunk.length)) {
        acc += weight(tokens[ti]);
        chunk.push(tokens[ti++]);
      }
      const cw = chunk.reduce((n, t) => n + weight(t), 0);
      let t = r.start;
      for (const tok of chunk) {
        const d = ((r.end - r.start) * weight(tok)) / cw;
        words.push({text: tok, start: +t.toFixed(3), end: +(t + d * 0.92).toFixed(3)});
        t += d;
      }
    });
    return {engine: 'script-aligner', words, events: []};
  }
}

export function getTranscriber(id?: string): Transcriber {
  const want = id || config.transcriber || (config.keys.elevenlabs ? 'elevenlabs' : config.keys.groq ? 'groq' : config.keys.openai ? 'openai' : 'script');
  switch (want) {
    case 'elevenlabs':
      if (config.keys.elevenlabs) return new ElevenLabsScribe();
      break;
    case 'openai':
      if (config.keys.openai) return new OpenAIWhisper();
      break;
    case 'groq':
      if (config.keys.groq) return new GroqWhisper();
      break;
  }
  return new ScriptAligner();
}
