// A composição principal: EditPlan → vídeo. Usada pelo @remotion/player no
// editor (preview ao vivo, sem renderizar) e pelo renderer no export.
import React, {useMemo} from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import type {EditPlan} from '../lib/plan/schema';
import {styleOf} from '../lib/styles';
import {placeClips, projectRange, srcToTimeline, totalDurationFrames} from '../lib/plan/timeline';
import {projectBeats} from '../lib/plan/camera';
import {projectSfx} from '../lib/modules/sfx';
import {ReelProvider, makeResolver} from './context';
import {ensureFonts} from './fonts';
import {SpeakerLayer, type SpeakerLayout} from './SpeakerLayer';
import {CaptionsLayer, type TimedChunk} from './captions/Captions';
import {OverlaysLayer, type TimedOverlay} from './overlays/Overlays';
import {BrollLayer, type TimedBroll} from './broll/Broll';
import {EndCard, HookTitle, MusicTrack, ProgressBar, SfxLayer} from './components/Extras';

export type ReelProps = {
  plan: EditPlan;
  media?: Record<string, string>;
  selectedId?: string | null;
  /** esconde camadas (ex.: exportar a versão "limpa") */
  layers?: {captions?: boolean; broll?: boolean; overlays?: boolean; music?: boolean; sfx?: boolean; hook?: boolean; progress?: boolean; outro?: boolean};
};

ensureFonts();

function useTimed(plan: EditPlan) {
  return useMemo(() => {
    const fps = plan.format.fps;
    const placed = placeClips(plan.clips, fps);
    const beats = projectBeats(plan, placed);
    const chunks: TimedChunk[] = [];
    for (const c of plan.captions.chunks) {
      const p = placed.find((x) => x.clip.sourceId === c.sourceId && c.start >= x.clip.inSec - 0.05 && c.start < x.clip.outSec);
      if (!p) continue;
      const toT = (s: number) => srcToTimeline(p, Math.min(Math.max(s, p.clip.inSec), p.clip.outSec));
      chunks.push({
        chunk: c,
        t0: toT(c.start),
        t1: toT(c.end),
        holdMax: p.end,
        words: c.words.map((w, i) => ({text: w.text, t0: toT(w.start), t1: toT(c.words[i + 1]?.start ?? Math.max(w.end, c.end)), accent: w.accent})),
      });
    }
    chunks.sort((a, b) => a.t0 - b.t0);
    const overlays: TimedOverlay[] = plan.overlays.flatMap((o) => {
      const r = projectRange(placed, o.sourceId, o.start, o.end);
      return r ? [{o, t0: r.start, t1: r.end}] : [];
    });
    const broll: TimedBroll[] = plan.broll.flatMap((b) => {
      const r = projectRange(placed, b.sourceId, b.start, b.end);
      return r ? [{b, t0: r.start, t1: r.end}] : [];
    });
    const speech: Array<[number, number]> = chunks.map((c) => [c.t0, c.t1]);
    const clipsFrames = totalDurationFrames(plan.clips, fps);
    return {placed, beats, chunks, overlays, broll, speech, clipsFrames, sfx: projectSfx(plan)};
  }, [plan]);
}

/** layout do apresentador no instante t (com rampa de 0,25 s nas bordas do B-roll) */
function layoutAt(broll: TimedBroll[], t: number): SpeakerLayout {
  const RAMP = 0.25;
  for (const {b, t0, t1} of broll) {
    if (b.template === 'card' || t < t0 - 0.01 || t > t1) continue;
    const k = Math.min(1, (t - t0) / RAMP, (t1 - t) / RAMP);
    return {mode: b.template === 'takeover' ? 'takeover' : b.template, k: Math.max(0, k)};
  }
  return {mode: 'full', k: 0};
}

export const Reel: React.FC<ReelProps> = ({plan, media, selectedId, layers = {}}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const style = styleOf(plan);
  const timed = useTimed(plan);
  const resolve = useMemo(() => makeResolver(media), [media]);
  const t = frame / fps;
  const layout = layoutAt(timed.broll, t);
  const show = {captions: true, broll: true, overlays: true, music: true, sfx: true, hook: true, progress: true, outro: true, ...layers};
  // gráfico "title" em tela cheia esconde a legenda por baixo
  const hideCaptions: Array<[number, number]> = timed.overlays.filter((o) => o.o.kind === 'title').map((o) => [o.t0, o.t1]);
  timed.broll.filter((b) => b.b.template === 'takeover').forEach((b) => hideCaptions.push([b.t0, b.t1]));
  const outroFrames = Math.round((plan.outro?.duration ?? 0) * fps);
  const musicSrc = resolve(plan.audio.music?.src);

  return (
    <ReelProvider value={{plan, style, resolve, selectedId}}>
      <AbsoluteFill style={{backgroundColor: style.palette.bg}}>
        {show.broll && <BrollLayer items={timed.broll} below />}
        <SpeakerLayer placed={timed.placed} beats={timed.beats} layout={layout} />
        {show.broll && <BrollLayer items={timed.broll} />}
        {show.overlays && <OverlaysLayer items={timed.overlays} />}
        {show.captions && <CaptionsLayer chunks={timed.chunks} hideRanges={hideCaptions} />}
        {show.hook && plan.hook && (
          <Sequence from={0} durationInFrames={Math.max(2, Math.round(plan.hook.until * fps))} layout="none" name="gancho">
            <HookTitle title={plan.hook.title} life={Math.round(plan.hook.until * fps)} />
          </Sequence>
        )}
        {show.progress && plan.progressBar && <ProgressBar total={timed.clipsFrames} />}
        {show.outro && plan.outro && outroFrames > 0 && (
          <Sequence from={timed.clipsFrames} durationInFrames={outroFrames} name="end card">
            <EndCard title={plan.outro.title} line={plan.outro.line} life={outroFrames} />
          </Sequence>
        )}
        {show.music && plan.audio.music && musicSrc && <MusicTrack music={plan.audio.music} src={musicSrc} totalFrames={timed.clipsFrames + outroFrames} speech={timed.speech} />}
        {show.sfx && <SfxLayer cues={timed.sfx} volume={plan.audio.sfxVolume} />}
      </AbsoluteFill>
    </ReelProvider>
  );
};
