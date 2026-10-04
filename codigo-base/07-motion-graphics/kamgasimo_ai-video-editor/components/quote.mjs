import { esc, r3, clamp } from './_kit.mjs';

export const meta = {
  name: 'quote',
  summary: 'A pull quote: the words that matter, set large, revealed word by word as they are spoken, with an optional attribution. For the line the viewer should remember.',
  props: { text: 'the quote, as spoken', highlight: 'optional words to colour', author: 'optional attribution' },
};

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens;
  const words = String(p.text || '').split(/\s+/).filter(Boolean);
  const hl = new Set(String(p.highlight || '').toLowerCase().split(/[\s,]+/).filter(Boolean));
  const size = clamp(Math.sqrt((w * h * 0.32) / Math.max(1, p.text.length)) * 1.15, 22, 110);
  let from = ctx.t0;
  const at = words.map((wd, i) => { const tt = ctx.word(wd.replace(/[^\p{L}\p{N}']/gu, ''), from); if (tt !== null) { from = tt + 0.01; return r3(tt - 0.03); } return r3(ctx.t0 + 0.1 + i * 0.12); });
  const html = `<div class="q">“</div><div class="body">${words.map((wd, i) => `<span id="${ctx.id}-w${i}" class="${hl.has(wd.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')) ? 'hl' : ''}">${esc(wd)}</span>`).join(' ')}</div>${p.author ? `<div class="au">— ${esc(p.author)}</div>` : ''}`;
  const css = `#${ctx.id}{display:flex;flex-direction:column;justify-content:center;padding:0 ${w * 0.09}px;}
#${ctx.id} .q{font:900 ${size * 2.4}px/0.6 "${t.display}";color:${t.accent};height:${size * 1.1}px;}
#${ctx.id} .body{font:${t.displayWeight} ${size}px/1.16 "${t.display}";color:${t.text};}
#${ctx.id} .body span{opacity:.14;}
#${ctx.id} .body span.hl{color:${t.key};}
#${ctx.id} .au{margin-top:${size * 0.5}px;font:700 ${size * 0.4}px/1 "${t.body}";color:${t.text};opacity:0;letter-spacing:.08em;text-transform:uppercase;}`;
  let js = `tl.fromTo('#${ctx.id} .q',{opacity:0,scale:.4},{opacity:1,scale:1,duration:.35,ease:'back.out(2)'},${r3(ctx.t0 + 0.02)});`;
  words.forEach((_, i) => { js += `tl.to('#${ctx.id}-w${i}',{opacity:1,duration:.12,ease:'none'},${at[i]});`; });
  if (p.author) js += `tl.to('#${ctx.id} .au',{opacity:.8,duration:.3},${r3(at[at.length - 1] + 0.2)});`;
  return { html, css, js, events: [{ at: ctx.t0 + 0.05, kind: 'enter' }] };
}
