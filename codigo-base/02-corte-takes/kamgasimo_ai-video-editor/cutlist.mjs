// What a cut list keeps, and what it must still say — shared by plan-cuts.mjs and adjust-cuts.mjs so
// both always compute them the same way.

export const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

// Hesitation sounds in the languages the transcriber hears most. "er", "ah" and "eh" count only in
// English: elsewhere they can be words ("er" is German for "he").
const HESITATIONS = ['um', 'umm', 'uhm', 'uh', 'uhh', 'hmm', 'hm', 'mm', 'mmm', 'erm', 'ehm', 'euh', 'heu', 'äh', 'ähm', 'öhm', 'hã', 'ahn'];
const ENGLISH_ONLY = ['er', 'ah', 'eh'];
export function fillerWords(language) {
  const english = !language || language === 'auto' || language.startsWith('en');
  return new Set(english ? [...HESITATIONS, ...ENGLISH_ONLY] : HESITATIONS);
}
// What a transcribed slice must contain to count as a filler: only unambiguous hesitation sounds.
const HESITATION = '(?<![\\p{L}\\p{N}])(?:u+m+|u+h+m*|e+r+m+|e+h+m+|h+m+|m{2,}|e+u+h+|h+e+u+|ä+h+m*|ö+h+m+|h+ã+)(?![\\p{L}\\p{N}])';
export const FILLER_RE = new RegExp(HESITATION, 'iu');
export const stripFillers = (text) => text.replace(new RegExp(HESITATION, 'giu'), '');

// The complement of the removals, dropping fragments too short to be anything but a click.
export function keepFrom(removed, duration) {
  const spans = removed.map((r) => [r.start, r.end]).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const s of spans) { const l = merged[merged.length - 1]; if (l && s[0] <= l[1] + 0.02) l[1] = Math.max(l[1], s[1]); else merged.push([...s]); }
  const keep = [];
  let cursor = 0;
  for (const [a, b] of merged) { if (a > cursor) keep.push({ start: +cursor.toFixed(2), end: +a.toFixed(2) }); cursor = Math.max(cursor, b); }
  if (cursor < duration) keep.push({ start: +cursor.toFixed(2), end: +duration.toFixed(2) });
  return keep.filter((k) => k.end - k.start >= 0.12);
}

// Which words the cut still says. Timestamps drift by a few tenths of a second, so a word next to a cut
// cannot be judged by its time alone:
// - a pause removal takes out silence, never a word;
// - a filler removal takes out only the words it names in `words` (a conjunction fused to an "uh"), each
//   matched to its nearest occurrence — fillers themselves are never expected;
// - dead-air, retake and word removals take the words whose calibrated start falls inside them.
export function expectedWords(clean, removed, language) {
  const fillers = fillerWords(language);
  const gone = new Set();
  for (const r of removed) {
    if (r.kind === 'pause') continue;
    if (r.kind === 'filler') {
      for (const w of r.words || []) {
        let best = -1, bestD = Infinity;
        clean.forEach((c, i) => {
          if (gone.has(i) || norm(c.text) !== norm(w)) return;
          const d = Math.abs(c.start - (r.start + r.end) / 2);
          if (d < bestD) { best = i; bestD = d; }
        });
        if (best >= 0 && bestD < 1.5) gone.add(best);
      }
      continue;
    }
    clean.forEach((c, i) => { if (c.start + 0.05 >= r.start && c.start + 0.05 < r.end) gone.add(i); });
  }
  return clean.filter((c, i) => !gone.has(i) && !fillers.has(norm(c.text))).map((c) => c.text);
}
