import { esc, r3, clamp, landings } from './_kit.mjs';

export const meta = {
  name: 'ui',
  summary: 'An interface mock-up that acts out what is said. screen "chat": messages appearing one by one (an AI answering, a DM arriving). "code": an editor typing lines. "browser": a page with a URL typing in and the page arriving. "phone": notifications stacking up (sales, likes, messages).',
  props: { screen: 'chat | code | browser | phone', items: 'chat: [{ from: "me" | "them", text, word? }]; code: [{ text, word? }] (lines); phone: [{ title, text, icon?, word? }]', url: 'browser: the address', headline: 'browser: the page headline', word: 'when it starts' },
};

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens, screen = p.screen || 'chat';
  const items = (p.items || []).slice(0, 6), at = landings(items.length ? items : [{}], ctx);
  const dark = t.dark, card = dark ? '#16162E' : '#FFFFFF', edge = dark ? 'rgba(255,255,255,.12)' : 'rgba(17,24,39,.1)';
  const fw = Math.min(w * 0.86, h * (screen === 'phone' ? 0.55 : 1.4)), fh = Math.min(h * 0.86, fw * (screen === 'phone' ? 1.9 : 0.72));
  const fx = (w - fw) / 2, fy = (h - fh) / 2, fs = clamp(fw * (screen === 'phone' ? 0.055 : 0.04), 13, 44);
  let inner = '', css = `#${ctx.id} .dev{position:absolute;left:${fx}px;top:${fy}px;width:${fw}px;height:${fh}px;border-radius:${fw * 0.045}px;background:${card};border:2px solid ${edge};box-shadow:0 30px 80px rgba(0,0,0,${dark ? 0.55 : 0.18});overflow:hidden;opacity:0;}
#${ctx.id} .bar{height:${fh * 0.1}px;display:flex;align-items:center;gap:${fw * 0.015}px;padding:0 ${fw * 0.035}px;border-bottom:2px solid ${edge};}
#${ctx.id} .bar i{width:${fw * 0.022}px;height:${fw * 0.022}px;border-radius:50%;display:block;}`;
  let js = `tl.fromTo('#${ctx.id} .dev',{opacity:0,y:40,scale:.94},{opacity:1,y:0,scale:1,duration:.4,ease:'power3.out'},${r3(ctx.t0 + 0.02)});`;
  const events = [{ at: ctx.t0 + 0.05, kind: 'enter' }];
  const dots = '<i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i>';
  if (screen === 'chat') {
    inner = `<div class="bar">${dots}</div><div class="msgs">${items.map((m, i) => `<div class="m ${m.from === 'me' ? 'me' : 'them'}" id="${ctx.id}-m${i}">${esc(m.text)}</div>`).join('')}</div>`;
    css += `#${ctx.id} .msgs{display:flex;flex-direction:column;gap:${fh * 0.03}px;padding:${fh * 0.05}px ${fw * 0.05}px;}
#${ctx.id} .m{max-width:78%;padding:${fs * 0.55}px ${fs * 0.8}px;border-radius:${fs}px;font:600 ${fs}px/1.3 "${t.body}";opacity:0;}
#${ctx.id} .m.me{align-self:flex-end;background:${t.accent};color:#fff;border-bottom-right-radius:${fs * 0.25}px;}
#${ctx.id} .m.them{align-self:flex-start;background:${dark ? 'rgba(255,255,255,.1)' : '#EEF0F4'};color:${t.text};border-bottom-left-radius:${fs * 0.25}px;}`;
    items.forEach((_, i) => { js += `tl.fromTo('#${ctx.id}-m${i}',{opacity:0,y:20,scale:.9},{opacity:1,y:0,scale:1,duration:.3,ease:'back.out(2)'},${at[i]});`; events.push({ at: at[i], kind: 'enter' }); });
  } else if (screen === 'code') {
    inner = `<div class="bar">${dots}</div><div class="code">${items.map((l, i) => `<div class="cl" id="${ctx.id}-c${i}" data-full="${esc(l.text)}"></div>`).join('')}</div>`;
    css += `#${ctx.id} .code{padding:${fh * 0.06}px ${fw * 0.05}px;font:600 ${fs}px/1.6 "${t.mono}";color:${dark ? '#E5E7EB' : '#1F2937'};white-space:pre;}
#${ctx.id} .cl:nth-child(3n+1){color:${t.c1};}#${ctx.id} .cl:nth-child(3n+2){color:${t.c3};}#${ctx.id} .cl:nth-child(3n){color:${t.key};}`;
    items.forEach((l, i) => {
      const n = l.text.length, dur = r3(Math.min(1.4, n * 0.035));
      js += `(function(){const el=document.querySelector('#${ctx.id}-c${i}');const full=el.dataset.full;const o={n:0};tl.to(o,{n:${n},duration:${dur},ease:'none',onUpdate:()=>{el.textContent=full.slice(0,Math.round(o.n))+(o.n<${n}?'▍':'');}},${at[i]});})();`;
      events.push({ at: at[i], kind: 'type' });
    });
  } else if (screen === 'browser') {
    const url = String(p.url || 'yourbrand.com'), start = r3(p.word ? (ctx.word(p.word) ?? ctx.t0 + 0.3) - 0.1 : ctx.t0 + 0.3);
    inner = `<div class="bar">${dots}<div class="url" id="${ctx.id}-u"></div></div><div class="page" id="${ctx.id}-pg"><div class="hero">${esc(p.headline || '')}</div><div class="sk"></div><div class="sk s2"></div><div class="btn">${esc(p.cta || 'Get started')}</div></div>`;
    css += `#${ctx.id} .url{flex:1;margin-left:${fw * 0.03}px;height:${fh * 0.055}px;border-radius:${fh * 0.03}px;background:${dark ? 'rgba(255,255,255,.08)' : '#EEF0F4'};font:600 ${fs * 0.8}px/${fh * 0.055}px "${t.body}";color:${t.text};padding-left:${fw * 0.02}px;}
#${ctx.id} .page{padding:${fh * 0.08}px ${fw * 0.07}px;opacity:0;}
#${ctx.id} .hero{font:${t.displayWeight} ${fs * 1.9}px/1.05 "${t.display}";color:${t.text};margin-bottom:${fh * 0.05}px;}
#${ctx.id} .sk{height:${fh * 0.04}px;width:86%;border-radius:8px;background:${dark ? 'rgba(255,255,255,.1)' : '#E5E7EB'};margin-bottom:${fh * 0.025}px;}#${ctx.id} .sk.s2{width:62%;}
#${ctx.id} .btn{display:inline-block;margin-top:${fh * 0.04}px;padding:${fs * 0.55}px ${fs * 1.2}px;border-radius:${fs}px;background:${t.accent};color:#fff;font:800 ${fs}px/1 "${t.body}";}`;
    js += `(function(){const el=document.querySelector('#${ctx.id}-u');const full=${JSON.stringify(url)};const o={n:0};tl.to(o,{n:full.length,duration:${r3(Math.min(1, url.length * 0.04))},ease:'none',onUpdate:()=>{el.textContent=full.slice(0,Math.round(o.n));}},${start});})();`;
    js += `tl.fromTo('#${ctx.id}-pg',{opacity:0,y:30},{opacity:1,y:0,duration:.4,ease:'power3.out'},${r3(start + Math.min(1, url.length * 0.04) + 0.1)});`;
    events.push({ at: start, kind: 'type' }, { at: start + Math.min(1, url.length * 0.04) + 0.1, kind: 'enter' });
  } else {
    inner = `<div class="notch"></div><div class="notes">${items.map((m, i) => `<div class="nt" id="${ctx.id}-n${i}"><div class="ic">${ctx.icon(m.icon || 'bell', { size: fs * 1.4 })}</div><div><b>${esc(m.title || '')}</b><span>${esc(m.text || '')}</span></div></div>`).join('')}</div>`;
    css += `#${ctx.id} .notch{width:34%;height:${fh * 0.035}px;margin:${fh * 0.015}px auto;border-radius:${fh * 0.02}px;background:#000;}
#${ctx.id} .notes{display:flex;flex-direction:column-reverse;gap:${fh * 0.02}px;padding:${fh * 0.03}px ${fw * 0.05}px;}
#${ctx.id} .nt{display:flex;gap:${fw * 0.04}px;align-items:center;padding:${fs * 0.6}px;border-radius:${fs * 0.9}px;background:${dark ? 'rgba(255,255,255,.1)' : '#F3F4F6'};opacity:0;}
#${ctx.id} .ic{flex:none;width:${fs * 2.2}px;height:${fs * 2.2}px;border-radius:${fs * 0.6}px;background:${t.accent};color:#fff;display:flex;align-items:center;justify-content:center;}
#${ctx.id} .nt b{display:block;font:800 ${fs}px/1.2 "${t.body}";color:${t.text};}#${ctx.id} .nt span{font:500 ${fs * 0.85}px/1.25 "${t.body}";color:${t.text};opacity:.75;}`;
    items.forEach((_, i) => { js += `tl.fromTo('#${ctx.id}-n${i}',{opacity:0,y:-30,scale:.92},{opacity:1,y:0,scale:1,duration:.34,ease:'back.out(2)'},${at[i]});`; events.push({ at: at[i], kind: 'enter' }); });
  }
  return { html: `<div class="dev">${inner}</div>`, css, js, events };
}
