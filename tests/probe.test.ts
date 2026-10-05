// Leitura do vídeo sem ffprobe (só ffmpeg): mesmo resultado do ffprobe, inclusive girado.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {probe, probeWithFfmpeg} from '../src/lib/media/ffmpeg';

test('probe via ffmpeg = probe via ffprobe (com áudio, sem áudio, girado)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  const a = path.join(dir, 'a.mp4');
  const b = path.join(dir, 'b.mp4');
  const r = path.join(dir, 'r.mov');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=1920x1080:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', a]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=1080x1920:r=60:d=3', '-c:v', 'libx264', b]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-display_rotation', '90', '-i', a, '-c', 'copy', r]);
  for (const f of [a, b, r]) assert.deepEqual(await probeWithFfmpeg(f), await probe(f));
  assert.deepEqual(await probeWithFfmpeg(r), {duration: 2, width: 1080, height: 1920, fps: 30, hasAudio: true, rotation: 90});
});
