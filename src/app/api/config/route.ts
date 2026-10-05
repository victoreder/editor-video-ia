import {availableDirectors, availableTranscribers, config} from '@/lib/config';
import {STYLE_LIST} from '@/lib/styles';
import {route} from '@/lib/server/http';

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
    styles: STYLE_LIST.map((s) => ({id: s.id, name: s.name, summary: s.summary, palette: s.palette, preset: s.captions.preset})),
  }));
}
