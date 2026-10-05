import type {Project} from '@/lib/adapters/db/types';

export const STATUS_LABEL: Record<Project['status'], string> = {draft: 'Rascunho', processing: 'Processando', ready: 'Pronto', rendering: 'Exportando', error: 'Erro'};
export const DIRECTOR_LABEL: Record<string, string> = {claude: 'Claude', openai: 'OpenAI', compare: 'Comparar', heuristic: 'Sem IA (regras)'};
export const PLATFORM_LABEL: Record<string, string> = {instagram: 'Instagram Reels', tiktok: 'TikTok', shorts: 'YouTube Shorts', all: 'Todas'};

const TONE: Record<Project['status'], string> = {
  draft: 'bg-panel3 text-muted',
  processing: 'bg-brand/15 text-[#b9a8ff]',
  ready: 'bg-ok/15 text-ok',
  rendering: 'bg-brand2/15 text-brand2',
  error: 'bg-danger/15 text-danger',
};

export function StatusBadge({status}: {status: Project['status']}) {
  const live = status === 'processing' || status === 'rendering';
  return (
    <span className={`badge ${TONE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${live ? 'animate-pulse' : ''}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** "há 5 min", "ontem", "12/03" */
export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'ontem';
  if (s < 7 * 86400) return `há ${Math.floor(s / 86400)} dias`;
  return new Date(iso).toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit', year: '2-digit'});
}
