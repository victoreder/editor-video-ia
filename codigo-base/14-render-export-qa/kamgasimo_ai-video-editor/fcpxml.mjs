#!/usr/bin/env node
// A cut list → an FCPXML timeline that DaVinci Resolve, Final Cut Pro and Premiere Pro can import, so a
// person can fine-tune pacing by hand. One clip per kept segment, in order, on a timeline at the
// standard frame rate nearest the source's, the rate the rendered master uses; every time is a whole
// number of its frames. The timeline carries the cuts only — punch-in zooms, captions and music are
// rendered into the deliverables, not described here.
//
//   node fcpxml.mjs <cuts.json> --out edit.fcpxml [--name "Project name"]

import { writeFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, die, probe, readJson, standardRate } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const cutsPath = args._[0];
if (!cutsPath || !args.out) die('usage: fcpxml.mjs <cuts.json> --out edit.fcpxml [--name name]');

const cuts = readJson(cutsPath);
const source = isAbsolute(cuts.source) ? cuts.source : resolve(dirname(resolve(cutsPath)), cuts.source);
const p = probe(source);
if (!p.video) die('the source has no video stream');

const rate = standardRate(p.video.fps || 30);
const fdNum = rate.den, fdDen = rate.num; // one frame lasts fdNum/fdDen seconds
const frames = (sec) => Math.round(sec * fdDen / fdNum);
const t = (n) => (n === 0 ? '0s' : `${n * fdNum}/${fdDen}s`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const name = typeof args.name === 'string' ? args.name : basename(source).replace(/\.[^.]+$/, '');
let offset = 0;
// Each clip is as many frames as cut.mjs renders for its segment, so the timeline and the master agree.
const clips = cuts.keep.map((seg, i) => {
  const start = frames(seg.start), dur = Math.max(1, Math.ceil((seg.end - seg.start) * fdDen / fdNum - 1e-6));
  const xml = `          <asset-clip ref="r2" name="${esc(`${name} ${String(i + 1).padStart(2, '0')}`)}" offset="${t(offset)}" start="${t(start)}" duration="${t(dur)}" tcFormat="NDF"/>`;
  offset += dur;
  return xml;
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" frameDuration="${t(1)}" width="${p.video.width}" height="${p.video.height}"/>
    <asset id="r2" name="${esc(basename(source))}" start="0s" duration="${t(frames(p.duration))}" hasVideo="1" format="r1"${p.audio ? ` hasAudio="1" audioSources="1" audioChannels="${p.audio.channels}" audioRate="${p.audio.sampleRate}"` : ''}>
      <media-rep kind="original-media" src="${esc(pathToFileURL(source).href)}"/>
    </asset>
  </resources>
  <library>
    <event name="${esc(name)}">
      <project name="${esc(name)}">
        <sequence format="r1" duration="${t(offset)}" tcStart="0s" tcFormat="NDF"${p.audio ? ` audioLayout="${p.audio.channels > 1 ? 'stereo' : 'mono'}" audioRate="${p.audio.sampleRate >= 48000 ? '48k' : '44.1k'}"` : ''}>
          <spine>
${clips.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
writeFileSync(args.out, xml);
console.log(`${clips.length} clips · ${(offset * fdNum / fdDen).toFixed(3)}s at ${(fdDen / fdNum).toFixed(3)} fps → ${args.out}`);
