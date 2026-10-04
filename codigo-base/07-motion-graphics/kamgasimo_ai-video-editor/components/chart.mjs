import { esc, r3, clamp, landings } from './_kit.mjs';

export const meta = {
  name: 'chart',
  summary: 'Data that grows as it is spoken: bars that rise (kind "bar") or a line that draws itself upward (kind "line", with an end dot and a label). The highlighted bar or the end point carries the value that matters.',
  props: { kind: 'bar | line', items: '[{ label, value, word? }] for bars; values: [numbers] for a line', highlight: 'index of the bar to light', unit: 'suffix for values, e.g. "%"', endLabel: 'text at the end of a line, e.g. "10x"', word: 'for a line: the word it finishes on' },
};

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens;
  const padX = w * 0.08, padT = h * 0.1, padB = h * 0.16, cw = w - padX * 2, chh = h - padT - padB;
  if ((p.kind || 'bar') === 'line') {
    const vals = (p.values || [1, 2, 1.5, 3, 2.8, 5, 8]).map(Number), max = Math.max(...vals), min = Math.min(0, ...vals);
    const pts = vals.map((v, i) => [padX + cw * (i / (vals.length - 1)), padT + chh * (1 - (v - min) / (max - min || 1))]);
    const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const end = p.word ? ctx.word(p.word) : null, t1 = r3(end !== null ? end : ctx.t0 + 1.4), t0 = r3(Math.max(ctx.t0 + 0.1, t1 - 1.1));
    const last = pts[pts.length - 1], dot = Math.min(w, h) * 0.035;
    const html = `<svg width="${w}" height="${h}"><defs><linearGradient id="${ctx.id}-g" x1="0" x2="1"><stop offset="0" stop-color="${t.c1}"/><stop offset="1" stop-color="${t.c3}"/></linearGradient></defs>${[0.25, 0.5, 0.75, 1].map((f) => `<line x1="${padX}" x2="${padX + cw}" y1="${padT + chh * (1 - f)}" y2="${padT + chh * (1 - f)}" stroke="${t.dark ? 'rgba(255,255,255,.08)' : 'rgba(17,24,39,.08)'}" stroke-width="2"/>`).join('')}<path id="${ctx.id}-p" d="${d}" fill="none" stroke="url(#${ctx.id}-g)" stroke-width="${Math.min(w, h) * 0.022}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${len.toFixed(0)}" stroke-dashoffset="${len.toFixed(0)}" style="filter:drop-shadow(0 0 ${dot}px ${t.c1})"/><circle id="${ctx.id}-d" cx="${last[0]}" cy="${last[1]}" r="${dot}" fill="${t.key}" opacity="0"/></svg>${p.endLabel ? `<div class="el" id="${ctx.id}-el" style="left:${last[0] - w * 0.3}px;top:${last[1] - dot * 5.5}px;width:${w * 0.28}px">${esc(p.endLabel)}</div>` : ''}`;
    const css = `#${ctx.id} svg{position:absolute;left:0;top:0;}#${ctx.id} .el{position:absolute;text-align:right;font:${t.displayWeight} ${clamp(h * 0.14, 24, 140)}px/1 "${t.display}";color:${t.key};opacity:0;}`;
    let js = `tl.to('#${ctx.id}-p',{attr:{'stroke-dashoffset':0},duration:${r3(t1 - t0)},ease:'power2.inOut'},${t0});`;
    js += `tl.fromTo('#${ctx.id}-d',{attr:{r:0},opacity:0},{attr:{r:${dot}},opacity:1,duration:.3,ease:'back.out(3)'},${t1});`;
    if (p.endLabel) js += `tl.fromTo('#${ctx.id}-el',{opacity:0,scale:1.8},{opacity:1,scale:1,duration:.22,ease:'power4.out'},${r3(t1 + 0.05)});`;
    return { html, css, js, events: [{ at: t0, kind: 'enter' }, { at: t1 + 0.05, kind: 'reveal' }] };
  }
  const items = (p.items || []).slice(0, 7), n = items.length, max = Math.max(...items.map((it) => Number(it.value) || 0), 1);
  const at = landings(items, ctx);
  const bw = cw / n * 0.62, colors = [t.c1, t.c2, t.c3, t.c4, t.accent, t.key];
  const fsV = clamp(bw * 0.3, 14, 56), fsL = clamp(bw * 0.24, 12, 40);
  const html = items.map((it, i) => {
    const x = padX + cw * (i + 0.5) / n - bw / 2, bh = chh * (Number(it.value) || 0) / max, hi = p.highlight === i;
    return `<div class="bar" id="${ctx.id}-b${i}" style="left:${x}px;top:${padT + chh - bh}px;width:${bw}px;height:${bh}px;background:${hi ? t.key : colors[i % colors.length]}"></div><div class="val" id="${ctx.id}-v${i}" style="left:${x - bw * 0.3}px;top:${padT + chh - bh - fsV * 1.4}px;width:${bw * 1.6}px">${esc(it.value)}${esc(p.unit || '')}</div><div class="lab" style="left:${x - bw * 0.4}px;top:${padT + chh + fsL * 0.6}px;width:${bw * 1.8}px">${esc(it.label)}</div>`;
  }).join('');
  const css = `#${ctx.id} .bar{position:absolute;border-radius:${bw * 0.14}px ${bw * 0.14}px 4px 4px;transform-origin:50% 100%;transform:scaleY(0);}
#${ctx.id} .val{position:absolute;text-align:center;font:${t.displayWeight} ${fsV}px/1 "${t.display}";color:${t.text};opacity:0;}
#${ctx.id} .lab{position:absolute;text-align:center;font:700 ${fsL}px/1.1 "${t.body}";color:${t.text};opacity:.8;}`;
  let js = '';
  items.forEach((_, i) => { js += `tl.fromTo('#${ctx.id}-b${i}',{scaleY:0},{scaleY:1,duration:.5,ease:'power3.out'},${at[i]});tl.fromTo('#${ctx.id}-v${i}',{opacity:0,y:14},{opacity:1,y:0,duration:.3},${r3(at[i] + 0.35)});`; });
  return { html, css, js, events: at.map((a) => ({ at: a + 0.05, kind: 'enter' })) };
}
