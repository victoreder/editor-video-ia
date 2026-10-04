import { esc, r3, clamp, landings } from './_kit.mjs';

export const meta = {
  name: 'compare',
  summary: 'Two sides compared — before/after, old/new, them/us, myth/fact. Each side arrives on its word with an icon and up to three points; a VS or arrow badge joins them. The winning side can be marked.',
  props: { left: '{ title, icon?, points?: [text], word? }', right: '{ title, icon?, points?: [text], word? }', join: 'vs | arrow', winner: 'left | right | none' },
};

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens;
  const sides = [p.left || {}, p.right || {}];
  const vertical = w < h * 0.9;                           // stack on a narrow box
  const pad = w * 0.05, gap = vertical ? h * 0.06 : w * 0.06;
  const sw = vertical ? w - pad * 2 : (w - pad * 2 - gap) / 2, sh = vertical ? (h - pad * 2 - gap) / 2 : h - pad * 2;
  const at = landings(sides, ctx);
  const fsT = clamp(Math.min(sw, sh) * 0.13, 20, 72), fsP = clamp(Math.min(sw, sh) * 0.075, 14, 40);
  const colors = [p.winner === 'left' ? t.c3 : t.c2, p.winner === 'left' ? t.c2 : t.c3];
  const html = sides.map((s, i) => {
    const x = vertical ? pad : pad + i * (sw + gap), y = vertical ? pad + i * (sh + gap) : pad;
    return `<div class="side" id="${ctx.id}-s${i}" style="left:${x}px;top:${y}px;width:${sw}px;height:${sh}px;--c:${colors[i]}">${s.icon ? ctx.icon(s.icon, { size: Math.min(sw, sh) * 0.22 }) : ''}<div class="st">${esc(s.title || '')}</div>${(s.points || []).slice(0, 3).map((pt) => `<div class="pt">${esc(pt)}</div>`).join('')}</div>`;
  }).join('') + `<div class="join" id="${ctx.id}-j">${p.join === 'arrow' ? ctx.icon(vertical ? 'arrow-down' : 'arrow-right', { size: Math.min(w, h) * 0.09, stroke: 3 }) : 'VS'}</div>`;
  const jx = vertical ? w / 2 : pad + sw + gap / 2, jy = vertical ? pad + sh + gap / 2 : h / 2, js0 = Math.min(w, h) * 0.16;
  const css = `#${ctx.id} .side{position:absolute;border-radius:${Math.min(sw, sh) * 0.08}px;background:${t.dark ? 'rgba(255,255,255,.06)' : '#fff'};border:4px solid var(--c);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${sh * 0.04}px;padding:${sh * 0.06}px;color:var(--c);opacity:0;${t.dark ? '' : 'box-shadow:0 14px 40px rgba(17,24,39,.12);'}}
#${ctx.id} .st{font:${t.displayWeight} ${fsT}px/1.05 "${t.display}";color:${t.text};text-align:center;text-transform:uppercase;}
#${ctx.id} .pt{font:700 ${fsP}px/1.2 "${t.body}";color:${t.text};opacity:.85;text-align:center;}
#${ctx.id} .join{position:absolute;left:${jx - js0 / 2}px;top:${jy - js0 / 2}px;width:${js0}px;height:${js0}px;border-radius:50%;background:${t.key};color:#0A0A18;display:flex;align-items:center;justify-content:center;font:900 ${js0 * 0.36}px/1 "${t.display}";box-shadow:0 10px 30px rgba(0,0,0,.35);opacity:0;}`;
  let js = '';
  sides.forEach((_, i) => { js += `tl.fromTo('#${ctx.id}-s${i}',{opacity:0,${vertical ? 'y' : 'x'}:${i ? 60 : -60}},{opacity:1,${vertical ? 'y' : 'x'}:0,duration:.4,ease:'power3.out'},${at[i]});`; });
  const jat = r3((at[0] + at[1]) / 2 + 0.05);
  js += `tl.fromTo('#${ctx.id}-j',{opacity:0,scale:0,rotation:-90},{opacity:1,scale:1,rotation:0,duration:.35,ease:'back.out(2.5)'},${jat});`;
  if (p.winner === 'left' || p.winner === 'right') { const k = p.winner === 'left' ? 0 : 1, o = 1 - k; js += `tl.to('#${ctx.id}-s${o}',{opacity:.45,scale:.95,duration:.3},${r3(Math.max(...at) + 0.4)});tl.to('#${ctx.id}-s${k}',{scale:1.04,duration:.3,ease:'back.out(2)'},${r3(Math.max(...at) + 0.4)});`; }
  return { html, css, js, events: [...at.map((a) => ({ at: a + 0.05, kind: 'enter' })), { at: jat, kind: 'reveal' }] };
}
