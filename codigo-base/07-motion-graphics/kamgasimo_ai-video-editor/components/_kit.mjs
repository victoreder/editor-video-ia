// Shared helpers for components. A component module exports:
//
//   meta   { name, summary, props }            what it shows and what it takes
//   render(props, ctx) → { html, css, js, events }
//
// ctx gives the component everything it may depend on:
//   id        the container's element id; scope every CSS rule with `#${id}`
//   t0, t1    when the graphic is on screen (seconds, output timeline)
//   box       { w, h } of its container in pixels — lay out for this box, whatever the format
//   tokens    the style's palette and fonts
//   word(text, from?) → the time the word is spoken (first match at or after `from`, within the
//             graphic's span), or null; land each element on its word
//   icon(name, attrs?) → an inline Lucide SVG
//   motion    the style's entrance vocabulary: 'pop' | 'slam' | 'rise' | 'fade'
// js is statements run with `tl` (the paused GSAP timeline) in scope; every time in it is absolute.
// events are the moments the component reveals something — { at, kind: 'enter' | 'reveal' | 'type' |
// 'press' | 'count' } — from which sound effects are cued.

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const r3 = (x) => Math.round(x * 1000) / 1000;

// The entrance for an element at time t, per the style's motion vocabulary.
export function enter(sel, t, motion = 'pop', { dur, from } = {}) {
  const at = r3(t);
  switch (motion) {
    case 'slam': return `tl.fromTo('${sel}',{opacity:0,scale:1.9,rotation:-4},{opacity:1,scale:1,rotation:0,duration:${dur ?? 0.22},ease:'power4.out'},${at});`;
    case 'rise': return `tl.fromTo('${sel}',{opacity:0,y:${from ?? 46},filter:'blur(10px)'},{opacity:1,y:0,filter:'blur(0px)',duration:${dur ?? 0.45},ease:'power3.out'},${at});`;
    case 'fade': return `tl.fromTo('${sel}',{opacity:0},{opacity:1,duration:${dur ?? 0.5},ease:'power1.out'},${at});`;
    default: return `tl.fromTo('${sel}',{opacity:0,scale:0.35,rotation:-6},{opacity:1,scale:1,rotation:0,duration:${dur ?? 0.34},ease:'back.out(2.3)'},${at});`;
  }
}
export function exit(sel, t, { dur = 0.22 } = {}) {
  return `tl.to('${sel}',{opacity:0,y:-24,duration:${dur},ease:'power2.in'},${r3(t)});`;
}

// When an element should arrive: two frames before its word (anticipation reads as sync; lateness
// reads as a mistake), else spread evenly across the span.
export function landings(items, ctx, key = 'word') {
  const n = items.length, span = ctx.t1 - ctx.t0;
  let from = ctx.t0;
  return items.map((it, i) => {
    const w = it[key] ? ctx.word(it[key], from) : null;
    if (w !== null) from = w + 0.01;
    const t = w !== null ? w - 0.08 : ctx.t0 + 0.25 + (span - 0.6) * (n === 1 ? 0 : i / (n - 1)) * 0.8;
    return Math.max(ctx.t0 + 0.05, r3(t));
  });
}

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// A font size that fits `chars` characters of display type across `width` pixels.
export const fitSize = (chars, width, max, ratio = 0.62) => Math.floor(Math.min(max, width / Math.max(1, chars * ratio)));
