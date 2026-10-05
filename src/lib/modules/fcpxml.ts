// Exportação da timeline em FCPXML 1.9 (DaVinci Resolve, Final Cut Pro, Premiere):
// um clipe por corte, na ordem, apontando para os arquivos ORIGINAIS; legendas,
// gráficos e B-roll entram como marcadores (com o texto) para guiar o acabamento.
// Baseado em kamgasimo/fcpxml.mjs (MIT), ampliado para várias fontes.
import type {EditPlan} from '../plan/schema';
import {placeClips, projectRange} from '../plan/timeline';
import {projectedCaptionTimes} from './captions';

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** taxas padrão: frameDuration como fração exata */
function rate(fps: number): {num: number; den: number} {
  // taxas inteiras primeiro (30 não é 29,97)
  if (Math.abs(fps - Math.round(fps)) < 0.005) return {num: 100, den: Math.round(fps) * 100};
  if (Math.abs(fps - 29.97) < 0.05) return {num: 1001, den: 30000};
  if (Math.abs(fps - 23.976) < 0.05) return {num: 1001, den: 24000};
  if (Math.abs(fps - 59.94) < 0.05) return {num: 1001, den: 60000};
  return {num: 100, den: Math.round(fps) * 100};
}

export function toFcpxml(plan: EditPlan, opts: {name: string; mediaUrl: (sourceKey: string, name: string) => string}): string {
  const fps = plan.format.fps;
  const {num, den} = rate(fps);
  const frames = (sec: number) => Math.round((sec * den) / num);
  const t = (n: number) => (n === 0 ? '0s' : `${n * num}/${den}s`);
  const placed = placeClips(plan.clips, fps);
  const assets = plan.sources.map((s, i) => ({s, id: `r${i + 2}`}));
  const assetId = new Map(assets.map((a) => [a.s.id, a.id]));
  let offset = 0;
  const clipXml = placed.map((p) => {
    const dur = p.durFrames;
    const markers: string[] = [];
    const inClip = (a: number) => a >= p.start && a < p.end;
    const mk = (tAbs: number, text: string) => {
      const local = frames(p.clip.inSec) + Math.round((tAbs - p.start) * fps * (p.clip.speed || 1));
      markers.push(`            <marker start="${t(local)}" duration="${t(1)}" value="${esc(text.slice(0, 120))}"/>`);
    };
    for (const c of projectedCaptionTimes(plan)) if (inClip(c.t0) && c.placed.index === p.index) mk(c.t0, `LEGENDA: ${c.chunk.words.map((w) => w.text).join(' ')}`);
    for (const o of plan.overlays) {
      const r = projectRange(placed, o.sourceId, o.start, o.end);
      if (r && inClip(r.start)) mk(r.start, `GRÁFICO ${o.kind}: ${o.props.value ?? o.props.text ?? (o.props.items ?? []).join(', ')}`);
    }
    for (const b of plan.broll) {
      const r = projectRange(placed, b.sourceId, b.start, b.end);
      if (r && inClip(r.start)) mk(r.start, `B-ROLL ${b.template}: ${b.asset.query ?? b.asset.emoji ?? ''}`);
    }
    const speed = p.clip.speed && p.clip.speed !== 1 ? `\n            <timeMap><timept time="0s" value="0s" interp="linear"/><timept time="${t(dur)}" value="${t(Math.round(dur * p.clip.speed))}" interp="linear"/></timeMap>` : '';
    const xml = `          <asset-clip ref="${assetId.get(p.clip.sourceId)}" name="${esc(p.clip.label ?? `Clipe ${p.index + 1}`)}" offset="${t(offset)}" start="${t(frames(p.clip.inSec))}" duration="${t(dur)}" tcFormat="NDF">${speed}
${markers.join('\n')}
          </asset-clip>`;
    offset += dur;
    return xml;
  });
  const assetXml = assets
    .map(
      ({s, id}) =>
        `    <asset id="${id}" name="${esc(s.name)}" start="0s" duration="${t(frames(s.duration))}" hasVideo="1" format="r1"${s.hasAudio ? ' hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"' : ''}>
      <media-rep kind="original-media" src="${esc(opts.mediaUrl(s.key, s.name))}"/>
    </asset>`,
    )
    .join('\n');
  const w = plan.sources[0]?.width ?? plan.format.width;
  const h = plan.sources[0]?.height ?? plan.format.height;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" frameDuration="${t(1)}" width="${w}" height="${h}"/>
${assetXml}
  </resources>
  <library>
    <event name="${esc(opts.name)}">
      <project name="${esc(opts.name)}">
        <sequence format="r1" duration="${t(offset)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${clipXml.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
