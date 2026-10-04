import { esc, r3 } from './_kit.mjs';

export const meta = {
  name: 'sticker',
  summary: 'A sticker that slaps onto the frame on its word — an emoji, an icon badge or a short tag ("NEW", "FREE", "#1"). Use sparingly, beside the face, never on it.',
  props: { emoji: 'an emoji character', icon: 'or a Lucide icon', text: 'or a short tag', word: 'the word it lands on', x: 'centre, 0–1 of the box width', y: 'centre, 0–1 of the box height', rotate: 'degrees' },
};

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens;
  const at = r3(p.word ? (ctx.word(p.word) ?? ctx.t0 + 0.1) - 0.06 : ctx.t0 + 0.1);
  const size = Math.min(w, h) * (p.text ? 0.1 : 0.2), x = (p.x ?? 0.78) * w, y = (p.y ?? 0.3) * h, rot = p.rotate ?? 8;
  const inner = p.emoji ? `<span class="em">${esc(p.emoji)}</span>` : p.icon ? `<span class="ib">${ctx.icon(p.icon, { size: size * 0.55, stroke: 2.6 })}</span>` : `<span class="tg">${esc(p.text)}</span>`;
  const html = `<div class="st" id="${ctx.id}-s" style="left:${x}px;top:${y}px">${inner}</div>`;
  const css = `#${ctx.id} .st{position:absolute;transform:translate(-50%,-50%);opacity:0;}
#${ctx.id} .em{display:block;font-size:${size}px;line-height:1;filter:drop-shadow(0 10px 20px rgba(0,0,0,.4));}
#${ctx.id} .ib{display:flex;width:${size}px;height:${size}px;border-radius:50%;background:${t.key};color:#0A0A18;align-items:center;justify-content:center;box-shadow:0 12px 30px rgba(0,0,0,.35);}
#${ctx.id} .tg{display:block;padding:${size * 0.25}px ${size * 0.5}px;border-radius:${size * 0.25}px;background:${t.key};color:#0A0A18;font:900 ${size * 0.6}px/1 "${t.display}";box-shadow:0 12px 30px rgba(0,0,0,.35);}`;
  const js = `tl.fromTo('#${ctx.id}-s',{opacity:0,scale:2.4,rotation:${rot - 25}},{opacity:1,scale:1,rotation:${rot},duration:.24,ease:'back.out(2.2)'},${at});tl.to('#${ctx.id}-s',{opacity:0,scale:.6,duration:.2,ease:'power2.in'},${r3(Math.max(at + 0.9, ctx.t1 - 0.22))});`;
  return { html, css, js, events: [{ at: at + 0.04, kind: 'reveal' }] };
}
