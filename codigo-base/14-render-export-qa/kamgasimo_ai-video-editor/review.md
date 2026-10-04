# Review: critiquing your own draft

After each draft render, make the review sheet and read it the way a demanding editor would. Each row
of `sheets.mjs` is one beat — its entrance, its peak, its exit.

```sh
node scripts/sheets.mjs "WORK/render/<format>-draft.mp4" --plan "WORK/edit.json" --out "WORK/review-<n>.jpg"
```

## The checklist

For every row:

1. **Fit.** Every graphic is whole inside its box. No text is cut off, overflowing or wrapping badly.
2. **Readable.** Text contrasts with what is behind it. Over the speaker, titles sit on pills.
   Captions are legible at phone size.
3. **Mouth clear.** No caption, sticker or title crosses the mouth, including at the deepest zoom.
4. **Face in frame.** The head is not cut at the eyes. Split and pip boxes show the face, not the
   shoulder.
5. **Arrived.** At the peak frame, the graphic's elements are in place. An empty panel at the peak
   means the landing words are wrong.
6. **Sync.** Each element's word is spoken at its entrance frame (the legend gives the times).
7. **Transitions.** The exit frame of a beat with a transition shows the effect in motion, not a
   broken frame.
8. **Taste.** Is anything here generic, repeated or busy? Would a viewer remember this beat? Is a
   bespoke scene called for?

For the whole sheet:

- **Rhythm.** The rows alternate between speaker and graphics. No three graphics in a row without the
  speaker unobstructed between them, and no long run with nothing.
- **The hook.** The first row is the strongest.

## Fixing

| Problem | Fix |
|---|---|
| Overflow or bad wrapping | shorter text, fewer items, or a larger layout (split instead of overlay) |
| Late or empty at peak | correct each item's `word`, or move `at` |
| Caption on the mouth | the composer already moved it; if still, lower the zoom in that beat |
| Busy | drop a graphic; let the sentence stay on the speaker |
| Generic | write a custom scene for the beat (reference/graphics.md) |
| Weak hook | rewrite `hook.title`; consider text behind the speaker |

Change `edit.json`, run `edit-plan.mjs check`, render the draft again and review again. Stop after
three rounds; name what is still imperfect in the report.
