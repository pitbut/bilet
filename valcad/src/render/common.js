// Общие параметры отображения линий по ГОСТ 2.303
export const LW = { main: 0.5, thick: 0.9, thin: 0.25 };
export const DASH = {
  solid: null,
  dash: [3, 1.5],
  dashdot: [10, 1.5, 1, 1.5],
};
export const LAYER_COLOR = {
  main: '#111', thin: '#111', axis: '#111', hidden: '#111', dim: '#111', hatch: '#111', text: '#111', frame: '#111',
};
export function layerOf(q) {
  if (q.layer) return q.layer;
  if (q.s === 'dashdot') return 'axis';
  if (q.s === 'dash') return 'hidden';
  return q.w === 'thin' ? 'thin' : 'main';
}
export function arcPoints(x, y, r, a0, a1, n) {
  const pts = [];
  const N = n || Math.max(8, Math.ceil(Math.abs(a1 - a0) / 6));
  for (let i = 0; i <= N; i++) {
    const a = (a0 + (a1 - a0) * i / N) * Math.PI / 180;
    pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
  }
  return pts;
}
