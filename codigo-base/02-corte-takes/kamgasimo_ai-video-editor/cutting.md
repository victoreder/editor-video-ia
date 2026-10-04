# Cutting: settling candidates, and fixing a failed check

The planner confirms what the evidence settles and marks the rest `?`. This page is the procedure
for each `?`, and for each way the master's check can fail. Scripts are in this skill's `scripts/`
folder; run them with the full path, as in SKILL.md.

## Why transcripts alone can't place a cut

- **Transcribers tidy speech.** A plain transcript drops most fillers, which is why the edit makes
  a second, verbatim transcript primed to keep them. Neither one is complete: an "uh" said in a low,
  creaky voice (vocal fry) often appears in neither.
- **Word times drift.** They move by a few tenths of a second, and by more around pauses. A cut
  placed on a transcript's times clips the next word, so every cut is placed on the measured sound
  instead.
- **A span transcribed alone tells what it holds.** A filler decodes as "um" or "uh". A span with
  no words decodes as a stock phrase ("Thank you.", "you") or as nothing. Real words decode as
  themselves.

## Settling a `?` (from A to B seconds)

**1. Look at the sound, with a little on either side:**

```sh
node scripts/acoustics.mjs "VIDEO" --from <A−0.4> --to <B+0.4>
```

It prints one row every 30 ms. The columns are energy (dB), voicing (0–1), pitch (f0, Hz),
zero-crossing rate, and brightness (the bar).

| Sound | Energy | Voicing | Pitch | Zero crossings, brightness |
|---|---|---|---|---|
| Held filler, "um" or "uh" | speech level | 0.55 or more, steady | flat, within about 15 Hz | low, no bar |
| Vocal-fry "uh" | 10–20 dB below speech | 0.3–0.6, uneven | jumps, often under 100 Hz | low |
| Vowel of a word | speech level | high | moves | low, between bright consonants |
| End of a word (s, sh, f, ts) | falling | under 0.3 | none or jumping | high (over 2500 Hz), long bar |
| Breath | well below speech | under 0.3 | none | medium, noisy |
| Silence | near the floor | — | — | — |

**2. Transcribe the span alone, and the second on either side of it:**

```sh
node scripts/transcribe.mjs "VIDEO" --slice A:B --slice <A−1>:A --slice B:<B+1> --language LANG
```

- The span decodes as "um" or "uh": a filler.
- The span decodes as a stock phrase or nothing: a non-word sound.
- The span decodes as words: speech.
- The neighbouring slices must come out whole. A word cut in half there means the span reaches
  into it.

**3. Decide, and record it with `adjust-cuts.mjs`:**

- **Remove a filler or a non-word sound** when two things hold:
  - its signature matches a filler or a vocal fry;
  - the neighbouring slices show the words on both sides complete without it.

  Place the edges in the quiet around it. Start within 0.05 s after the last voiced or bright frame
  of the word before. End at least 0.03 s before the next word's onset, where the energy rises.

  ```sh
  --remove A:B --why "held 'uh' at 110 Hz for 0.45 s; slice heard 'uh'; 'and' before and 'you' after whole"
  ```

- **A filler fused to a word** ("and-uh", "so-um"): cut only the filler, where the acoustics show
  the word ending (voicing or pitch changes). If the two can't be separated, remove the span and
  name the word it takes with `--words "and"`. Do this only when the sentence still reads right
  without the word; a conjunction opening a clause usually does. `--words` is what keeps the
  expected text true.
- **Keep it** (`--dismiss A:B --why "…"`) in any of these cases:
  - the span holds words;
  - a neighbouring slice loses a word;
  - the evidence is mixed.

  A leftover "uh" is a smaller flaw than a clipped word.
- **A `?` retake**: read both sentences in `WORK/clean.json`.
  - If the later sentence restarts the earlier one, the earlier one goes: `--remove A:B:retake`.
  - If they merely start alike and say different things, keep both.

## When the master's check fails

The check prints each problem with its time in the master and its time in the source. Changes to
the cut list are made at the source time.

- **words, missing "x"**: a removal clipped a word.
  1. Find "x" in `WORK/clean.json` near the source time.
  2. Find the removal beside it in `WORK/cuts.json`.
  3. Narrow that removal: `--restore A:B`, then `--remove` the narrower span with a `--why` that
     says what changed. If nothing can be kept, leave the removal restored.
- **words, added "x"**: the master says a word the expected text lacks. Slice the master at the
  master time to hear it in context (`transcribe.mjs "WORK/master.mov" --slice …`).
  - It is a real word that belongs: a removal claimed it from the expected text. Narrow that
    removal, or correct its `--words`.
  - It is a filler, or the remains of a retake: settle it as a `?` at its source time.
- **fillers, confirmed at a time**: settle it as a `?` at its source time, then remove it.
- **fillers, LISTEN at a time**: a sound that decodes as a stock phrase. Settle it as a `?`. If it
  stays unclear, keep it and add a report note naming the time, so the user can listen.
- **duration, streams in step, or frame size**: a rendering problem, not a cut problem. Render and
  check again. If it persists, say so in the report.
- **loudness**: normalise again from `WORK/master.cut.mov`.
