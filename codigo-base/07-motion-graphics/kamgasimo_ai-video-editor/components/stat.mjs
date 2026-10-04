import { esc, r3, clamp, fitSize } from './_kit.mjs';

export const meta = {
  name: 'stat',
  summary: 'A number that counts up and lands on its word — "10x faster", "$3,000 a month", "87%". Optional ring that fills to a percentage, and a label under it.',
  props: { value: 'the number (e.g. 87, 3000, 2.5)', prefix: 'e.g. "$"', suffix: 'e.g. "%", "K", "x"', label: 'what it counts', word: 'the spoken word it lands on', ring: 'true for a percentage ring', decimals: 'digits after the point' },
};

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens;
  const value = Number(p.value) || 0, dec = Number(p.decimals ?? (Number.isInteger(value) ? 0 : 1));
  const text = `${p.prefix || ''}${value.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${p.suffix || ''}`;
  const size = fitSize(text.length, w * 0.8, h * 0.42, 0.66);
  const landing = p.word ? ctx.word(p.word) : null;
  const end = r3(landing !== null ? landing - 0.04 : ctx.t0 + 0.9), start = r3(Math.max(ctx.t0 + 0.05, end - 0.8));
  const ring = p.ring ? Math.min(w, h) * 0.62 : 0;
  const html = `${ring ? `<svg class="ring" viewBox="0 0 100 100" width="${ring}" height="${ring}"><circle cx="50" cy="50" r="44" fill="none" stroke="${t.dark ? 'rgba(255,255,255,.12)' : 'rgba(17,24,39,.08)'}" stroke-width="7"/><circle id="${ctx.id}-arc" cx="50" cy="50" r="44" fill="none" stroke="${t.accent}" stroke-width="7" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="276.5" transform="rotate(-90 50 50)"/></svg>` : ''}<div class="num" id="${ctx.id}-n">${esc(p.prefix || '')}<span>0</span>${esc(p.suffix || '')}</div>${p.label ? `<div class="lab">${esc(p.label)}</div>` : ''}`;
  const css = `#${ctx.id}{display:flex;flex-direction:column;align-items:center;justify-content:center;}
#${ctx.id} .ring{position:absolute;left:50%;top:50%;transform:translate(-50%,-${p.label ? 58 : 50}%);}
#${ctx.id} .num{position:relative;font:${t.displayWeight} ${ring ? size * 0.7 : size}px/1 "${t.display}";color:${t.key};letter-spacing:-.02em;${t.dark ? `text-shadow:0 0 50px color-mix(in srgb,${t.key} 45%,transparent);` : ''}}
#${ctx.id} .lab{position:relative;margin-top:${h * 0.04}px;font:800 ${clamp(h * 0.07, 18, 56)}px/1.1 "${t.body}";color:${t.text};text-transform:uppercase;letter-spacing:.08em;text-align:center;max-width:${w * 0.86}px;opacity:0;}`;
  let js = `tl.fromTo('#${ctx.id}-n',{opacity:0,scale:.6},{opacity:1,scale:1,duration:.3,ease:'back.out(2)'},${start});`;
  js += `(function(){const o={v:0};const el=document.querySelector('#${ctx.id}-n span');tl.to(o,{v:${value},duration:${r3(end - start)},ease:'power2.out',onUpdate:()=>{el.textContent=o.v.toLocaleString('en-US',{minimumFractionDigits:${dec},maximumFractionDigits:${dec}});}},${start});tl.call(()=>{el.textContent=(${value}).toLocaleString('en-US',{minimumFractionDigits:${dec},maximumFractionDigits:${dec}});},null,${end});})();`;
  js += `tl.fromTo('#${ctx.id}-n',{scale:1},{scale:1.12,duration:.12,yoyo:true,repeat:1,ease:'power2.out'},${end});`;
  if (ring) js += `tl.to('#${ctx.id}-arc',{attr:{'stroke-dashoffset':${r3(276.5 * (1 - Math.min(1, value / 100)))}},duration:${r3(end - start)},ease:'power2.out'},${start});`;
  if (p.label) js += `tl.fromTo('#${ctx.id} .lab',{opacity:0,y:20},{opacity:1,y:0,duration:.35,ease:'power3.out'},${r3(end + 0.05)});`;
  return { html, css, js, events: [{ at: start, kind: 'enter' }, { at: end, kind: 'count' }] };
}
