// MusicGen (fase 2): trilha gerada por IA no tamanho exato do vídeo.
//   ElevenLabsMusic — API de música da ElevenLabs (mesma chave do Scribe)
//   SynthMusic      — fallback local, sintetizado (sem chave, sem licença)
import fs from 'node:fs/promises';
import {config} from '../../config';
import {writeMusicMp3} from '../../media/music-synth';

export interface MusicGen {
  readonly id: string;
  /** grava um MP3 em `out` com ~`seconds` segundos */
  generate(prompt: string, seconds: number, out: string, mood: 'upbeat' | 'calm' | 'cinematic'): Promise<void>;
}

export class ElevenLabsMusic implements MusicGen {
  readonly id = 'elevenlabs-music';
  async generate(prompt: string, seconds: number, out: string) {
    const r = await fetch('https://api.elevenlabs.io/v1/music', {
      method: 'POST',
      headers: {'xi-api-key': config.keys.elevenlabs, 'Content-Type': 'application/json', Accept: 'audio/mpeg'},
      body: JSON.stringify({
        prompt: `${prompt}. Instrumental, no vocals, background music for a talking-head social video, steady energy, no abrupt drops.`,
        music_length_ms: Math.round(Math.min(300, Math.max(10, seconds)) * 1000),
        model_id: process.env.ELEVENLABS_MUSIC_MODEL ?? 'music_v1',
      }),
    });
    if (!r.ok) throw new Error(`ElevenLabs music ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await fs.writeFile(out, Buffer.from(await r.arrayBuffer()));
  }
}

export class SynthMusic implements MusicGen {
  readonly id = 'synth';
  async generate(_prompt: string, seconds: number, out: string, mood: 'upbeat' | 'calm' | 'cinematic') {
    writeMusicMp3(mood, out, seconds);
  }
}

export const MOOD_PROMPTS: Record<'upbeat' | 'calm' | 'cinematic', string> = {
  upbeat: 'upbeat energetic modern electronic pop, driving beat, 118 bpm',
  calm: 'calm lo-fi chill hop, soft electric piano, relaxed groove, 84 bpm',
  cinematic: 'cinematic inspiring ambient, swelling strings and soft piano, 72 bpm',
};

export function getMusicGen(): MusicGen {
  return config.keys.elevenlabs && process.env.MUSIC_AI !== '0' ? new ElevenLabsMusic() : new SynthMusic();
}
