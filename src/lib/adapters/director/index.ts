// Director (LLM): ClaudeDirector | OpenAIDirector | HeuristicDirector.
// Três tarefas: corrigir a transcrição, escolher takes e o plano criativo.
// Saída sempre via structured outputs (JSON Schema) + validação zod.
import {z} from 'zod';
import {config} from '../../config';
import type {StyleConfig} from '../../styles';
import type {TimelineWord} from '../../plan/timeline';
import {CreativeSchema, heuristicCreative, type Creative} from '../../modules/creative';
import {CORRECTION_SYSTEM, TAKES_SYSTEM, creativeSystem, transcriptForPrompt} from './prompts';

export type TakeSegment = {i: number; sourceName: string; start: number; end: number; text: string};

export interface Director {
  readonly id: 'claude' | 'openai' | 'heuristic';
  readonly model: string;
  correct(words: {text: string}[], glossary: string[]): Promise<{i: number; text: string}[]>;
  selectTakes(segments: TakeSegment[], script?: string): Promise<{keep: number[]; notes: string}>;
  creative(input: {words: TimelineWord[]; style: StyleConfig; duration: number; platform: string}): Promise<Creative>;
}

const CorrectionSchema = z.object({fixes: z.array(z.object({i: z.number(), text: z.string()}))});
const TakesSchema = z.object({keep: z.array(z.number()), notes: z.string()});

const correctionUser = (words: {text: string}[], glossary: string[]) =>
  `GLOSSÁRIO: ${glossary.join(', ') || '(vazio)'}\n\nPALAVRAS (i|texto):\n${words.map((w, i) => `${i}|${w.text}`).join('\n')}`;
const takesUser = (segments: TakeSegment[], script?: string) =>
  `${script ? `ROTEIRO PRETENDIDO:\n${script}\n\n` : ''}TRECHOS (n | arquivo | início–fim | texto):\n${segments
    .map((s) => `${s.i} | ${s.sourceName} | ${s.start.toFixed(2)}–${s.end.toFixed(2)} | ${s.text}`)
    .join('\n')}`;
const creativeUser = (words: TimelineWord[], duration: number) =>
  `DURAÇÃO DO VÍDEO: ${duration.toFixed(2)} s\nTRANSCRIÇÃO (i|início|palavra):\n${transcriptForPrompt(words)}\n\nGere o plano criativo completo.`;

// ---------------------------------------------------------------- Claude

export class ClaudeDirector implements Director {
  readonly id = 'claude' as const;
  constructor(readonly model = config.anthropicModel) {}
  private async ask<T extends z.ZodType>(system: string, user: string, schema: T, effort: 'low' | 'medium' | 'high'): Promise<z.infer<T>> {
    const {default: Anthropic} = await import('@anthropic-ai/sdk');
    const {zodOutputFormat} = await import('@anthropic-ai/sdk/helpers/zod');
    const client = new Anthropic();
    const res = await client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system,
      messages: [{role: 'user', content: user}],
      output_config: {effort, format: zodOutputFormat(schema)},
    });
    if (res.stop_reason === 'refusal') throw new Error('Claude recusou a solicitação');
    if (res.stop_reason === 'max_tokens') throw new Error('resposta do Claude truncada (max_tokens)');
    if (!res.parsed_output) throw new Error('Claude não devolveu JSON válido');
    return res.parsed_output as z.infer<T>;
  }
  async correct(words: {text: string}[], glossary: string[]) {
    if (!glossary.length) return [];
    return (await this.ask(CORRECTION_SYSTEM, correctionUser(words, glossary), CorrectionSchema, 'low')).fixes;
  }
  selectTakes(segments: TakeSegment[], script?: string) {
    return this.ask(TAKES_SYSTEM, takesUser(segments, script), TakesSchema, 'medium');
  }
  creative(input: {words: TimelineWord[]; style: StyleConfig; duration: number; platform: string}) {
    return this.ask(creativeSystem(input.style, input.platform), creativeUser(input.words, input.duration), CreativeSchema, 'high');
  }
}

// ---------------------------------------------------------------- OpenAI

export class OpenAIDirector implements Director {
  readonly id = 'openai' as const;
  constructor(readonly model = config.openaiModel) {}
  private async ask<T extends z.ZodType>(system: string, user: string, schema: T, name: string): Promise<z.infer<T>> {
    const {default: OpenAI} = await import('openai');
    const client = new OpenAI({apiKey: config.keys.openai});
    const res = await client.chat.completions.create({
      model: this.model,
      messages: [
        {role: 'system', content: system},
        {role: 'user', content: user},
      ],
      response_format: {type: 'json_schema', json_schema: {name, schema: z.toJSONSchema(schema) as Record<string, unknown>, strict: false}},
    });
    const text = res.choices[0]?.message?.content ?? '';
    return schema.parse(JSON.parse(text));
  }
  async correct(words: {text: string}[], glossary: string[]) {
    if (!glossary.length) return [];
    return (await this.ask(CORRECTION_SYSTEM, correctionUser(words, glossary), CorrectionSchema, 'correction')).fixes;
  }
  selectTakes(segments: TakeSegment[], script?: string) {
    return this.ask(TAKES_SYSTEM, takesUser(segments, script), TakesSchema, 'takes');
  }
  creative(input: {words: TimelineWord[]; style: StyleConfig; duration: number; platform: string}) {
    return this.ask(creativeSystem(input.style, input.platform), creativeUser(input.words, input.duration), CreativeSchema, 'creative_plan');
  }
}

// ---------------------------------------------------------------- sem IA

export class HeuristicDirector implements Director {
  readonly id = 'heuristic' as const;
  readonly model = 'regras';
  async correct() {
    return [];
  }
  async selectTakes(segments: TakeSegment[]) {
    return {keep: segments.map((s) => s.i), notes: 'takes escolhidos por regras (repetições já removidas)'};
  }
  async creative(input: {words: TimelineWord[]; style: StyleConfig; duration: number}) {
    return heuristicCreative(input.words, input.style, input.duration);
  }
}

export function getDirector(id: 'claude' | 'openai' | 'heuristic'): Director {
  if (id === 'claude' && (config.keys.anthropic || process.env.ANTHROPIC_AUTH_TOKEN)) return new ClaudeDirector();
  if (id === 'openai' && config.keys.openai) return new OpenAIDirector();
  return new HeuristicDirector();
}
