import { r3 } from './_kit.mjs';

export const meta = {
  name: 'confetti',
  summary: 'A burst of confetti on a win — a launch, a result, "you did it". Seeded, so every render is the same. Once per video at most.',
  props: { word: 'the word it bursts on', x: 'origin, 0–1 of the box width', y: 'origin, 0–1 of the box height' },
};

export function render(p, ctx) {
  const { w, h } = ctx.box, t = ctx.tokens;
  const at = r3(p.word ? (ctx.word(p.word) ?? ctx.t0 + 0.1) : ctx.t0 + 0.1);
  const ox = (p.x ?? 0.5) * w, oy = (p.y ?? 0.45) * h, colors = [t.accent, t.key, t.c1, t.c2, t.c3, t.c4];
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pieces = Array.from({ length: 48 }, (_, i) => {
    const a = rnd() * Math.PI * 2, v = (0.35 + rnd() * 0.5) * Math.min(w, h);
    return { dx: Math.cos(a) * v, dy: Math.sin(a) * v - Math.min(w, h) * 0.35, rot: (rnd() - 0.5) * 900, c: colors[i % colors.length], s: 10 + rnd() * 14 };
  });
  const html = pieces.map((q, i) => `<i id="${ctx.id}-p${i}" style="left:${ox}px;top:${oy}px;width:${q.s}px;height:${q.s * 0.6}px;background:${q.c}"></i>`).join('');
  const css = `#${ctx.id} i{position:absolute;display:block;border-radius:2px;opacity:0;}`;
  let js = '';
  pieces.forEach((q, i) => {
    js += `tl.set('#${ctx.id}-p${i}',{opacity:1},${at});tl.to('#${ctx.id}-p${i}',{x:${q.dx.toFixed(0)},duration:1.3,ease:'power2.out'},${at});`;
    js += `tl.to('#${ctx.id}-p${i}',{keyframes:[{y:${q.dy.toFixed(0)},duration:.45,ease:'power2.out'},{y:${(q.dy + h * 0.9).toFixed(0)},duration:.85,ease:'power1.in'}]},${at});`;
    js += `tl.to('#${ctx.id}-p${i}',{rotation:${q.rot.toFixed(0)},duration:1.3,ease:'none'},${at});tl.to('#${ctx.id}-p${i}',{opacity:0,duration:.3},${r3(at + 1.0)});`;
  });
  return { html, css, js, events: [{ at, kind: 'reveal' }] };
}
