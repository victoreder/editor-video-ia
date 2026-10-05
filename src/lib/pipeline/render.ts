// Módulo 14 — render final: Remotion (Chromium headless) → MP4 H.264 ~12 Mbps →
// loudnorm −14 LUFS (ffmpeg) → SRT + thumbnail → storage. Um render por formato.
//   RENDERER=local  : @remotion/renderer neste processo (dev, VPS/Docker, dentro da Sandbox)
//   RENDERER=vercel : @remotion/vercel (cria uma Vercel Sandbox só para o render)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {config} from '../config';
import {FORMATS, type EditPlan, type FormatId} from '../plan/schema';
import {getDb, type ExportItem, type Job, type PlanVariant} from '../adapters/db';
import {getStorage, LocalStorage} from '../adapters/storage';
import {loudnorm, qaRendered} from '../media/ffmpeg';
import {bestThumbnailTime, coverTitle} from '../modules/thumbnail';
import {toFcpxml} from '../modules/fcpxml';
import type {ReelProps} from '../../remotion/Reel';
import {startStaticServer} from '../media/static-server';
import {toSrt} from '../modules/captions';
import {runQa} from '../modules/qa';
import {uid} from '../util/id';
import {mediaMap} from './media-map';
import {finalize} from './plan-builder';
import type {Reporter} from './process';

const ROOT = process.cwd();
// Chromium já instalado (ex.: Playwright, Docker); sem isso o Remotion baixa o seu
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
const BUNDLE_DIR = path.join(config.dataDir, 'remotion-bundle');

function newestMtime(dir: string): number {
  let max = 0;
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    max = Math.max(max, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return max;
}

/** empacota a composição (webpack) e reaproveita enquanto o código não mudar */
export async function getBundle(log?: (s: string) => void): Promise<string> {
  if (process.env.REMOTION_SERVE_URL) return process.env.REMOTION_SERVE_URL;
  const stamp = path.join(BUNDLE_DIR, '.stamp');
  const srcTime = Math.max(newestMtime(path.join(ROOT, 'src', 'remotion')), newestMtime(path.join(ROOT, 'src', 'lib')));
  if (fs.existsSync(stamp) && Number(fs.readFileSync(stamp, 'utf8')) >= srcTime) return BUNDLE_DIR;
  log?.('empacotando a composição Remotion…');
  const {bundle} = await import('@remotion/bundler');
  const out = await bundle({entryPoint: path.join(ROOT, 'src', 'remotion', 'index.ts'), outDir: BUNDLE_DIR, publicDir: path.join(ROOT, 'public')});
  fs.writeFileSync(stamp, String(srcTime));
  return out;
}

/** adapta o plano a outro formato (1:1, 16:9): o cover-fit reenquadra e a safezone recalcula */
export function planForFormat(plan: EditPlan, format: FormatId): EditPlan {
  const f = FORMATS[format];
  if (f.width === plan.format.width && f.height === plan.format.height) return plan;
  return finalize({...plan, format: {...plan.format, width: f.width, height: f.height}, captions: {...plan.captions, chunks: plan.captions.chunks.map((c) => ({...c, manual: false}))}});
}

export async function renderLocal(plan: EditPlan, outFile: string, media: Record<string, string>, onProgress: (f: number) => void, log?: (s: string) => void, layers?: ReelProps['layers']) {
  const serveUrl = await getBundle(log);
  const {selectComposition, renderMedia} = await import('@remotion/renderer');
  const inputProps = {plan, media, layers};
  const composition = await selectComposition({serveUrl, id: 'Reel', inputProps, browserExecutable});
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: 'h264',
    browserExecutable,
    outputLocation: outFile,
    videoBitrate: '12M',
    audioBitrate: '192k',
    x264Preset: 'medium',
    concurrency: process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : null,
    licenseKey: config.remotionLicenseKey || undefined,
    chromiumOptions: {gl: 'swangle'},
    onProgress: ({progress}) => onProgress(progress),
  });
}

export async function renderThumbnail(plan: EditPlan, outFile: string, media: Record<string, string>, frame: number) {
  const serveUrl = await getBundle();
  const {selectComposition, renderStill} = await import('@remotion/renderer');
  const inputProps = {plan, media};
  const composition = await selectComposition({serveUrl, id: 'Reel', inputProps, browserExecutable});
  await renderStill({serveUrl, composition, inputProps, browserExecutable, output: outFile, frame: Math.min(frame, composition.durationInFrames - 1), imageFormat: 'jpeg', jpegQuality: 88});
}

/** capa com título (módulo 13): melhor frame congelado + título grande */
export async function renderCover(plan: EditPlan, outFile: string, media: Record<string, string>, title?: string) {
  const serveUrl = await getBundle();
  const {selectComposition, renderStill} = await import('@remotion/renderer');
  const inputProps = {plan, media, t: bestThumbnailTime(plan), title: coverTitle(plan, title)};
  const composition = await selectComposition({serveUrl, id: 'Cover', inputProps, browserExecutable});
  await renderStill({serveUrl, composition, inputProps, browserExecutable, output: outFile, frame: 0, imageFormat: 'jpeg', jpegQuality: 90});
}

async function renderOnVercel(plan: EditPlan, media: Record<string, string>, onProgress: (f: number) => void): Promise<string> {
  const {createSandbox, addBundleToSandbox, renderMediaOnVercel, uploadToVercelBlob} = await import('@remotion/vercel');
  const sandbox = await createSandbox();
  try {
    await addBundleToSandbox({sandbox, bundleDir: process.env.REMOTION_BUNDLE_DIR ?? path.join(ROOT, 'remotion-bundle')});
    const {sandboxFilePath, contentType} = await renderMediaOnVercel({
      sandbox,
      compositionId: 'Reel',
      inputProps: {plan, media},
      codec: 'h264',
      videoBitrate: '12M',
      onProgress: (p) => onProgress((p as {overallProgress?: number}).overallProgress ?? 0),
    });
    const {url} = await uploadToVercelBlob({sandbox, sandboxFilePath, contentType, blobToken: process.env.BLOB_READ_WRITE_TOKEN ?? '', access: 'public', blobPath: `renders/${uid('r')}.mp4`});
    return url;
  } finally {
    await (sandbox as unknown as {stop?: () => Promise<void>}).stop?.();
  }
}

export async function renderJob(job: Job, report: Reporter, log: (s: string) => void) {
  const db = getDb();
  const storage = getStorage();
  const variant = job.input.variant as PlanVariant;
  const formats = ((job.input.formats as FormatId[]) ?? ['vertical']).filter((f) => FORMATS[f]);
  const base = await db.getPlan(job.projectId, variant);
  const projectRec = await db.getProject(job.projectId);
  if (!base) throw new Error('plano não encontrado');
  const qa = runQa(base);
  for (const i of qa.filter((x) => x.level !== 'info')) log(`QA: ${i.message}`);
  await db.updateProject(job.projectId, {status: 'rendering'});
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), `render-${job.projectId}-`));
  let server: Awaited<ReturnType<typeof startStaticServer>> | null = null;
  try {
    let toUrl = (k: string) => storage.renderUrl(k);
    if (storage instanceof LocalStorage) {
      server = await startStaticServer(path.join(config.dataDir, 'storage'));
      const s = server;
      toUrl = (k) => `${s.url}/${k.split('/').map(encodeURIComponent).join('/')}`;
    }
    const exports: ExportItem[] = [];
    for (const [i, format] of formats.entries()) {
      const plan = planForFormat(base, format);
      const media = mediaMap(plan, toUrl);
      const span = 90 / formats.length;
      const p0 = 5 + i * span;
      const id = uid('exp');
      await report(p0, `Renderizando ${format}`);
      let videoKey: string;
      let qa: Awaited<ReturnType<typeof qaRendered>> | undefined;
      let cleanKey: string | undefined;
      if (process.env.RENDERER === 'vercel') {
        videoKey = await renderOnVercel(plan, media, (f) => void report(p0 + f * span * 0.9, `Renderizando ${format} ${(f * 100).toFixed(0)}%`));
      } else {
        const raw = path.join(work, `${id}.raw.mp4`);
        const out = path.join(work, `${id}.mp4`);
        await renderLocal(plan, raw, media, (f) => void report(p0 + f * span * 0.8, `Renderizando ${format} ${(f * 100).toFixed(0)}%`), log);
        await report(p0 + span * 0.85, 'Mixagem final (−14 LUFS)');
        await loudnorm(raw, out);
        qa = await qaRendered(out).catch(() => undefined);
        if (qa?.notes.length) log(`QA do render: ${qa.notes.join('; ')}`);
        videoKey = await storage.putFile(`projects/${job.projectId}/exports/${id}.mp4`, out, 'video/mp4');
        if (job.input.clean) {
          // versão "limpa": só o vídeo cortado, com câmera e cor (para editar em outro programa)
          await report(p0 + span * 0.88, 'Renderizando a versão limpa');
          const cleanRaw = path.join(work, `${id}.clean.mp4`);
          await renderLocal(plan, cleanRaw, media, () => undefined, log, {captions: false, overlays: false, broll: false, hook: false, progress: false, outro: false, sfx: false, music: false});
          cleanKey = await storage.putFile(`projects/${job.projectId}/exports/${id}.limpo.mp4`, cleanRaw, 'video/mp4');
        }
      }
      const srtKey = await storage.put(`projects/${job.projectId}/exports/${id}.srt`, toSrt(plan), 'application/x-subrip');
      let thumbKey: string | undefined;
      try {
        await report(p0 + span * 0.93, 'Capa e thumbnail');
        const thumb = path.join(work, `${id}.jpg`);
        await renderCover(plan, thumb, media, projectRec?.postpack?.hook?.toUpperCase());
        thumbKey = await storage.putFile(`projects/${job.projectId}/exports/${id}.jpg`, thumb, 'image/jpeg');
      } catch (e) {
        log(`capa falhou: ${String(e).slice(0, 120)}`);
      }
      // timeline para DaVinci/Premiere/Final Cut (aponta para os arquivos originais)
      const fcpxmlKey = await storage.put(
        `projects/${job.projectId}/exports/${id}.fcpxml`,
        toFcpxml(plan, {name: projectRec?.name ?? 'Projeto', mediaUrl: (_key, name) => `file://./${encodeURIComponent(name)}`}),
        'application/xml',
      );
      exports.push({id, createdAt: new Date().toISOString(), format, videoKey, srtKey, thumbKey, coverKey: thumbKey, fcpxmlKey, cleanKey, variant, qa: qa ? {lufs: qa.lufs, truePeak: qa.truePeak, ok: qa.ok, notes: qa.notes} : undefined});
    }
    const project = await db.getProject(job.projectId);
    await db.updateProject(job.projectId, {status: 'ready', exports: [...exports, ...(project?.exports ?? [])]});
    await report(100, 'Exportado');
    return {exports: exports.map((e) => ({...e, videoUrl: storage.publicUrl(e.videoKey), srtUrl: e.srtKey ? storage.publicUrl(e.srtKey) : undefined}))};
  } finally {
    await server?.close();
    await fsp.rm(work, {recursive: true, force: true}).catch(() => undefined);
  }
}
