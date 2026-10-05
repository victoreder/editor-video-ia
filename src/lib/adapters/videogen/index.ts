// VideoGen (fase 3): B-roll em vídeo gerado por IA, via Replicate (modelo configurável).
// Assíncrono: cria a predição e consulta até terminar. Usado só quando o banco de
// vídeos e a biblioteca própria não têm nada (BROLL_AI_VIDEO=1), porque é caro.
import {config} from '../../config';

export interface VideoGen {
  readonly id: string;
  generate(prompt: string, aspect: '9:16' | '16:9' | '1:1', seconds: number): Promise<Buffer>;
}

export class ReplicateVideo implements VideoGen {
  readonly id = 'replicate-video';
  constructor(private model = process.env.REPLICATE_VIDEO_MODEL ?? 'minimax/video-01') {}
  async generate(prompt: string, aspect: '9:16' | '16:9' | '1:1', seconds: number) {
    const headers = {Authorization: `Bearer ${config.keys.replicate}`, 'Content-Type': 'application/json'};
    const create = await fetch(`https://api.replicate.com/v1/models/${this.model}/predictions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({input: {prompt: `${prompt}. Realistic, cinematic stock footage, no text, no logos.`, aspect_ratio: aspect, duration: Math.min(10, Math.max(3, Math.round(seconds)))}}),
    });
    let pred = (await create.json()) as {id?: string; status?: string; output?: string | string[]; error?: string; urls?: {get: string}};
    if (!create.ok || !pred.urls) throw new Error(`Replicate: ${pred.error ?? create.status}`);
    const deadline = Date.now() + 8 * 60 * 1000;
    while (pred.status !== 'succeeded') {
      if (pred.status === 'failed' || pred.status === 'canceled' || Date.now() > deadline) throw new Error(`Replicate: ${pred.error ?? pred.status}`);
      await new Promise((r) => setTimeout(r, 4000));
      pred = (await (await fetch(pred.urls!.get, {headers})).json()) as typeof pred;
    }
    const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    if (!url) throw new Error('Replicate não devolveu vídeo');
    return Buffer.from(await (await fetch(url)).arrayBuffer());
  }
}

export function getVideoGen(): VideoGen | null {
  return config.keys.replicate && process.env.BROLL_AI_VIDEO === '1' ? new ReplicateVideo() : null;
}
