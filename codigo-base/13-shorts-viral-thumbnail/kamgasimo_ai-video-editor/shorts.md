# Long video → Shorts

When the recording is long and the user asked for Shorts, find its best self-contained moments and
edit each one as its own vertical video, through the same phases as the main edit.

## Find the moments

```sh
node scripts/moments.mjs --work "WORK" --count <n> --min 20 --max 60
```

It ranks runs of whole sentences by hook, standalone opening, payoff, energy and length, and writes
`WORK/moments.json`. **Read each candidate's text and judge it yourself.** The score only shortlists.
Keep the ones that:

- make sense with no context;
- open strongly;
- end on a point.

## Edit each moment

For moment k, spanning source seconds A to B, make a work folder `WORK/short-<k>/`. Then run the edit
from phase 4 with these differences:

1. **Plan the cut with the range.** Run `plan-cuts.mjs` as in phase 4 with `--from A --to B` and
   `--out "WORK/short-<k>/cuts.json" --expected "WORK/short-<k>/expected.txt"`. The same
   transcripts and acoustics serve every moment.
2. **Settle, cut, check** as in phase 4, inside `WORK/short-<k>/`.
3. **Finish** as in phase 5, with `--formats vertical` and a hook title written for this moment alone.
   A Short needs its own hook: the first sentence of a moment was not written to open a video.
4. **Deliver** as `OUT/NAME-short-<k>.mp4`, with its own cover (`thumbnail.mjs make --kind cover`).

Report each Short in `EDIT-REPORT.md` with its span, its hook and its checks.
