#!/usr/bin/env bash
# Instala ffmpeg + ffprobe estáticos em $1 (padrão /tmp/ff) para o worker na Vercel Sandbox.
# Tenta, nesta ordem, e só aceita se o binário realmente roda:
#   1. build atual do GitHub (BtbN, .tar.xz — instala o xz se faltar)
#   2. binários do registro do npm (.tgz — só precisa de gzip; ffmpeg 4.1, suficiente para o pipeline)
#   3. espelho johnvansickle (.tar.xz)
set -u
DIR="${1:-/tmp/ff}"
mkdir -p "$DIR"
ok() { "$DIR/ffmpeg" -version >/dev/null 2>&1 && "$DIR/ffprobe" -version >/dev/null 2>&1; }
if ok; then echo "ffmpeg já instalado"; exit 0; fi

ensure_xz() { command -v xz >/dev/null 2>&1 || sudo dnf install -y -q xz >/dev/null 2>&1 || true; }

echo "== 1/3 GitHub (BtbN)"
ensure_xz
curl -fsSL --retry 3 https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz \
  | tar -xJ -C "$DIR" --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe'
chmod +x "$DIR/ffmpeg" "$DIR/ffprobe" 2>/dev/null
if ok; then "$DIR/ffmpeg" -version | head -1; exit 0; fi

echo "== 2/3 registro do npm"
curl -fsSL --retry 3 https://registry.npmjs.org/@ffmpeg-installer/linux-x64/-/linux-x64-4.1.0.tgz | tar -xz -C "$DIR" --strip-components=1 package/ffmpeg
curl -fsSL --retry 3 https://registry.npmjs.org/@ffprobe-installer/linux-x64/-/linux-x64-5.2.0.tgz | tar -xz -C "$DIR" --strip-components=1 package/ffprobe
chmod +x "$DIR/ffmpeg" "$DIR/ffprobe" 2>/dev/null
if ok; then "$DIR/ffmpeg" -version | head -1; exit 0; fi

echo "== 3/3 johnvansickle"
ensure_xz
curl -fsSL --retry 3 https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  | tar -xJ -C "$DIR" --strip-components=1 --wildcards '*/ffmpeg' '*/ffprobe'
chmod +x "$DIR/ffmpeg" "$DIR/ffprobe" 2>/dev/null
if ok; then "$DIR/ffmpeg" -version | head -1; exit 0; fi

echo "FALHOU: nenhuma fonte do ffmpeg funcionou"
exit 1
