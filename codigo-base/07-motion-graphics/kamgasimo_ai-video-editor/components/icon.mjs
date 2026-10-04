import { esc, r3, clamp } from './_kit.mjs';

export const meta = {
  name: 'icon',
  summary: 'One hero icon in a glowing tile with pulsing rings and a label — the single idea of a sentence: "AI", "money", "time", "growth". The tile arrives when the graphic opens (or on tileWord); the label slams in on its word.',
  props: { icon: 'Lucide name', badge: 'optional short text instead of the icon (e.g. "AI")', label: 'optional word under it', word: 'the spoken word the label lands on', tileWord: 'optional word the tile lands on' },
};

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens;
  const tile = Math.min(w, h) * (p.label ? 0.4 : 0.5);
  const tw = p.tileWord ? ctx.word(p.tileWord) : null, lw = p.word ? ctx.word(p.word) : null;
  const at = r3(tw !== null ? tw - 0.1 : ctx.t0 + 0.12);
  const lat = r3(lw !== null ? Math.max(at + 0.3, lw - 0.08) : at + 0.4);
  const cy = p.label ? h * 0.42 : h * 0.5;
  const rings = [0, 1, 2].map((i) => `<div class="ring" id="${ctx.id}-g${i}"></div>`).join('');
  const html = `${rings}<div class="tile" id="${ctx.id}-t"><div class="core">${p.badge ? `<span>${esc(p.badge)}</span>` : ctx.icon(p.icon || 'sparkles', { size: tile * 0.46, stroke: 2.2 })}</div></div>${p.label ? `<div class="lab" id="${ctx.id}-lb">${esc(p.label)}</div>` : ''}`;
  const css = `#${ctx.id} .tile{position:absolute;left:${w / 2 - tile / 2}px;top:${cy - tile / 2}px;width:${tile}px;height:${tile}px;border-radius:${tile * 0.22}px;padding:${tile * 0.028}px;background:linear-gradient(135deg,${t.accent},${t.c1});box-shadow:0 0 ${tile * 0.35}px color-mix(in srgb,${t.accent} 70%,transparent);opacity:0;}
#${ctx.id} .core{width:100%;height:100%;border-radius:${tile * 0.19}px;background:${t.dark ? '#12122A' : '#FFFFFF'};display:flex;align-items:center;justify-content:center;color:${t.dark ? '#fff' : t.accent};}
#${ctx.id} .core span{font:${t.displayWeight} ${tile * 0.42}px/1 "${t.display}";background:linear-gradient(135deg,${t.dark ? '#fff' : t.accent},${t.c1});-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}
#${ctx.id} .ring{position:absolute;left:${w / 2 - tile / 2}px;top:${cy - tile / 2}px;width:${tile}px;height:${tile}px;border-radius:50%;border:${Math.max(3, tile * 0.015)}px solid ${t.accent};opacity:0;}
#${ctx.id} .lab{position:absolute;left:0;right:0;top:${cy + tile * 0.6}px;text-align:center;white-space:nowrap;font:${t.displayWeight} ${clamp(Math.min(h * 0.11, (w * 0.9) / Math.max(4, String(p.label || '').length * 0.8)), 24, 120)}px/1 "${t.display}";color:${t.key};letter-spacing:.02em;opacity:0;${t.dark ? `text-shadow:0 0 40px color-mix(in srgb,${t.key} 50%,transparent);` : ''}}`;
  let js = `tl.fromTo('#${ctx.id}-t',{opacity:0,scale:.3,rotation:-12},{opacity:1,scale:1,rotation:0,duration:.42,ease:'back.out(2.2)'},${at});`;
  const cycles = Math.max(0, Math.floor((ctx.t1 - at - 0.1) / 1.2) - 1);
  [0, 1, 2].forEach((i) => { js += `tl.fromTo('#${ctx.id}-g${i}',{opacity:.7,scale:1},{opacity:0,scale:2.3,duration:1.2,ease:'power1.out',repeat:${cycles}},${r3(at + 0.1 + i * 0.4)});`; });
  if (p.label) js += `tl.fromTo('#${ctx.id}-lb',{opacity:0,scale:2,rotation:-4},{opacity:1,scale:1,rotation:-2,duration:.22,ease:'power4.out'},${lat});tl.fromTo('#${ctx.id}-t',{scale:1},{scale:1.1,duration:.12,yoyo:true,repeat:1,ease:'power2.out'},${lat});`;
  return { html, css, js, events: [{ at: at + 0.1, kind: 'enter' }].concat(p.label ? [{ at: lat + 0.04, kind: 'reveal' }] : []) };
}
