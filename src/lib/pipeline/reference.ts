// Job "reference": reel de referência → estilo próprio salvo em "Meu estilo".
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {Job} from '../adapters/db';
import {getStorage} from '../adapters/storage';
import {getTranscriber} from '../adapters/transcriber';
import {bestDirector} from '../adapters/director';
import {extractAudio, probe} from '../media/ffmpeg';
import {colorStats, dominantColors, framesBase64, sceneCuts} from '../media/analyze';
import {REFERENCE_SYSTEM, ReferenceSchema, measuresToStyle, referenceUser, studyToStyle, type RefMeasures} from '../modules/reference';
import {saveCustomStyle} from '../styles/store';
import {uid} from '../util/id';
import type {Reporter} from './process';

export async function referenceJob(job: Job, report: Reporter, log: (s: string) => void) {
  const key = String(job.input.key);
  const name = String(job.input.name ?? 'Estilo da referência');
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ref-'));
  try {
    const file = path.join(work, 'ref.mp4');
    await report(5, 'Baixando o reel de referência');
    await getStorage().download(key, file);
    const info = await probe(file);
    await report(15, 'Medindo ritmo de cortes e cores');
    const cuts = await sceneCuts(file);
    const color = await colorStats(file);
    const colors = await dominantColors(file, work);
    const m: RefMeasures = {
      duration: info.duration,
      cuts,
      avgShot: info.duration / (cuts.length + 1),
      cutsPerMin: (cuts.length / Math.max(1, info.duration)) * 60,
      colors,
      luma: color.luma,
      sat: color.sat,
    };
    log(`referência: ${cuts.length} cortes, plano médio ${m.avgShot.toFixed(2)} s, cores ${colors.join(', ')}`);

    let transcript = '';
    if (info.hasAudio) {
      await report(30, 'Transcrevendo a referência');
      try {
        const audio = path.join(work, 'ref.mp3');
        await extractAudio(file, audio);
        const tr = getTranscriber();
        if (tr.id !== 'script') {
          const t = await tr.transcribe(audio, {language: process.env.TRANSCRIBE_LANGUAGE ?? 'pt', duration: info.duration});
          transcript = t.words.map((w) => w.text).join(' ');
          m.wordsPerMin = (t.words.length / Math.max(1, info.duration)) * 60;
        }
      } catch (e) {
        log(`transcrição da referência falhou: ${String(e).slice(0, 120)}`);
      }
    }

    const id = `custom_${uid('st').slice(3)}`;
    const director = bestDirector(job.input.director as 'claude' | 'openai' | undefined);
    let style = measuresToStyle(id, m, name);
    let study: Record<string, unknown> | null = null;
    if (director.id !== 'heuristic') {
      await report(50, `IA (${director.id}) estudando a edição`);
      const every = Math.max(0.5, info.duration / 24);
      const frames = await framesBase64(file, work, every, 24);
      try {
        const r = await director.json({
          name: 'reference_style',
          system: REFERENCE_SYSTEM,
          user: referenceUser(m, transcript),
          schema: ReferenceSchema,
          images: frames.map((f) => ({mime: 'image/jpeg' as const, base64: f.base64, label: `frame ${f.t.toFixed(1)} s`})),
          effort: 'high',
        });
        style = studyToStyle(id, {...r, name: name || r.name}, `reel de referência (${director.id})`);
        study = {editLog: r.editLog, fiveThings: r.fiveThings};
      } catch (e) {
        log(`análise por IA falhou (${String(e).slice(0, 160)}); estilo pelas medições`);
      }
    } else log('sem chave de IA: estilo deduzido só das medições');
    await report(90, 'Salvando o estilo');
    await saveCustomStyle(style);
    await report(100, 'Pronto');
    return {style, measures: m, study};
  } finally {
    await fs.rm(work, {recursive: true, force: true}).catch(() => undefined);
  }
}
