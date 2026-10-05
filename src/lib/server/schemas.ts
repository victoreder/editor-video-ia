import {z} from 'zod';
import {PlatformSchema, StyleIdSchema} from '../plan/schema';

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  style: StyleIdSchema.default('dynamic'),
  platform: PlatformSchema.default('instagram'),
  director: z.enum(['claude', 'openai', 'compare', 'heuristic']).default('claude'),
  transcriber: z.string().optional(),
  glossary: z.array(z.string()).default([]),
  script: z.string().max(20000).optional(),
  aggressiveness: z.enum(['gentle', 'medium', 'tight']).default('medium'),
  cutPause: z.number().min(0.1).max(2).optional(),
  removeMistakes: z.boolean().default(true),
  musicKey: z.string().optional(),
});

