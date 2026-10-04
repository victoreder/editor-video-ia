import { esc, r3, clamp, landings } from './_kit.mjs';

export const meta = {
  name: 'steps',
  summary: 'A process: numbered steps joined by a line that draws from one to the next as each step is spoken. Horizontal on a wide box, vertical on a tall one.',
  props: { items: '[{ text, word, icon? }]', title: 'optional heading' },
};

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens, items = (p.items || []).slice(0, 5), n = items.length;
  const tall = h > w * 0.9, titleH = p.title ? h * 0.14 : 0;
  const at = landings(items, ctx);
  const node = clamp(Math.min(w, h) * (tall ? 0.12 : 0.13), 40, 150);
  const pos = items.map((_, i) => tall
    ? { x: w * 0.18, y: titleH + (h - titleH) * ((i + 0.5) / n) }
    : { x: w * ((i + 0.5) / n), y: titleH + (h - titleH) * 0.42 });
  const colors = [t.c1, t.c2, t.key, t.c3, t.c4];
  const fs = clamp(node * (tall ? 0.36 : 0.3), 14, 48);
  const line = pos.slice(1).map((q, i) => `<line id="${ctx.id}-ln${i}" x1="${pos[i].x}" y1="${pos[i].y}" x2="${q.x}" y2="${q.y}" stroke="${t.dark ? 'rgba(255,255,255,.5)' : 'rgba(17,24,39,.35)'}" stroke-width="${node * 0.06}" stroke-linecap="round" stroke-dasharray="${Math.hypot(q.x - pos[i].x, q.y - pos[i].y)}" stroke-dashoffset="${Math.hypot(q.x - pos[i].x, q.y - pos[i].y)}"/>`).join('');
  const html = `${p.title ? `<div class="ttl">${esc(p.title)}</div>` : ''}<svg class="lines" width="${w}" height="${h}">${line}</svg>${items.map((it, i) => `<div class="nd" id="${ctx.id}-n${i}" style="left:${pos[i].x - node / 2}px;top:${pos[i].y - node / 2}px;--c:${colors[i % colors.length]}">${it.icon ? ctx.icon(it.icon, { size: node * 0.5, stroke: 2.6 }) : i + 1}</div><div class="tx" id="${ctx.id}-x${i}" style="${tall ? `left:${pos[i].x + node * 0.8}px;top:${pos[i].y}px;transform:translateY(-50%);width:${w - pos[i].x - node * 1.1}px;text-align:left` : `left:${pos[i].x - w / n / 2}px;top:${pos[i].y + node * 0.75}px;width:${w / n}px;text-align:center`}">${esc(it.text)}</div>`).join('')}`;
  const css = `#${ctx.id} .ttl{position:absolute;left:0;right:0;top:${h * 0.04}px;text-align:center;font:${t.displayWeight} ${clamp(h * 0.08, 24, 84)}px/1.05 "${t.display}";color:${t.text};}
#${ctx.id} .lines{position:absolute;left:0;top:0;}
#${ctx.id} .nd{position:absolute;width:${node}px;height:${node}px;border-radius:50%;background:var(--c);color:${t.dark ? '#0A0A18' : '#fff'};display:flex;align-items:center;justify-content:center;font:900 ${node * 0.42}px/1 "${t.display}";box-shadow:0 0 0 ${node * 0.08}px ${t.dark ? 'rgba(255,255,255,.08)' : 'rgba(17,24,39,.06)'};opacity:0;}
#${ctx.id} .tx{position:absolute;font:800 ${fs}px/1.15 "${t.body}";color:${t.text};padding:0 ${w * 0.01}px;opacity:0;}`;
  let js = p.title ? `tl.fromTo('#${ctx.id} .ttl',{opacity:0,y:-20},{opacity:1,y:0,duration:.35,ease:'power3.out'},${r3(ctx.t0 + 0.08)});` : '';
  items.forEach((_, i) => {
    if (i > 0) js += `tl.to('#${ctx.id}-ln${i - 1}',{attr:{'stroke-dashoffset':0},duration:${r3(Math.max(0.15, Math.min(0.5, at[i] - at[i - 1] - 0.1)))},ease:'power2.inOut'},${r3(Math.max(at[i - 1] + 0.1, at[i] - 0.45))});`;
    js += `tl.fromTo('#${ctx.id}-n${i}',{opacity:0,scale:0},{opacity:1,scale:1,duration:.36,ease:'back.out(2.6)'},${at[i]});`;
    js += `tl.fromTo('#${ctx.id}-x${i}',{opacity:0,${tall ? 'x' : 'y'}:20},{opacity:1,${tall ? 'x' : 'y'}:0,duration:.35,ease:'power3.out'},${r3(at[i] + 0.08)});`;
  });
  return { html, css, js, events: at.map((a) => ({ at: a + 0.05, kind: 'enter' })) };
}
