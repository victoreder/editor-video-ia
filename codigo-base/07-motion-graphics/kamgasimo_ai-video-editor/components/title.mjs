import { esc, r3, clamp } from './_kit.mjs';

export const meta = {
  name: 'title',
  summary: 'A kinetic title: one to three short lines that land on their words — a claim, a promise, a section heading. Variants: slam (hits in with a shake), rise (glides up out of a blur), type (typed out). Over the speaker, each line sits on a dark pill so it reads on any background.',
  props: { lines: '[{ text, word? (lands on), color? ("key" | "accent" | hex) }]', kicker: 'optional small line above', variant: 'slam | rise | type', icon: 'optional Lucide icon beside the first line', backing: 'pill | none (default: pill over the speaker, none on a panel)' },
};

// Montserrat Black and Anton in capitals run about 0.78 and 0.5 of the size per character; others ~0.6.
const widthRatio = (font, upper) => (font === 'Anton' ? 0.5 : font === 'Montserrat' ? (upper ? 0.8 : 0.66) : upper ? 0.68 : 0.56);

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens, lines = (p.lines || []).slice(0, 3);
  const variant = p.variant || (ctx.motion === 'slam' ? 'slam' : ctx.motion === 'fade' ? 'rise' : ctx.motion);
  const backing = p.backing ?? (ctx.onPanel ? 'none' : 'pill');
  const upper = lines.every((l) => l.text === l.text.toUpperCase());
  const ratio = widthRatio(t.display, upper), padX = backing === 'pill' ? 0.64 : 0;
  // the largest size at which the longest line, its icon and its pill fit the box on one line
  const size = Math.floor(Math.min(...lines.map((l, i) => (w * 0.92) / (l.text.length * ratio + (i === 0 && p.icon ? 1.1 : 0) + padX)), h / (lines.length * 1.25 + (p.kicker ? 0.6 : 0)), w * 0.16));
  let from = ctx.t0;
  const at = lines.map((l, i) => { const wt = l.word ? ctx.word(l.word, from) : null; if (wt !== null) from = wt + 0.01; return r3(wt !== null ? wt - 0.08 : ctx.t0 + 0.1 + i * 0.28); });
  const color = (c) => (c === 'key' ? t.key : c === 'accent' ? t.accent : c || (backing === 'pill' ? '#FFFFFF' : t.text));
  const html = `<div class="wrap">${p.kicker ? `<div class="kick">${esc(p.kicker)}</div>` : ''}${lines.map((l, i) => `<div class="ln" id="${ctx.id}-l${i}" style="color:${color(l.color)}">${i === 0 && p.icon ? ctx.icon(p.icon, { size: size * 0.9, stroke: 2.4 }) : ''}<span>${esc(l.text)}</span></div>`).join('')}</div>`;
  const css = `#${ctx.id} .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(size * 0.14)}px;}
#${ctx.id} .kick{font:700 ${clamp(size * 0.34, 16, 44)}px/1 "${t.body}";letter-spacing:.24em;text-transform:uppercase;color:${t.accent};margin-bottom:${size * 0.1}px;}
#${ctx.id} .ln{display:flex;align-items:center;gap:${size * 0.2}px;white-space:nowrap;font:${t.displayWeight} ${size}px/1.02 "${t.display}";letter-spacing:-.01em;opacity:0;${backing === 'pill' ? `background:rgba(8,6,20,.84);padding:${size * 0.1}px ${size * 0.32}px;border-radius:${size * 0.2}px;box-shadow:0 ${size * 0.12}px ${size * 0.4}px rgba(0,0,0,.35);` : t.dark ? 'text-shadow:0 10px 40px rgba(0,0,0,.45);' : ''}}
#${ctx.id} .ln span{display:inline-block;}`;
  let js = '';
  if (p.kicker) js += `tl.fromTo('#${ctx.id} .kick',{opacity:0,letterSpacing:'.6em'},{opacity:1,letterSpacing:'.24em',duration:.5,ease:'power3.out'},${r3(ctx.t0 + 0.02)});`;
  lines.forEach((l, i) => {
    const s = `#${ctx.id}-l${i}`;
    if (variant === 'slam') js += `tl.fromTo('${s}',{opacity:0,scale:2.1},{opacity:1,scale:1,duration:.2,ease:'power4.out'},${at[i]});tl.fromTo('${s}',{x:-8},{x:8,duration:.035,repeat:3,yoyo:true,ease:'none'},${r3(at[i] + 0.2)});tl.set('${s}',{x:0},${r3(at[i] + 0.34)});`;
    else if (variant === 'type') {
      js += `tl.set('${s}',{opacity:1},${at[i]});`;
      js += `(function(){const el=document.querySelector('${s} span');const full=el.textContent;const o={n:0};el.textContent='';tl.to(o,{n:${l.text.length},duration:${r3(l.text.length * 0.035)},ease:'none',onUpdate:()=>{el.textContent=full.slice(0,Math.round(o.n));}},${at[i]});})();`;
    } else js += `tl.fromTo('${s}',{opacity:0,y:${Math.round(size * 0.45)},filter:'blur(12px)'},{opacity:1,y:0,filter:'blur(0px)',duration:.5,ease:'power3.out'},${at[i]});`;
  });
  return { html, css, js, events: at.map((a) => ({ at: a + (variant === 'slam' ? 0.05 : 0.08), kind: variant === 'slam' ? 'reveal' : variant === 'type' ? 'type' : 'enter' })) };
}
