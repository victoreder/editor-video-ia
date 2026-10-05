// Geometria do quadro: como a fonte (qualquer proporção) é encaixada no formato
// de saída com "cover", deslocada para manter o rosto no quadro (reframe barato
// de 16:9 → 9:16) e onde o rosto cai na TELA (para zoom e safezone).
export type CoverFit = {
  scale: number; // fator fonte → tela
  dw: number; // tamanho exibido
  dh: number;
  offX: number; // canto superior esquerdo exibido (px de tela, ≤ 0)
  offY: number;
  posX: number; // object-position usado (0..1)
  posY: number;
};

export function coverFit(srcW: number, srcH: number, outW: number, outH: number, focusX = 0.5, focusY = 0.4): CoverFit {
  const scale = Math.max(outW / srcW, outH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  // centraliza o foco quando sobra espaço, sem mostrar borda preta
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const offX = dw > outW ? clamp(outW / 2 - focusX * dw, outW - dw, 0) : (outW - dw) / 2;
  const offY = dh > outH ? clamp(outH / 2 - focusY * dh, outH - dh, 0) : (outH - dh) / 2;
  const posX = dw > outW ? offX / (outW - dw) : 0.5;
  const posY = dh > outH ? offY / (outH - dh) : 0.5;
  return {scale, dw, dh, offX, offY, posX, posY};
}

/** ponto normalizado da fonte → ponto normalizado da tela (antes do zoom) */
export const srcToScreen = (fit: CoverFit, outW: number, outH: number, x: number, y: number) => ({
  x: (fit.offX + x * fit.dw) / outW,
  y: (fit.offY + y * fit.dh) / outH,
});
