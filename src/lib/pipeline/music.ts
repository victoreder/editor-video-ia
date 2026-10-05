// Trilha do projeto: arquivo enviado, trilha pronta (builtin:) ou gerada por IA ("ai:<clima ou descrição>").
import path from 'node:path';
import type {Project} from '../adapters/db';
import type {EditPlan} from '../plan/schema';
import {getStorage} from '../adapters/storage';
import {getMusicGen, MOOD_PROMPTS, SynthMusic} from '../adapters/musicgen';
import {placeClips} from '../plan/timeline';
import {styleOf} from '../styles';

export async function generateMusic(plan: EditPlan, projectId: string, spec: string, workDir: string, log: (s: string) => void): Promise<string> {
  const style = styleOf(plan);
  const raw = spec.replace(/^ai:/, '').trim();
  const mood = (['upbeat', 'calm', 'cinematic'] as const).find((m) => m === raw) ?? style.music.mood;
  const prompt = raw && !['upbeat', 'calm', 'cinematic'].includes(raw) ? raw : MOOD_PROMPTS[mood];
  const seconds = (placeClips(plan.clips, plan.format.fps).at(-1)?.end ?? 30) + (plan.outro?.duration ?? 0) + 1;
  const out = path.join(workDir, `music-${Date.now()}.mp3`);
  const gen = getMusicGen();
  try {
    await gen.generate(prompt, seconds, out, mood);
    log(`trilha gerada (${gen.id}, ${seconds.toFixed(0)} s): ${prompt}`);
  } catch (e) {
    log(`música por IA falhou (${String(e).slice(0, 140)}); usando trilha sintetizada`);
    await new SynthMusic().generate(prompt, seconds, out, mood);
  }
  return getStorage().putFile(`projects/${projectId}/music/gerada-${Date.now()}.mp3`, out, 'audio/mpeg');
}

/** aplica a escolha de música do projeto ao plano base */
export async function applyProjectMusic(plan: EditPlan, project: Project, workDir: string, log: (s: string) => void) {
  const key = project.musicKey;
  if (!key) return;
  const src = key.startsWith('ai:') ? await generateMusic(plan, project.id, key, workDir, log) : key;
  plan.audio.music = {src, volume: styleOf(plan).music.volume, startSec: 0, fadeOutSec: 1.5, duck: true, duckLevel: 0.3};
}
