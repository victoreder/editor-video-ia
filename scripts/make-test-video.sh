#!/usr/bin/env bash
# Gera um vídeo de teste (sem chaves/câmera): uma foto com rosto em 9:16 com leve
# movimento + "fala" sintética (rajadas de tom com pausas), para testar o pipeline.
#   scripts/make-test-video.sh <imagem-com-rosto.png> <saida.mp4> [segundos]
set -euo pipefail
IMG="$1"; OUT="$2"; DUR="${3:-14}"
# fala: blocos de ~1,4 s com pausas de 0,3 s e uma pausa longa de 1,2 s no meio
AUD="aevalsrc='0.4*sin(2*PI*(180+40*sin(2*PI*3*t))*t)*between(mod(t,1.7),0,1.4)*(1-between(t,6.0,7.2))':s=48000:d=${DUR}"
ffmpeg -y -v error -loop 1 -i "$IMG" -f lavfi -i "$AUD" \
  -filter_complex "[0:v]scale=1080:1080,pad=1080:1920:0:300:color=0x334455,zoompan=z='1+0.0008*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,format=yuv420p[v]" \
  -map "[v]" -map 1:a -t "$DUR" -c:v libx264 -preset veryfast -crf 23 -c:a aac -shortest "$OUT"
echo "$OUT"
