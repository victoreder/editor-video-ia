// ImageGen: OpenAIImages | ReplicateFlux. Usado para B-roll gerado (F2) quando o
// banco de vídeos não tem algo específico o bastante.
import {config} from '../../config';

export interface ImageGen {
  readonly id: string;
  generate(prompt: string, size: {width: number; height: number}): Promise<Buffer>;
}

export class OpenAIImages implements ImageGen {
  readonly id = 'openai';
  async generate(prompt: string, size: {width: number; height: number}) {
    const {default: OpenAI} = await import('openai');
    const client = new OpenAI({apiKey: config.keys.openai});
    const portrait = size.height > size.width;
    const res = await client.images.generate({
      model: config.openaiImageModel,
      prompt: `${prompt}. Fotografia editorial premium, realista, sem texto.`,
      size: portrait ? '1024x1536' : size.width === size.height ? '1024x1024' : '1536x1024',
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI não devolveu imagem');
    return Buffer.from(b64, 'base64');
  }
}

export class ReplicateFlux implements ImageGen {
  readonly id = 'replicate';
  async generate(prompt: string, size: {width: number; height: number}) {
    const aspect = size.height > size.width ? '9:16' : size.width === size.height ? '1:1' : '16:9';
    const r = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
      method: 'POST',
      headers: {Authorization: `Bearer ${config.keys.replicate}`, 'Content-Type': 'application/json', Prefer: 'wait'},
      body: JSON.stringify({input: {prompt, aspect_ratio: aspect, output_format: 'jpg'}}),
    });
    const j = (await r.json()) as {output?: string[] | string; error?: string};
    const url = Array.isArray(j.output) ? j.output[0] : j.output;
    if (!url) throw new Error(`Replicate: ${j.error ?? r.status}`);
    return Buffer.from(await (await fetch(url)).arrayBuffer());
  }
}

export function getImageGen(): ImageGen | null {
  if (config.keys.openai) return new OpenAIImages();
  if (config.keys.replicate) return new ReplicateFlux();
  return null;
}
