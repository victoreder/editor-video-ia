#!/usr/bin/env python3
"""Recorte da pessoa (fase 3, "texto atrás da pessoa").

Lê um trecho do vídeo (proxy), segmenta a pessoa quadro a quadro com o
MediaPipe Selfie Segmentation (CPU) e grava um WebM VP9 com canal alfa: só a
pessoa fica opaca. O app desenha o texto entre o vídeo e este recorte.
Inspirado em motion-script/matte-footage.py e kamgasimo/cutouts.mjs (MIT), sem
torch: roda em qualquer VPS.

uso: matte.py --input proxy.mp4 --start 3.2 --end 6.1 --output pessoa.webm [--width 720]
"""
import argparse
import json
import subprocess
import sys

import cv2
import numpy as np


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate",
                          "-of", "json", path], capture_output=True, text=True, check=True)
    s = json.loads(out.stdout)["streams"][0]
    n, d = s["r_frame_rate"].split("/")
    return int(s["width"]), int(s["height"]), float(n) / float(d or 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--width", type=int, default=720)
    args = ap.parse_args()

    import mediapipe as mp  # 0.10.x (solutions)

    w, h, fps = probe(args.input)
    ow = args.width - args.width % 2
    oh = int(round(ow * h / w))
    oh -= oh % 2
    dur = max(0.1, args.end - args.start)
    reader = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{args.start:.3f}", "-t", f"{dur:.3f}", "-i", args.input,
                               "-vf", f"scale={ow}:{oh},fps={fps}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    writer = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{ow}x{oh}", "-r", f"{fps}",
                               "-i", "-", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "2M",
                               "-deadline", "realtime", "-cpu-used", "6", args.output], stdin=subprocess.PIPE)
    seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
    size = ow * oh * 3
    prev = None
    n = 0
    while True:
        buf = reader.stdout.read(size)
        if len(buf) < size:
            break
        rgb = np.frombuffer(buf, np.uint8).reshape((oh, ow, 3))
        m = seg.process(rgb).segmentation_mask.astype(np.float32)
        # suaviza no tempo (sem tremer a borda) e no espaço (sem serrilhado)
        prev = m if prev is None else prev * 0.45 + m * 0.55
        a = np.clip((prev - 0.35) / 0.3, 0, 1)
        a = cv2.GaussianBlur(a, (5, 5), 0)
        rgba = np.dstack([rgb, (a * 255).astype(np.uint8)])
        writer.stdin.write(rgba.tobytes())
        n += 1
    reader.wait()
    writer.stdin.close()
    writer.wait()
    print(f"{n} quadros recortados -> {args.output}")
    return 0 if n else 1


if __name__ == "__main__":
    sys.exit(main())
