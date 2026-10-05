#!/usr/bin/env python3
"""Rastreamento de rosto (módulo 05) para zoom centrado e legenda fora do rosto.

Usa o detector YuNet do OpenCV (modelo ONNX de ~230 KB, sem torch/mediapipe),
amostrado a poucos fps, e gera uma trilha normalizada (0..1):
  {"samples": [{"t", "cx", "cy", "w", "h", "chinY"}, ...]}
Entre amostras o app interpola/segura. Baseado em motion-script/face-track.py e
ghost-editor/face_track.py (MIT). Lê os frames via ffmpeg (rotação já aplicada).

uso: face_track.py --input video.mp4 --output face.json [--fps 5] [--width 480]
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
MODEL = HERE / "models" / "face_detection_yunet_2023mar.onnx"


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height:stream_side_data=rotation:stream_tags=rotate", "-show_entries", "format=duration",
         "-of", "json", str(path)], capture_output=True, text=True, check=True)
    j = json.loads(out.stdout)
    s = j["streams"][0]
    w, h = int(s["width"]), int(s["height"])
    rot = 0
    for sd in s.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = abs(int(sd["rotation"])) % 180
    if "tags" in s and "rotate" in s["tags"]:
        rot = abs(int(s["tags"]["rotate"])) % 180
    if rot == 90:
        w, h = h, w
    return w, h, float(j["format"]["duration"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--fps", type=float, default=5.0)
    ap.add_argument("--width", type=int, default=480)
    args = ap.parse_args()

    w, h, duration = probe(args.input)
    dw = args.width - args.width % 2
    dh = int(round(dw * h / w))
    dh -= dh % 2
    det = cv2.FaceDetectorYN.create(str(MODEL), "", (dw, dh), score_threshold=0.7, nms_threshold=0.3, top_k=5)

    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", args.input, "-vf", f"fps={args.fps},scale={dw}:{dh}",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    frame_bytes = dw * dh * 3
    samples = []
    i = 0
    prev = None
    while True:
        buf = proc.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        img = np.frombuffer(buf, np.uint8).reshape((dh, dw, 3))
        t = i / args.fps
        i += 1
        _, faces = det.detect(img)
        if faces is None or len(faces) == 0:
            continue
        # o maior rosto; em empate, o mais próximo do anterior (estabilidade)
        def key(f):
            area = f[2] * f[3]
            if prev is None:
                return area
            d = abs((f[0] + f[2] / 2) / dw - prev[0]) + abs((f[1] + f[3] / 2) / dh - prev[1])
            return area * (1 - min(0.9, d))
        f = max(faces, key=key)
        x, y, fw, fh = [float(v) for v in f[:4]]
        # landmarks YuNet: olhos (4..7), nariz (8,9), cantos da boca (10..13)
        mouth_y = (float(f[11]) + float(f[13])) / 2
        eyes_y = (float(f[5]) + float(f[7])) / 2
        chin = min(dh, mouth_y + (mouth_y - eyes_y) * 0.9)
        cx = (x + fw / 2) / dw
        cy = (y + fh / 2) / dh
        prev = (cx, cy)
        samples.append({
            "t": round(t, 3), "cx": round(cx, 4), "cy": round(cy, 4),
            "w": round(fw / dw, 4), "h": round(fh / dh, 4), "chinY": round(chin / dh, 4),
        })
    proc.wait()
    Path(args.output).write_text(json.dumps({"method": "yunet", "fps": args.fps, "width": w, "height": h,
                                             "duration": duration, "samples": samples}))
    print(f"{len(samples)} amostras de rosto em {i} frames -> {args.output}")


if __name__ == "__main__":
    sys.exit(main())
