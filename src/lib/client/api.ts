'use client';
// chamadas do navegador para a API + upload direto (local / Vercel Blob / S3)
import type {Job, Project, UploadedSource} from '../adapters/db/types';
import type {UploadTarget} from '../adapters/storage';
import type {EditPlan} from '../plan/schema';

export async function api<T = unknown>(url: string, init?: RequestInit & {json?: unknown}): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: {...(init?.json !== undefined ? {'Content-Type': 'application/json'} : {}), ...init?.headers},
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const ct = r.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data as {error?: string})?.error ?? `erro ${r.status}`);
  return data as T;
}

export type AppConfig = {
  directors: Array<'claude' | 'openai' | 'heuristic'>;
  transcribers: string[];
  storage: string;
  db: string;
  runner: string;
  models: {claude: string; openai: string};
  pexels: boolean;
  imageGen: boolean;
  musicAI: boolean;
  videoAI: boolean;
  styles: {id: string; name: string; summary: string; palette: {key: string; accent: string; bg: string; panel: string}; preset: string; custom?: boolean}[];
};

export type ProjectView = Project & {thumbUrl: string | null};
export type ExportView = Project['exports'][number] & {videoUrl: string; srtUrl: string | null; thumbUrl: string | null};

function putWithProgress(url: string, file: File, onProgress: (f: number) => void, headers: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`upload falhou (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('upload falhou (rede)'));
    xhr.send(file);
  });
}

/** envia um arquivo ao destino devolvido pela API; retorna a chave final */
export async function uploadToTarget(target: UploadTarget, key: string, file: File, onProgress: (f: number) => void): Promise<string> {
  if (target.mode === 'vercel-blob') {
    const {upload} = await import('@vercel/blob/client');
    const r = await upload(target.pathname, file, {access: 'public', handleUploadUrl: target.handleUploadUrl, multipart: file.size > 20e6, onUploadProgress: (p) => onProgress(p.percentage / 100)});
    return r.url;
  }
  await putWithProgress(target.url, file, onProgress, target.mode === 's3' ? {'Content-Type': file.type || 'application/octet-stream'} : {});
  return key;
}

export async function uploadProjectFile(projectId: string, file: File, kind: 'source' | 'music', onProgress: (f: number) => void): Promise<Project> {
  const {upload, target} = await api<{upload: UploadedSource; target: UploadTarget}>(`/api/projects/${projectId}/uploads`, {
    method: 'POST',
    json: {name: file.name, size: file.size, contentType: file.type || (kind === 'music' ? 'audio/mpeg' : 'video/mp4'), kind},
  });
  const key = await uploadToTarget(target, upload.key, file, onProgress);
  const {project} = await api<{project: Project}>(`/api/projects/${projectId}/uploads`, {method: 'PUT', json: {upload: {...upload, key}, kind}});
  return project;
}

/** sobe um arquivo fora de projeto (reel de referência, biblioteca) e devolve a chave */
export async function uploadToPrefix(prefix: 'styles' | 'library', file: File, onProgress: (f: number) => void): Promise<string> {
  const {key, target} = await api<{key: string; target: UploadTarget}>('/api/upload/target', {method: 'POST', json: {prefix, name: file.name, contentType: file.type || 'video/mp4'}});
  return uploadToTarget(target, key, file, onProgress);
}

export async function runProjectJob(projectId: string, type: 'shorts' | 'postpack' | 'thumbnail' | 'matte' | 'music', input: Record<string, unknown>, onUpdate: (j: Job) => void): Promise<Job> {
  const {job} = await api<{job: Job}>(`/api/projects/${projectId}/jobs`, {method: 'POST', json: {type, input}});
  onUpdate(job);
  return waitJob(job.id, onUpdate);
}

export const getPlan = (projectId: string, variant: string) => api<{plan: EditPlan; media: Record<string, string>}>(`/api/projects/${projectId}/plans/${variant}`);
export const savePlan = (projectId: string, variant: string, plan: EditPlan) => api<{ok: boolean; media: Record<string, string>}>(`/api/projects/${projectId}/plans/${variant}`, {method: 'PUT', json: {plan}});
export const getJob = (id: string) => api<{job: Job}>(`/api/jobs/${id}`);

export async function waitJob(id: string, onUpdate: (j: Job) => void, intervalMs = 1200): Promise<Job> {
  for (;;) {
    const {job} = await getJob(id);
    onUpdate(job);
    if (job.status === 'done' || job.status === 'error') return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
