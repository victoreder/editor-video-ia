#!/usr/bin/env python3
"""Listen to every cut of a rendered reel and compare it with the captions.

    check-cuts.py <rendered.mp4> <segments.json> <words.json> [--window 1.6] [--model turbo]

Whisper's word times drift, most of all over road noise, fans or a quiet
speaker: a word can be placed half a second early, so a cut set from word
times clips it ("we shipped in three [weeks]") or keeps the tail of a word
the take was meant to drop ("zero designers. [and] I thought..."). Captions built
from the same times look right while the audio is wrong, so this reads
the AUDIO: for each cut it transcribes the last WINDOW seconds of the take
and the first WINDOW seconds of the next take, each clip on its own (no
context to guess from), and prints what was heard next to the caption
words for the same span, in edit seconds.

A cut is FLAGGED when a word heard at the edge of the window is missing
from the captions (a clipped leftover such as "was", "is", "and"), or a
caption word at the edge was not heard (a word the cut chopped off).
Whisper mishears short clips, so a flag means listen to that cut, not
that it is wrong. Fix a real one by moving the take's a/b in
segments.json (find the true word edges with the recipe in SKILL.md,
section 8), rerun cut.py and re-render.

Exit status is 0 when nothing is flagged, 1 otherwise.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

WHISPER = shutil.which("whisper") or "/opt/anaconda3/bin/whisper"  # openai-whisper CLI
FPS = 30


def norm(w):
    return re.sub(r"[^a-z0-9']", "", w.lower())


def heard(mp4, a, b, tmp, model, tag):
    wav = os.path.join(tmp, f"{tag}.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", mp4,
                    "-vn", "-ac", "1", "-ar", "16000", wav], check=True)
    subprocess.run([WHISPER, wav, "--model", model, "--language", "en", "--output_format", "json",
                    "--output_dir", tmp, "--fp16", "False", "--condition_on_previous_text", "False"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    with open(os.path.join(tmp, f"{tag}.json")) as f:
        return " ".join(s["text"].strip() for s in json.load(f)["segments"]).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp4")
    ap.add_argument("segments")
    ap.add_argument("words")
    ap.add_argument("--window", type=float, default=1.6)
    ap.add_argument("--model", default="turbo")
    a = ap.parse_args()

    segs = json.load(open(a.segments))["segments"]
    words = json.load(open(a.words))
    cuts, t = [], 0.0
    for s in segs:
        t += s["frames"] / FPS
        cuts.append(t)

    def caption(lo, hi):
        return [w["word"] for w in words if w["end"] > lo + 0.05 and w["start"] < hi - 0.05]

    tmp = tempfile.mkdtemp(prefix="cutcheck-")
    flagged = 0
    for i, c in enumerate(cuts[:-1]):
        print(f"-- cut {i + 1} at {c:6.2f}s edit   (take {i + 1} ends at orig {segs[i]['b']}, take {i + 2} starts at orig {segs[i + 1]['a']})")
        for side, lo, hi in (("end", max(0.0, c - a.window), c), ("start", c, c + a.window)):
            h = heard(a.mp4, lo, hi, tmp, a.model, f"c{i}_{side}")
            cap = caption(lo, hi)
            hw = [norm(x) for x in h.split() if norm(x)]
            cw = [norm(x) for x in " ".join(cap).split() if norm(x)]
            notes = []
            if hw and cw:
                # the word at the cut edge: last of the end window, first of the start window
                edge_h, edge_c = (hw[-1], cw[-1]) if side == "end" else (hw[0], cw[0])
                if edge_h not in cw:
                    notes.append(f"heard '{edge_h}' at the {side} that the captions do not have")
                if edge_c not in hw:
                    notes.append(f"caption '{edge_c}' at the {side} was not heard")
            elif cw and not hw:
                notes.append("heard nothing")
            mark = "  FLAG" if notes else "  ok  "
            flagged += bool(notes)
            print(f"{mark} {side:5}  heard:   {h!r}\n              caption: {' '.join(cap)!r}")
            for n in notes:
                print(f"              -> {n}")
    print(f"\n{len(cuts) - 1} cuts, {flagged} window(s) flagged" + ("; listen to those." if flagged else "."))
    sys.exit(1 if flagged else 0)


if __name__ == "__main__":
    main()
