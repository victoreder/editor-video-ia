import { esc, enter, landings, clamp } from './_kit.mjs';

export const meta = {
  name: 'list',
  summary: 'A list that builds item by item on its words — steps, reasons, tips. Numbered, checked or with icons. The current item is lit; the rest settle.',
  props: { title: 'optional heading', items: '[{ text, word, icon? }]', marker: 'number | check | icon' },
};

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens, items = (p.items || []).slice(0, 6), n = items.length;
  const titleH = p.title ? h * 0.15 : 0, rowH = Math.min((h * 0.86 - titleH) / Math.max(n, 3), h * 0.2), pad = w * 0.08;
  const top = titleH + (h - titleH - rowH * n) / 2, fs = clamp(rowH * 0.36, 18, 60), mark = rowH * 0.62;
  const at = landings(items, ctx);
  const colors = [t.c1, t.c2, t.key, t.c3, t.c4, t.accent];
  const marker = p.marker || 'number';
  const html = `${p.title ? `<div class="ttl">${esc(p.title)}</div>` : ''}${items.map((it, i) => `<div class="row" id="${ctx.id}-r${i}" style="top:${top + i * rowH}px;--c:${colors[i % colors.length]}"><div class="mk">${marker === 'check' ? ctx.icon('check', { size: mark * 0.6, stroke: 3.2 }) : marker === 'icon' ? ctx.icon(it.icon || 'circle', { size: mark * 0.58 }) : i + 1}</div><div class="tx">${esc(it.text)}</div></div>`).join('')}`;
  const css = `#${ctx.id} .ttl{position:absolute;left:${pad}px;right:${pad}px;top:${h * 0.05}px;font:${t.displayWeight} ${clamp(h * 0.08, 26, 88)}px/1.05 "${t.display}";color:${t.text};}
#${ctx.id} .row{position:absolute;left:${pad}px;right:${pad}px;height:${rowH * 0.84}px;display:flex;align-items:center;gap:${w * 0.035}px;opacity:0;}
#${ctx.id} .mk{flex:none;width:${mark}px;height:${mark}px;border-radius:${mark * 0.3}px;background:var(--c);color:${t.dark ? '#0A0A18' : '#fff'};display:flex;align-items:center;justify-content:center;font:900 ${mark * 0.48}px/1 "${t.display}";box-shadow:${t.dark ? '0 0 30px color-mix(in srgb,var(--c) 45%,transparent)' : '0 8px 20px rgba(17,24,39,.15)'};}
#${ctx.id} .tx{font:800 ${fs}px/1.12 "${t.body}";color:${t.text};}`;
  let js = p.title ? enter(`#${ctx.id} .ttl`, ctx.t0 + 0.1, 'rise', { from: -20 }) : '';
  items.forEach((_, i) => {
    js += `tl.fromTo('#${ctx.id}-r${i}',{opacity:0,x:-60},{opacity:1,x:0,duration:.38,ease:'power3.out'},${at[i]});`;
    js += `tl.fromTo('#${ctx.id}-r${i} .mk',{scale:0},{scale:1,duration:.36,ease:'back.out(2.6)'},${at[i] + 0.04});`;
    if (i > 0) js += `tl.to('#${ctx.id}-r${i - 1}',{opacity:.55,duration:.25},${at[i]});`;
  });
  return { html, css, js, events: at.map((a) => ({ at: a + 0.06, kind: 'enter' })) };
}
