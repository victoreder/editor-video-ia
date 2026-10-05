// sfx:fetch alinha o PICO de cada gravação real onde o código espera (SFX_LEAD),
// para o whoosh "passar" exatamente na entrada da cena.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepare} from '../scripts/fetch-sfx';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
})();

test('sfx:fetch: pico alinhado no lead e normalizado em −1 dBFS', {skip: !hasFfmpeg && 'sem ffmpeg'}, () => {
  // 0,3 s de silêncio + rampa de 0,5 s até um pico, depois decai: simula um whoosh com cauda
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfxt-'));
  const mp3 = path.join(dir, 'w.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', "aevalsrc='if(lt(t,0.3),0,if(lt(t,0.8),(t-0.3)*2,exp(-(t-0.8)*8)))*sin(2*PI*400*t)':s=48000:d=1.5", '-c:a', 'libmp3lame', '-b:a', '192k', mp3]);
  const pcm = prepare(fs.readFileSync(mp3), 0.18, 0.9);
  fs.rmSync(dir, {recursive: true, force: true});
  let peak = 0;
  let at = 0;
  pcm.forEach((v, i) => {
    if (Math.abs(v) > peak) {
      peak = Math.abs(v);
      at = i;
    }
  });
  assert.ok(Math.abs(at / 48000 - 0.18) < 0.02, `pico em ${(at / 48000).toFixed(3)} s`);
  assert.ok(peak > 0.85 && peak <= 0.9, `pico ${peak}`);
  assert.ok(pcm.length <= 0.9 * 48000 + 1);
});
