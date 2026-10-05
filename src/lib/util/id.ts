let counter = 0;

/** id curto, único na sessão e estável o bastante para itens do plano */
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1679616;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36).slice(-5)}${counter.toString(36)}${rand}`;
}
