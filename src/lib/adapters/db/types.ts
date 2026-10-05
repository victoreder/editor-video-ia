import type {EditPlan, Platform, StyleId} from '../../plan/schema';

export type DirectorChoice = 'claude' | 'openai' | 'compare' | 'heuristic';
export type PlanVariant = 'claude' | 'openai' | 'heuristic';

export type UploadedSource = {
  id: string;
  name: string;
  key: string; // chave no storage do arquivo original
  size: number;
  contentType: string;
};

export type ExportItem = {
  id: string;
  createdAt: string;
  format: 'vertical' | 'square' | 'landscape';
  videoKey: string;
  srtKey?: string;
  thumbKey?: string;
  variant: PlanVariant;
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  style: StyleId;
  platform: Platform;
  director: DirectorChoice;
  transcriber?: string;
  glossary: string[];
  script?: string; // roteiro colado (alinhamento / transcrição sem API)
  musicKey?: string;
  aggressiveness: 'gentle' | 'medium' | 'tight';
  status: 'draft' | 'processing' | 'ready' | 'rendering' | 'error';
  error?: string;
  uploads: UploadedSource[];
  variants: PlanVariant[]; // planos gerados
  activeVariant?: PlanVariant;
  exports: ExportItem[];
  thumbKey?: string;
};

export type JobType = 'process' | 'replan' | 'render' | 'broll';
export type Job = {
  id: string;
  projectId: string;
  type: JobType;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  label: string;
  error?: string;
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export interface Db {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(p: Project): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  getPlan(projectId: string, variant: PlanVariant): Promise<EditPlan | null>;
  savePlan(projectId: string, variant: PlanVariant, plan: EditPlan): Promise<void>;
  createJob(j: Job): Promise<Job>;
  updateJob(id: string, patch: Partial<Job>): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  listJobs(projectId: string): Promise<Job[]>;
}
