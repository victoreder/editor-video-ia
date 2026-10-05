// Servidor MCP (fase 3): deixa o Claude Code / Claude Desktop editar seus vídeos
// conversando. Fala com o app pela API HTTP (o app precisa estar rodando).
// Inspirado em autobroll/mcp/server.mjs (MIT).
//
//   EDITOR_URL=http://localhost:3000 npx tsx mcp/server.ts
//   claude mcp add editor-video -- npx tsx /caminho/mcp/server.ts
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {planSummary} from '../src/lib/modules/chat-edit';
import type {EditPlan} from '../src/lib/plan/schema';

const BASE = (process.env.EDITOR_URL ?? 'http://localhost:3000').replace(/\/$/, '');

async function api<T>(path: string, init?: {method?: string; json?: unknown}): Promise<T> {
  const r = await fetch(BASE + path, {
    method: init?.method ?? 'GET',
    headers: init?.json !== undefined ? {'Content-Type': 'application/json'} : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const data = (await r.json().catch(() => ({}))) as T & {error?: string};
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}
const text = (t: string) => ({content: [{type: 'text' as const, text: t}]});

async function variantOf(projectId: string) {
  const {project} = await api<{project: {activeVariant?: string; variants: string[]; name: string}}>(`/api/projects/${projectId}`);
  const v = project.activeVariant ?? project.variants[0];
  if (!v) throw new Error('projeto ainda não processado');
  return v;
}

const server = new McpServer({name: 'editor-video-ia', version: '0.1.0'});

server.registerTool('listar_projetos', {description: 'Lista os projetos de vídeo (id, nome, status).'}, async () => {
  const {projects} = await api<{projects: {id: string; name: string; status: string; style: string}[]}>('/api/projects');
  return text(projects.map((p) => `${p.id} · ${p.name} · ${p.status} · estilo ${p.style}`).join('\n') || 'Nenhum projeto.');
});

server.registerTool(
  'ver_plano',
  {description: 'Resumo da edição de um projeto: clipes, legendas, gráficos, B-roll, zooms e sons, com ids e tempos (segundos do vídeo final).', inputSchema: {projectId: z.string()}},
  async ({projectId}) => {
    const v = await variantOf(projectId);
    const {plan} = await api<{plan: EditPlan}>(`/api/projects/${projectId}/plans/${v}`);
    return text(planSummary(plan));
  },
);

server.registerTool(
  'editar',
  {
    description: 'Aplica uma mudança descrita em português (ex.: "deixa a legenda maior", "coloca um número 87% aos 5 s", "tira o B-roll do começo"). Salva o plano.',
    inputSchema: {projectId: z.string(), pedido: z.string()},
  },
  async ({projectId, pedido}) => {
    const v = await variantOf(projectId);
    const {plan} = await api<{plan: EditPlan}>(`/api/projects/${projectId}/plans/${v}`);
    const r = await api<{plan: EditPlan; reply: string; applied: number}>(`/api/projects/${projectId}/plans/${v}/chat`, {method: 'POST', json: {plan, message: pedido}});
    if (r.applied) await api(`/api/projects/${projectId}/plans/${v}`, {method: 'PUT', json: {plan: r.plan}});
    return text(`${r.reply}\n(${r.applied} alteração(ões) salvas)`);
  },
);

server.registerTool(
  'exportar',
  {description: 'Renderiza o MP4 final (9:16 por padrão) e devolve o id do job.', inputSchema: {projectId: z.string(), formatos: z.array(z.enum(['vertical', 'square', 'landscape'])).optional()}},
  async ({projectId, formatos}) => {
    const v = await variantOf(projectId);
    const {job} = await api<{job: {id: string}}>(`/api/projects/${projectId}/render`, {method: 'POST', json: {variant: v, formats: formatos ?? ['vertical']}});
    return text(`Render iniciado (job ${job.id}). Use "status_job" para acompanhar.`);
  },
);

server.registerTool(
  'gerar_shorts',
  {description: 'Corta um vídeo longo em Shorts independentes (cada um vira um projeto novo, já editado).', inputSchema: {projectId: z.string(), quantidade: z.number().int().min(1).max(8).optional()}},
  async ({projectId, quantidade}) => {
    const v = await variantOf(projectId);
    const {job} = await api<{job: {id: string}}>(`/api/projects/${projectId}/jobs`, {method: 'POST', json: {type: 'shorts', input: {variant: v, count: quantidade ?? 3}}});
    return text(`Gerando Shorts (job ${job.id}).`);
  },
);

server.registerTool('status_job', {description: 'Status e progresso de um job.', inputSchema: {jobId: z.string()}}, async ({jobId}) => {
  const {job} = await api<{job: {status: string; progress: number; label: string; error?: string; result?: unknown}}>(`/api/jobs/${jobId}`);
  return text(`${job.status} · ${job.progress}% · ${job.label}${job.error ? ` · erro: ${job.error}` : ''}${job.status === 'done' ? `\n${JSON.stringify(job.result).slice(0, 1500)}` : ''}`);
});

await server.connect(new StdioServerTransport());
