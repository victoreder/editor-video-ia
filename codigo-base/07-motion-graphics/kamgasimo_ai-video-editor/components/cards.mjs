import { esc, enter, landings, clamp, r3 } from './_kit.mjs';

export const meta = {
  name: 'cards',
  summary: 'Two to six cards in a grid, each arriving on its word — "you can code, make videos, edit…". A card is an icon and a label, or, with a body, a small living scene: code typing, a video playing, likes counting up, a timeline being cut, a chart climbing, a chat, money adding up, a checklist ticking. Cards not yet spoken wait as dashed placeholders; the card being spoken about glows.',
  props: { title: 'optional heading, e.g. "YOU CAN…"', items: '[{ label, icon (Lucide name), word (spoken word it lands on), color? (c1–c4 or hex), body?: code | video | likes | timeline | chart | chat | money | check }]', ghosts: 'true to show dashed placeholders before cards arrive (default true when more than two)' },
};

function body(kind, id, cw, bh, t, at, until) {
  const u = Math.min(cw, bh) / 100, d = t.dark;
  const muted = d ? 'rgba(255,255,255,.28)' : 'rgba(17,24,39,.2)';
  const T = (x) => r3(x);
  switch (kind) {
    case 'code': {
      const lines = [['ai.build("my app")', t.c1], ['  .test()', t.c3], ['  .ship()  // done ✓', t.key]];
      const html = `<div class="code">${lines.map(([s, c], i) => `<div id="${id}-cl${i}" data-full="${esc(s)}" style="color:${c}"></div>`).join('')}</div>`;
      const css = `#${id} .code{padding:${u * 4}px ${u * 7}px;font:700 ${u * 11}px/1.55 "${t.mono}";white-space:pre;}`;
      let js = '', s0 = at + 0.1;
      lines.forEach(([s], i) => { const dur = s.length * 0.028; js += `(function(){const el=document.querySelector('#${id}-cl${i}');const full=el.dataset.full;const o={n:0};tl.to(o,{n:${s.length},duration:${T(dur)},ease:'none',onUpdate:()=>{el.textContent=full.slice(0,Math.round(o.n))+(o.n<${s.length}?'▍':'');}},${T(s0)});})();`; s0 += dur + 0.05; });
      return { html, css, js, events: [{ at: at + 0.1, kind: 'type' }] };
    }
    case 'video': {
      const cells = Array.from({ length: 8 }, (_, i) => `<i style="background:linear-gradient(135deg,${[t.c1, t.c2, t.c3, t.c4][i % 4]},${[t.c3, t.accent, t.c1, t.c2][i % 4]})"></i>`).join('');
      const html = `<div class="strip" id="${id}-st">${cells}</div><div class="play" id="${id}-pl"><svg viewBox="0 0 24 24" width="${u * 22}" height="${u * 22}"><polygon points="7 4 20 12 7 20" fill="${t.c2}"/></svg></div><div class="prog"><div id="${id}-pr"></div></div>`;
      const css = `#${id} .strip{position:absolute;left:0;top:${bh * 0.5}px;display:flex;gap:${u * 3}px;}#${id} .strip i{display:block;width:${u * 30}px;height:${u * 21}px;border-radius:${u * 2.5}px;border:${u * 1.4}px solid #000;opacity:.85;}
#${id} .play{position:absolute;left:${cw / 2 - u * 18}px;top:${bh * 0.08}px;width:${u * 36}px;height:${u * 36}px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;padding-left:${u * 3}px;box-shadow:0 0 ${u * 12}px ${t.c2};opacity:0;}
#${id} .prog{position:absolute;left:${u * 7}px;right:${u * 7}px;bottom:${u * 6}px;height:${u * 3.2}px;border-radius:${u * 2}px;background:${muted};}#${id} .prog div{height:100%;width:0;border-radius:inherit;background:${t.c2};}`;
      const js = `tl.fromTo('#${id}-pl',{opacity:0,scale:0},{opacity:1,scale:1,duration:.35,ease:'back.out(3)'},${T(at + 0.15)});tl.fromTo('#${id}-st',{x:0},{x:${-u * 66},duration:${T(until - at)},ease:'none'},${T(at)});tl.fromTo('#${id}-pr',{width:'0%'},{width:'100%',duration:${T(until - at)},ease:'none'},${T(at)});`;
      return { html, css, js, events: [{ at: at + 0.18, kind: 'enter' }] };
    }
    case 'likes': {
      const html = `<div class="av"></div><div class="sk"></div><div class="sk s2"></div><div class="img"></div><div class="lk" id="${id}-lk"><svg viewBox="0 0 24 24" width="${u * 17}" height="${u * 17}"><path id="${id}-hp" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" fill="none" stroke="${t.c2}" stroke-width="2.2"/></svg><b id="${id}-n">0</b></div>${[0, 1, 2].map((k) => `<svg class="fh" id="${id}-f${k}" viewBox="0 0 24 24" width="${u * 14}" height="${u * 14}" style="left:${cw * 0.55 + k * u * 12}px"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" fill="${t.c2}"/></svg>`).join('')}`;
      const css = `#${id} .av{position:absolute;left:${u * 7}px;top:${u * 3}px;width:${u * 16}px;height:${u * 16}px;border-radius:50%;background:linear-gradient(135deg,${t.key},${t.c2});}
#${id} .sk{position:absolute;left:${u * 27}px;top:${u * 5}px;width:${u * 50}px;height:${u * 4.5}px;border-radius:${u * 2}px;background:${muted};}#${id} .sk.s2{top:${u * 12.5}px;width:${u * 32}px;}
#${id} .img{position:absolute;left:${u * 7}px;right:${u * 7}px;top:${u * 23}px;height:${bh - u * 46}px;border-radius:${u * 4}px;background:linear-gradient(120deg,${t.accent},${t.c1});}
#${id} .lk{position:absolute;left:${u * 7}px;bottom:${u * 4}px;display:flex;align-items:center;gap:${u * 3}px;font:900 ${u * 13}px/1 "${t.display}";color:${t.text};}
#${id} .fh{position:absolute;bottom:${u * 8}px;opacity:0;}`;
      let js = `tl.to('#${id}-hp',{attr:{fill:'${t.c2}'},duration:.01},${T(at + 0.5)});tl.fromTo('#${id}-lk',{scale:.7},{scale:1,duration:.3,ease:'back.out(3)'},${T(at + 0.5)});`;
      js += `(function(){const el=document.querySelector('#${id}-n');const o={v:0};tl.to(o,{v:12400,duration:1.1,ease:'power2.out',onUpdate:()=>{el.textContent=o.v>=1000?(o.v/1000).toFixed(1)+'K':Math.floor(o.v);}},${T(at + 0.5)});})();`;
      [0, 1, 2].forEach((k) => { js += `tl.fromTo('#${id}-f${k}',{opacity:1,y:0},{opacity:0,y:${-bh * 0.5},duration:.9,ease:'power1.out'},${T(at + 0.6 + k * 0.22)});`; });
      return { html, css, js, events: [{ at: at + 0.5, kind: 'count' }] };
    }
    case 'timeline': {
      const tracks = [[[4, 36, t.accent], [42, 50, t.c1]], [[4, 22, t.c2], [30, 26, t.key], [60, 32, t.c3]], [[4, 88, '#64748B']]];
      const html = tracks.map((tr, r) => tr.map(([x, wd, c], k) => `<i class="clp" ${r === 0 && k === 1 ? `id="${id}-cut"` : ''} style="left:${u * x}px;top:${u * 6 + r * u * 19}px;width:${u * wd}px;background:${c}"></i>`).join('')).join('') + `<div class="ph" id="${id}-ph"></div><div class="sc" id="${id}-sc"><svg viewBox="0 0 24 24" width="${u * 20}" height="${u * 20}" fill="none" stroke="${t.key}" stroke-width="2.6" stroke-linecap="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg></div>`;
      const css = `#${id} .clp{position:absolute;display:block;height:${u * 14}px;border-radius:${u * 2}px;opacity:.92;border:${u * 0.8}px solid rgba(0,0,0,.25);}
#${id} .ph{position:absolute;left:${u * 8}px;top:${u * 2}px;width:${u * 1.6}px;height:${u * 60}px;background:#fff;box-shadow:0 0 ${u * 4}px #fff;}
#${id} .sc{position:absolute;left:${u * 55}px;top:${-u * 2}px;opacity:0;}`;
      const js = `tl.fromTo('#${id}-ph',{x:0},{x:${u * 76},duration:${T(Math.max(0.8, until - at))},ease:'none'},${T(at)});tl.fromTo('#${id}-sc',{opacity:0,scale:0,rotation:-30},{opacity:1,scale:1,rotation:0,duration:.3,ease:'back.out(2.5)'},${T(at + 0.45)});tl.to('#${id}-cut',{x:${u * 5},duration:.2,ease:'back.out(2)'},${T(at + 0.62)});`;
      return { html, css, js, events: [{ at: at + 0.62, kind: 'reveal' }] };
    }
    case 'chart': {
      const pts = [[8, 78], [24, 66], [38, 70], [52, 52], [66, 55], [80, 30], [92, 12]].map(([x, y]) => [u * x, bh * y / 100]);
      const dpath = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
      const html = `<svg width="${cw}" height="${bh}" style="position:absolute;left:0;top:0"><path id="${id}-ln" d="${dpath}" fill="none" stroke="${t.c3}" stroke-width="${u * 3}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" style="filter:drop-shadow(0 0 ${u * 3}px ${t.c3})"/></svg>`;
      const js = `tl.to('#${id}-ln',{attr:{'stroke-dashoffset':0},duration:.9,ease:'power2.inOut'},${T(at + 0.1)});`;
      return { html, css: '', js, events: [] };
    }
    case 'chat': {
      const html = `<div class="b them" id="${id}-b0">How do I start?</div><div class="b me" id="${id}-b1">Just ask ✨</div>`;
      const css = `#${id} .b{position:absolute;padding:${u * 3}px ${u * 6}px;border-radius:${u * 6}px;font:700 ${u * 9}px/1.2 "${t.body}";opacity:0;}#${id} .them{left:${u * 7}px;top:${u * 6}px;background:${muted};color:${t.text};}#${id} .me{right:${u * 7}px;top:${u * 32}px;background:${t.accent};color:#fff;}`;
      const js = `tl.fromTo('#${id}-b0',{opacity:0,y:10},{opacity:1,y:0,duration:.25,ease:'back.out(2)'},${T(at + 0.15)});tl.fromTo('#${id}-b1',{opacity:0,y:10},{opacity:1,y:0,duration:.25,ease:'back.out(2)'},${T(at + 0.6)});`;
      return { html, css, js, events: [{ at: at + 0.6, kind: 'enter' }] };
    }
    case 'money': {
      const html = `<div class="mn" id="${id}-mn">$0</div>`;
      const css = `#${id} .mn{position:absolute;left:0;right:0;top:${bh * 0.18}px;text-align:center;font:900 ${u * 26}px/1 "${t.display}";color:${t.c3};}`;
      const js = `(function(){const el=document.querySelector('#${id}-mn');const o={v:0};tl.to(o,{v:12480,duration:1.1,ease:'power2.out',onUpdate:()=>{el.textContent='$'+Math.round(o.v).toLocaleString('en-US');}},${T(at + 0.1)});})();`;
      return { html, css, js, events: [{ at: at + 1.1, kind: 'count' }] };
    }
    case 'check': {
      const html = [0, 1, 2].map((k) => `<div class="ck" style="top:${u * 4 + k * u * 17}px"><i id="${id}-k${k}"></i><s></s></div>`).join('');
      const css = `#${id} .ck{position:absolute;left:${u * 8}px;right:${u * 8}px;display:flex;align-items:center;gap:${u * 4}px;}#${id} .ck i{display:block;width:${u * 10}px;height:${u * 10}px;border-radius:${u * 2.5}px;border:${u * 1.4}px solid ${t.c3};}#${id} .ck s{display:block;flex:1;height:${u * 4}px;border-radius:${u * 2}px;background:${muted};}`;
      let js = '';
      [0, 1, 2].forEach((k) => { js += `tl.to('#${id}-k${k}',{backgroundColor:'${t.c3}',duration:.12},${T(at + 0.2 + k * 0.3)});`; });
      return { html, css, js, events: [{ at: at + 0.2, kind: 'enter' }] };
    }
    default: return null;
  }
}

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens, items = (p.items || []).slice(0, 6), n = items.length;
  const cols = n <= 2 ? n : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols);
  const titleH = p.title ? h * 0.15 : 0, pad = w * 0.055, gap = w * 0.035;
  const cw = (w - pad * 2 - gap * (cols - 1)) / cols, ch = Math.min((h - titleH - pad * 1.4 - gap * (rows - 1)) / rows, cw * 0.8);
  const top = titleH + (h - titleH - (ch * rows + gap * (rows - 1))) / 2;
  const colors = [t.c1, t.c2, t.key, t.c3, t.c4, t.accent];
  const col = (it, i) => (it.color && t[it.color]) || it.color || colors[i % colors.length];
  const at = landings(items, ctx);
  const ghosts = p.ghosts ?? n > 2;
  const withBody = items.some((it) => it.body);
  const fs = clamp(Math.min(cw, ch) * (withBody ? 0.1 : 0.16), 16, 64), is = Math.min(cw, ch) * (withBody ? 0.12 : 0.36);
  let html = p.title ? `<div class="ttl">${esc(p.title)}</div>` : '', css = '', js = '';
  const events = [];
  items.forEach((it, i) => {
    const x = pad + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (ch + gap);
    const bid = `${ctx.id}-k${i}`;
    if (ghosts) html += `<div class="ghost" id="${bid}-gh" style="left:${x}px;top:${y}px;width:${cw}px;height:${ch}px">?</div>`;
    const until = at[i + 1] ?? ctx.t1;
    const b = it.body ? body(it.body, `${bid}-body`, cw, ch * 0.72, t, at[i], until) : null;
    if (b) {
      html += `<div class="card rich" id="${bid}" style="left:${x}px;top:${y}px;width:${cw}px;height:${ch}px;--c:${col(it, i)}"><div class="chip">${ctx.icon(it.icon || 'sparkles', { size: is, stroke: 2.8 })}<span>${esc(it.label)}</span></div><div class="bd" id="${bid}-body">${b.html}</div></div>`;
      css += b.css + '\n'; js += b.js; events.push(...b.events);
    } else html += `<div class="card" id="${bid}" style="left:${x}px;top:${y}px;width:${cw}px;height:${ch}px;--c:${col(it, i)}">${ctx.icon(it.icon || 'sparkles', { size: is })}<div class="lbl">${esc(it.label)}</div></div>`;
  });
  css += `#${ctx.id} .ttl{position:absolute;left:0;right:0;top:${h * 0.045}px;text-align:center;white-space:nowrap;font:${t.displayWeight} ${clamp(Math.min(h * 0.085, (w * 0.9) / Math.max(4, String(p.title || '').length * 0.8)), 26, 96)}px/1.05 "${t.display}";color:${t.text};letter-spacing:.02em;}
#${ctx.id} .ghost{position:absolute;border-radius:${Math.min(cw, ch) * 0.1}px;border:${Math.max(2, cw * 0.008)}px dashed ${t.dark ? 'rgba(255,255,255,.2)' : 'rgba(17,24,39,.18)'};display:flex;align-items:center;justify-content:center;font:900 ${ch * 0.3}px/1 "${t.display}";color:${t.dark ? 'rgba(255,255,255,.14)' : 'rgba(17,24,39,.12)'};opacity:0;}
#${ctx.id} .card{position:absolute;border-radius:${Math.min(cw, ch) * 0.1}px;background:${t.dark ? 'linear-gradient(160deg,#1f1c40,#0f0f22)' : '#FFFFFF'};border:${Math.max(3, cw * 0.011)}px solid var(--c);box-shadow:${t.dark ? '0 0 46px color-mix(in srgb,var(--c) 38%,transparent)' : '0 14px 40px rgba(17,24,39,.12)'};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${ch * 0.06}px;opacity:0;overflow:hidden;}
#${ctx.id} .card svg{color:var(--c);}
#${ctx.id} .card.rich{display:block;}
#${ctx.id} .chip{position:absolute;left:${cw * 0.05}px;top:${ch * 0.07}px;display:flex;align-items:center;gap:${cw * 0.02}px;padding:${ch * 0.025}px ${cw * 0.035}px;border-radius:${ch * 0.06}px;background:var(--c);}
#${ctx.id} .chip svg{color:#0A0A18;}#${ctx.id} .chip span{font:900 ${fs}px/1 "${t.display}";color:#0A0A18;letter-spacing:.04em;text-transform:uppercase;}
#${ctx.id} .bd{position:absolute;left:0;right:0;top:${ch * 0.26}px;height:${ch * 0.72}px;}
#${ctx.id} .lbl{font:800 ${fs}px/1 "${t.body}";letter-spacing:.06em;color:${t.text};text-transform:uppercase;text-align:center;padding:0 ${cw * 0.05}px;}`;
  if (p.title) js += enter(`#${ctx.id} .ttl`, ctx.t0 + 0.12, 'rise', { from: -30 });
  if (ghosts) items.forEach((_, i) => { js += `tl.fromTo('#${ctx.id}-k${i}-gh',{opacity:0},{opacity:1,duration:.3},${r3(ctx.t0 + 0.2 + i * 0.06)});tl.to('#${ctx.id}-k${i}-gh',{opacity:0,duration:.1},${at[i]});`; });
  items.forEach((_, i) => {
    js += enter(`#${ctx.id}-k${i}`, at[i], ctx.motion === 'slam' ? 'pop' : ctx.motion);
    if (i > 0) js += `tl.to('#${ctx.id}-k${i - 1}',{scale:0.96,duration:0.2},${at[i]});`;
    js += `tl.fromTo('#${ctx.id}-k${i}',{boxShadow:'0 0 0px rgba(0,0,0,0)'},{boxShadow:'0 0 60px ${col(items[i], i)}',duration:.3,yoyo:true,repeat:1},${r3(at[i] + 0.1)});`;
  });
  return { html, css, js, events: at.map((a) => ({ at: a + 0.08, kind: 'enter' })).concat(events).concat(p.title ? [{ at: ctx.t0 + 0.12, kind: 'enter' }] : []) };
}
