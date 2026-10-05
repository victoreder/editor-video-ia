import {availableDirectors, availableTranscribers, config} from '@/lib/config';
import {STYLE_LIST} from '@/lib/styles';
import {route} from '@/lib/server/http';
import {listCustomStyles} from '@/lib/styles/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return route(async () => ({
    directors: availableDirectors(),
    transcribers: availableTranscribers(),
    storage: config.storage,
    db: config.db,
    runner: config.runner,
    models: {claude: config.anthropicModel, openai: config.openaiModel},
    pexels: Boolean(config.keys.pexels),
    imageGen: Boolean(config.keys.openai || config.keys.replicate),
    musicAI: Boolean(config.keys.elevenlabs),
    videoAI: Boolean(config.keys.replicate) && process.env.BROLL_AI_VIDEO === '1',
    styles: [...STYLE_LIST, ...(await listCustomStyles())].map((s) => ({id: s.id, name: s.name, summary: s.summary, palette: s.palette, preset: s.captions.preset, custom: s.id.startsWith('custom_')})),
  }));
}
