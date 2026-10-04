import { esc, r3, clamp } from './_kit.mjs';

export const meta = {
  name: 'lowerthird',
  summary: 'A name and a role, sliding in beside the speaker — introductions, a guest, a source. Sits low in the frame, clear of the captions and the mouth.',
  props: { name: 'the name', role: 'the title or role', word: 'when it arrives (usually the name spoken)' },
};

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens;
  const at = r3(p.word ? (ctx.word(p.word) ?? ctx.t0 + 0.2) - 0.1 : ctx.t0 + 0.2);
  const fsN = clamp(Math.min(w * 0.06, h * 0.045), 22, 64), fsR = fsN * 0.55, x = w * 0.06, y = h * 0.62;
  const html = `<div class="lt" id="${ctx.id}-lt"><div class="acc"></div><div class="nm">${esc(p.name)}</div><div class="rl">${esc(p.role || '')}</div></div>`;
  const css = `#${ctx.id} .lt{position:absolute;left:${x}px;top:${y}px;padding:${fsN * 0.45}px ${fsN * 0.8}px ${fsN * 0.45}px ${fsN * 1.1}px;background:${t.dark ? 'rgba(10,10,24,.82)' : 'rgba(255,255,255,.94)'};border-radius:${fsN * 0.3}px;clip-path:inset(0 100% 0 0);}
#${ctx.id} .acc{position:absolute;left:0;top:0;bottom:0;width:${fsN * 0.3}px;background:${t.accent};}
#${ctx.id} .nm{font:${t.displayWeight} ${fsN}px/1.1 "${t.display}";color:${t.text};}
#${ctx.id} .rl{font:600 ${fsR}px/1.2 "${t.body}";color:${t.text};opacity:.75;letter-spacing:.06em;text-transform:uppercase;}`;
  const js = `tl.fromTo('#${ctx.id}-lt',{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)',duration:.45,ease:'power3.out'},${at});tl.to('#${ctx.id}-lt',{clipPath:'inset(0 0 0 100%)',duration:.35,ease:'power3.in'},${r3(Math.max(at + 1.5, ctx.t1 - 0.4))});`;
  return { html, css, js, events: [{ at: at + 0.05, kind: 'enter' }] };
}
