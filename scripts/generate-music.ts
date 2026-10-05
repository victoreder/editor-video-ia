// Gera as trilhas sintetizadas que vêm com o app: public/music/{upbeat,calm,cinematic}.mp3
//   npm run music:generate
import fs from 'node:fs';
import path from 'node:path';
import {writeMusicMp3} from '../src/lib/media/music-synth';

const out = path.join(process.cwd(), 'public', 'music');
fs.mkdirSync(out, {recursive: true});
for (const mood of ['upbeat', 'calm', 'cinematic'] as const) {
  writeMusicMp3(mood, path.join(out, `${mood}.mp3`));
  console.log(`music/${mood}.mp3`);
}
