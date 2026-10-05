// Configuração por variáveis de ambiente. A migração Vercel → VPS é só trocar
// estas variáveis (PLANO.md §2 "Regra de ouro: tudo é um adaptador").
import path from 'node:path';

const env = (k: string, d = '') => process.env[k] ?? d;

export const config = {
  dataDir: path.resolve(env('DATA_DIR', '.data')),
  publicBaseUrl: env('PUBLIC_BASE_URL', 'http://localhost:3000'),

  storage: env('STORAGE', process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'local') as 'local' | 'vercel-blob' | 's3',
  // Postgres da Vercel/Neon (DATABASE_URL ou POSTGRES_URL) → postgres; Supabase → supabase; senão JSON local
  db: env('DB', process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'postgres' : process.env.SUPABASE_URL ? 'supabase' : 'local') as 'local' | 'supabase' | 'postgres',
  databaseUrl: env('DATABASE_URL', env('POSTGRES_URL')),
  // na Vercel o padrão é a Sandbox (funções não rodam ffmpeg/Chromium por minutos)
  runner: env('RUNNER', process.env.VERCEL ? 'vercel-sandbox' : 'local') as 'local' | 'vercel-sandbox' | 'inline' | 'queue',
  transcriber: env('TRANSCRIBER', '') as '' | 'elevenlabs' | 'openai' | 'groq' | 'script',
  director: env('DIRECTOR', 'claude') as 'claude' | 'openai' | 'heuristic',

  anthropicModel: env('ANTHROPIC_MODEL', 'claude-opus-5-5'),
  anthropicDraftModel: env('ANTHROPIC_DRAFT_MODEL', 'claude-sonnet-5-5'),
  openaiModel: env('OPENAI_MODEL', 'gpt-5'),
  openaiImageModel: env('OPENAI_IMAGE_MODEL', 'gpt-image-1'),

  keys: {
    anthropic: env('ANTHROPIC_API_KEY'),
    openai: env('OPENAI_API_KEY'),
    elevenlabs: env('ELEVENLABS_API_KEY'),
    groq: env('GROQ_API_KEY'),
    pexels: env('PEXELS_API_KEY'),
    replicate: env('REPLICATE_API_TOKEN'),
  },

  s3: {
    endpoint: env('S3_ENDPOINT'),
    region: env('S3_REGION', 'us-east-1'),
    bucket: env('S3_BUCKET', 'editor-video-ia'),
    accessKeyId: env('S3_ACCESS_KEY_ID'),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
    publicUrl: env('S3_PUBLIC_URL'),
  },
  supabase: {url: env('SUPABASE_URL'), serviceKey: env('SUPABASE_SERVICE_ROLE_KEY')},
  remotionLicenseKey: env('REMOTION_LICENSE_KEY'),
};

/** qual IA diretora está realmente disponível (com chave) */
export function availableDirectors(): Array<'claude' | 'openai' | 'heuristic'> {
  const out: Array<'claude' | 'openai' | 'heuristic'> = [];
  if (config.keys.anthropic || process.env.ANTHROPIC_AUTH_TOKEN) out.push('claude');
  if (config.keys.openai) out.push('openai');
  out.push('heuristic');
  return out;
}

export function availableTranscribers(): Array<'elevenlabs' | 'openai' | 'groq' | 'script'> {
  const out: Array<'elevenlabs' | 'openai' | 'groq' | 'script'> = [];
  if (config.keys.elevenlabs) out.push('elevenlabs');
  if (config.keys.groq) out.push('groq');
  if (config.keys.openai) out.push('openai');
  out.push('script');
  return out;
}
