// Plano vazio para o Remotion Studio (sem mídia): mostra só os gráficos.
import type {EditPlan} from '../lib/plan/schema';

export const emptyDemoPlan = (): EditPlan => ({
  version: 1,
  format: {width: 1080, height: 1920, fps: 30},
  style: 'dynamic',
  platform: 'instagram',
  sources: [],
  words: [],
  clips: [],
  camera: {beats: []},
  faceTracks: [],
  captions: {preset: 'bold-pop', uppercase: true, chunks: []},
  overlays: [],
  broll: [],
  transitions: [],
  audio: {sfx: [], sfxVolume: 0.7},
  grade: {look: 'none', faceLift: 0},
  progressBar: false,
  meta: {director: 'heuristic', model: 'demo', createdAt: new Date(0).toISOString(), notes: []},
});
