#!/usr/bin/env node
// A transcript of the finished master → caption chunks to burn in, and a subtitle file.
//
//   node captions.mjs <words.json> --out captions.json [--srt captions.srt] [--duration secs]
//        [--max 3] [--case upper|spoken] [--glossary "Name, Brand"] [--fix "heard=Right"] … [--lead 0.05]
//        [--language en]
//
// words.json is transcribe.mjs --mode clean --aligned run on the master, so every caption is timed to
// what the edit says. A burned-in chunk holds at most --max words and ends early at punctuation; it
// shows from its first word until the next chunk begins, and each word is the active one from its
// start until the next word's. Captions appear --lead seconds early, so the eye meets the word as it
// is heard. The subtitle file groups words into lines of up to 42 characters, broken at sentence ends.
//
// Glossary spellings replace what the transcriber heard, including a name it split in two
// ("Super base" → "Supabase"); --fix replaces a specific mishearing ("Get hub=GitHub").

import { writeFileSync } from 'node:fs';
import { parseArgs, die, readJson, writeJson, num, isMain } from './common.mjs';

const key = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const lead = (t) => t.match(/^[^\p{L}\p{N}]*/u)[0];
const trail = (t) => t.match(/[^\p{L}\p{N}%']*$/u)[0];

// Replace every run of words that matches a rule, word by word or run together, with the rule's text.
export function correct(words, { glossary = [], fixes = [] } = {}) {
  const rules = [
    ...glossary.map((g) => ({ from: g.split(/\s+/).map(key).filter(Boolean), to: g })),
    ...fixes.map((f) => { const [heard, right] = f.split('='); return { from: heard.split(/\s+/).map(key).filter(Boolean), to: (right || '').trim() }; }),
  ].filter((r) => r.from.length && r.to);
  const out = [];
  for (let i = 0; i < words.length;) {
    let hit = null;
    for (const r of rules) {
      const n = r.from.length;
      if (i + n <= words.length && r.from.every((k, j) => key(words[i + j].text) === k)) { hit = { n, to: r.to }; break; }
      const joined = r.from.join('');
      for (let m = 2; m <= 3 && !hit; m++) {
        if (i + m > words.length) break;
        if (words.slice(i, i + m).map((w) => key(w.text)).join('') === joined) hit = { n: m, to: r.to };
      }
      if (hit) break;
    }
    if (!hit) { out.push({ ...words[i] }); i++; continue; }
    const first = words[i], last = words[i + hit.n - 1];
    out.push({ text: lead(first.text) + hit.to + trail(last.text), start: first.start, end: last.end });
    i += hit.n;
  }
  return out;
}

// What a burned-in caption shows of a word: no edge punctuation except a question or exclamation mark.
function shown(text, upper) {
  const core = text.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}%'?!]+$/u, '');
  return upper ? core.toUpperCase() : core;
}

// Words that lean on the next one: a chunk that fills up on one of these hands it to the next chunk,
// so a caption never ends on "and" or "the". English only; other languages break by count alone.
const LEANS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'so', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'that', 'i', 'my', 'your', 'our']);

export function chunk(words, { max = 3, duration, early = 0.05, upper = true, language = 'en' } = {}) {
  const leans = (w) => language.startsWith('en') && LEANS.has(w.text.toLowerCase().replace(/[^\p{L}']/gu, ''));
  const groups = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (/[,.;:!?…]$/.test(w.text)) { groups.push(cur); cur = []; }
    else if (cur.length >= max) {
      const carry = cur.length > 1 && leans(cur[cur.length - 1]) ? [cur.pop()] : [];
      groups.push(cur); cur = carry;
    }
  }
  if (cur.length) groups.push(cur);
  const t = (x) => Math.max(0, x - early);
  const end = duration ?? (words.length ? words[words.length - 1].end + 0.5 : 0);
  return groups.map((g, i) => {
    const next = i + 1 < groups.length ? t(groups[i + 1][0].start) : end;
    // A caption never lingers more than 1.2 s past its last word's start, however long the pause after it.
    const cEnd = Math.min(next, g[g.length - 1].start + 1.2, end);
    const cStart = t(g[0].start);
    return {
      start: +cStart.toFixed(3),
      end: +Math.max(cEnd, cStart + 0.1).toFixed(3),
      words: g.map((w, j) => ({
        text: shown(w.text, upper),
        start: +t(w.start).toFixed(3),
        end: +(j + 1 < g.length ? t(g[j + 1].start) : Math.max(cEnd, cStart + 0.1)).toFixed(3),
      })).filter((w) => w.text),
    };
  }).filter((c) => c.words.length);
}

// Sentences, each split into lines of at most maxChars. Each break is chosen to balance the lines,
// and a break after a comma is preferred — so no line is left holding one word.
export function subtitleCues(words, { maxChars = 42, duration } = {}) {
  const len = (ws) => ws.map((w) => w.text).join(' ').length;
  const lines = (ws) => {
    if (len(ws) <= maxChars || ws.length === 1) return [ws];
    const target = len(ws) / Math.ceil(len(ws) / maxChars);
    let best = 1, bestCost = Infinity;
    for (let i = 1; i < ws.length && len(ws.slice(0, i)) <= maxChars; i++) {
      const cost = Math.abs(len(ws.slice(0, i)) - target) - (/,$/.test(ws[i - 1].text) ? target * 0.3 : 0);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    return [ws.slice(0, best), ...lines(ws.slice(best))];
  };
  const cues = [];
  let cur = [];
  for (const w of words) { cur.push(w); if (/[.?!…]$/.test(w.text)) { cues.push(...lines(cur)); cur = []; } }
  if (cur.length) cues.push(...lines(cur));
  const end = duration ?? (words.length ? words[words.length - 1].end + 0.5 : 0);
  return cues.map((c, i) => {
    const next = i + 1 < cues.length ? cues[i + 1][0].start : end;
    const cEnd = Math.min(next, c[c.length - 1].start + 1.5, end);
    return { start: c[0].start, end: Math.max(cEnd, Math.min(next, c[0].start + 0.5)), text: c.map((w) => w.text).join(' ') };
  });
}

function srtTime(s) {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file || !args.out) die('usage: captions.mjs <words.json> --out captions.json [--srt f] [--duration s] [--max n] [--case upper|spoken] [--glossary list] [--fix heard=Right] [--lead s] [--language code]');
  const duration = args.duration !== undefined ? num(args.duration) : undefined;
  const glossary = typeof args.glossary === 'string' ? args.glossary.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const fixes = [].concat(args.fix || []).filter((f) => typeof f === 'string' && f.includes('='));
  const words = correct(readJson(file), { glossary, fixes });
  const upper = args.case !== 'spoken';
  const chunks = chunk(words, { max: num(args.max, 3), duration, early: num(args.lead, 0.05), upper, language: typeof args.language === 'string' ? args.language : 'en' });
  writeJson(args.out, { duration: duration ?? null, case: upper ? 'upper' : 'spoken', chunks });
  console.log(`${chunks.length} caption chunks from ${words.length} words → ${args.out}`);
  for (const c of chunks.slice(0, 5)) console.log(`  ${c.start.toFixed(2)}–${c.end.toFixed(2)}  ${c.words.map((w) => w.text).join(' ')}`);
  if (typeof args.srt === 'string') {
    const cues = subtitleCues(words, { duration });
    writeFileSync(args.srt, cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'));
    console.log(`${cues.length} subtitle cues → ${args.srt}`);
  }
}
