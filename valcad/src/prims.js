// Примитивы чертежа (в мм листа, ось y вверх) и построители размеров.
import FW from './fontwidths.js';

export const CAP = 0.729; // высота прописной относительно кегля шрифта
export function textWidth(str, h) {
  const fs = h / CAP;
  let w = 0;
  for (const ch of String(str)) w += (FW[ch] ?? 0.6);
  return w * fs;
}

export class Drawing {
  constructor() { this.p = []; }
  line(x1, y1, x2, y2, w = 'main', s = 'solid', layer) { this.p.push({ t: 'L', x1, y1, x2, y2, w, s, layer }); return this; }
  poly(pts, closed = false, w = 'main', s = 'solid', layer) { if (pts.length > 1) this.p.push({ t: 'P', pts, closed, w, s, layer }); return this; }
  circle(x, y, r, w = 'main', s = 'solid', layer) { this.p.push({ t: 'C', x, y, r, w, s, layer }); return this; }
  arc(x, y, r, a0, a1, w = 'main', s = 'solid', layer) { this.p.push({ t: 'A', x, y, r, a0, a1, w, s, layer }); return this; }
  text(x, y, h, text, o = {}) { if (text !== '' && text != null) this.p.push({ t: 'T', x, y, h, text: String(text), rot: o.rot || 0, anchor: o.anchor || 'l', va: o.va || 'b', layer: o.layer || 'text' }); return this; }
  fill(pts, layer = 'dim') { this.p.push({ t: 'F', pts, layer }); return this; }
  add(other, dx = 0, dy = 0) { for (const q of other.p) this.p.push(shift(q, dx, dy)); return this; }
  bbox() { return bboxOf(this.p); }
}

export function shift(q, dx, dy) {
  switch (q.t) {
    case 'L': return { ...q, x1: q.x1 + dx, y1: q.y1 + dy, x2: q.x2 + dx, y2: q.y2 + dy };
    case 'P': case 'F': return { ...q, pts: q.pts.map(([x, y]) => [x + dx, y + dy]) };
    default: return { ...q, x: q.x + dx, y: q.y + dy };
  }
}

export function bboxOf(prims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const q of prims) {
    if (q.t === 'L') { ext(q.x1, q.y1); ext(q.x2, q.y2); }
    else if (q.t === 'P' || q.t === 'F') for (const [x, y] of q.pts) ext(x, y);
    else if (q.t === 'C' || q.t === 'A') { ext(q.x - q.r, q.y - q.r); ext(q.x + q.r, q.y + q.r); }
    else if (q.t === 'T') {
      for (const [x, y] of textCorners(q)) ext(x, y);
    }
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0, y0, x1, y1 };
}
export function textCorners(q) {
  const w = textWidth(q.text, q.h), h = q.h;
  const ox = q.anchor === 'c' ? -w / 2 : q.anchor === 'r' ? -w : 0;
  const oy = q.va === 'm' ? -h / 2 : q.va === 't' ? -h : 0;
  const a = q.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[ox, oy - h * 0.25], [ox + w, oy - h * 0.25], [ox + w, oy + h * 1.1], [ox, oy + h * 1.1]].map(([u, v]) => [q.x + u * c - v * s, q.y + u * s + v * c]);
}

// ---------- Размеры ----------
export const DIM = { txt: 3.5, arrowL: 3, arrowW: 0.9, ext: 2, gap: 1, devH: 2.5 };

export function arrow(d, x, y, ux, uy) {
  // остриё в (x, y), направление (ux, uy) — куда указывает
  const L = DIM.arrowL, W = DIM.arrowW / 2;
  const bx = x - ux * L, by = y - uy * L;
  d.fill([[x, y], [bx - uy * W, by + ux * W], [bx + uy * W, by - ux * W]]);
}

// Композитная надпись: основной текст + отклонения. Возвращает ширину.
export function labelWidth(lab) {
  const h = DIM.txt, hd = DIM.devH;
  let w = textWidth(lab.main, h);
  if (lab.sym) w += textWidth(' ' + lab.sym, h);
  if (lab.up !== undefined) {
    const inner = Math.max(textWidth(lab.up, hd), textWidth(lab.lo, hd));
    w += (lab.paren ? textWidth('()', h) : 0) + inner + 0.8;
  }
  if (lab.suffix) w += textWidth(lab.suffix, h);
  return w;
}
export function drawLabel(d, lab, x, y, rot = 0, anchor = 'c') {
  // (x, y) — точка опоры на уровне основания текста
  const h = DIM.txt, hd = DIM.devH;
  const W = labelWidth(lab);
  const a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  let u = anchor === 'c' ? -W / 2 : anchor === 'r' ? -W : 0;
  const P = (uu, vv) => [x + uu * c - vv * s, y + uu * s + vv * c];
  const put = (str, hh, uu, vv) => { const [px, py] = P(uu, vv); d.text(px, py, hh, str, { rot, layer: 'dim' }); };
  put(lab.main, h, u, 0); u += textWidth(lab.main, h);
  if (lab.up !== undefined) {
    u += 0.4;
    if (lab.paren) { put('(', h, u, 0); u += textWidth('(', h); }
    const iw = Math.max(textWidth(lab.up, hd), textWidth(lab.lo, hd));
    put(lab.up, hd, u, h - hd + 0.9);
    put(lab.lo, hd, u, -0.5);
    u += iw;
    if (lab.paren) { put(')', h, u, 0); u += textWidth(')', h); }
  }
  if (lab.suffix) { put(lab.suffix, h, u, 0); }
  return W;
}

// Линейный размер между точками a и b (в мм листа), размерная линия — на смещении off по нормали.
// a, b — точки на детали; dir — единичный вектор вдоль размера; nrm — нормаль (куда откладывать)
export function dimAligned(d, a, b, level, lab, opts = {}) {
  // горизонтальный (opts.vertical=false) или вертикальный размер
  const vert = !!opts.vertical;
  const W = labelWidth(lab);
  const h = DIM.txt;
  if (!vert) {
    const xa = Math.min(a[0], b[0]), xb = Math.max(a[0], b[0]);
    const ya = a[0] <= b[0] ? a[1] : b[1], yb = a[0] <= b[0] ? b[1] : a[1];
    const sgn = level >= Math.max(ya, yb) ? 1 : -1;
    if (!opts.noExt) {
      if (Math.abs(ya - level) > 0.3) d.line(xa, ya + sgn * DIM.gap * 0, xa, level + sgn * DIM.ext, 'thin', 'solid', 'dim');
      if (Math.abs(yb - level) > 0.3) d.line(xb, yb, xb, level + sgn * DIM.ext, 'thin', 'solid', 'dim');
    }
    const len = xb - xa;
    const inside = len >= 2 * DIM.arrowL + 1.5;
    const fitsText = len >= W + 2 * DIM.arrowL + 1;
    let tx = (xa + xb) / 2, lineA = xa, lineB = xb;
    if (inside) {
      arrow(d, xa, level, -1, 0); arrow(d, xb, level, 1, 0);
    } else {
      arrow(d, xa, level, 1, 0); arrow(d, xb, level, -1, 0);
      lineA = xa - DIM.arrowL - 2; lineB = xb + DIM.arrowL + 2;
    }
    if (!fitsText) {
      // текст справа на полке
      const side = opts.textSide || 1;
      if (side > 0) { tx = Math.max(xb, lineB) + 1 + W / 2; lineB = tx + W / 2 + 0.5; }
      else { tx = Math.min(xa, lineA) - 1 - W / 2; lineA = tx - W / 2 - 0.5; }
    }
    d.line(lineA, level, lineB, level, 'thin', 'solid', 'dim');
    drawLabel(d, lab, tx, level + 0.9, 0, 'c');
    return { x0: Math.min(lineA, tx - W / 2), x1: Math.max(lineB, tx + W / 2) };
  } else {
    const ya = Math.min(a[1], b[1]), yb = Math.max(a[1], b[1]);
    const xa = a[1] <= b[1] ? a[0] : b[0], xb = a[1] <= b[1] ? b[0] : a[0];
    const sgn = level >= Math.max(xa, xb) ? 1 : -1;
    if (!opts.noExt) {
      if (Math.abs(xa - level) > 0.3) d.line(xa, ya, level + sgn * DIM.ext, ya, 'thin', 'solid', 'dim');
      if (Math.abs(xb - level) > 0.3) d.line(xb, yb, level + sgn * DIM.ext, yb, 'thin', 'solid', 'dim');
    }
    const len = yb - ya;
    const inside = len >= 2 * DIM.arrowL + 1.5;
    let la = ya, lb = yb;
    if (inside) { arrow(d, level, ya, 0, -1); arrow(d, level, yb, 0, 1); }
    else { arrow(d, level, ya, 0, 1); arrow(d, level, yb, 0, -1); la = ya - DIM.arrowL - 2; lb = yb + DIM.arrowL + 2; }
    let ty = (ya + yb) / 2;
    if (len < W + 2 * DIM.arrowL + 1) { ty = Math.max(yb, lb) + 1 + W / 2; lb = ty + W / 2 + 0.5; }
    d.line(level, la, level, lb, 'thin', 'solid', 'dim');
    drawLabel(d, lab, level - 0.9, ty, 90, 'c');
    return { y0: la, y1: lb };
  }
}

// Размер диаметра: вертикальная линия через ось в точке x, от y1 до y2
export function dimDiameter(d, x, y1, y2, lab, opts = {}) {
  const ya = Math.min(y1, y2), yb = Math.max(y1, y2);
  const W = labelWidth(lab);
  const len = yb - ya;
  if (opts.half) {
    // половинный размер: одна стрелка, линия за ось
    arrow(d, x, yb, 0, 1);
    const la = (ya + yb) / 2 - Math.min(8, len / 4);
    d.line(x, la, x, yb, 'thin', 'solid', 'dim');
    drawLabel(d, lab, x - 0.9, (la + yb) / 2 + 2, 90, 'c');
    return;
  }
  if (len >= W + 2 * DIM.arrowL + 2) {
    arrow(d, x, ya, 0, -1); arrow(d, x, yb, 0, 1);
    d.line(x, ya, x, yb, 'thin', 'solid', 'dim');
    const ty = opts.textY !== undefined ? opts.textY : (ya + yb) / 2;
    drawLabel(d, lab, x - 0.9, ty, 90, 'c');
  } else {
    // малый диаметр: стрелки снаружи, текст сверху
    arrow(d, x, ya, 0, 1); arrow(d, x, yb, 0, -1);
    const top = yb + DIM.arrowL + 2 + W + 1;
    d.line(x, ya - DIM.arrowL - 2, x, top, 'thin', 'solid', 'dim');
    drawLabel(d, lab, x - 0.9, yb + DIM.arrowL + 2 + W / 2 + 0.5, 90, 'c');
  }
}

// Линия-выноска с полкой
export function leader(d, px, py, text, opts = {}) {
  const h = opts.h || DIM.txt;
  const lines = Array.isArray(text) ? text : [text];
  const W = Math.max(...lines.map(t => textWidth(t, h))) + 1;
  const dx = opts.dx ?? 6, dy = opts.dy ?? 8;
  const kx = px + dx, ky = py + dy;
  const right = dx >= 0;
  d.line(px, py, kx, ky, 'thin', 'solid', 'dim');
  d.line(kx, ky, right ? kx + W : kx - W, ky, 'thin', 'solid', 'dim');
  if (opts.arrow !== false) {
    const L = Math.hypot(dx, dy); arrow(d, px, py, -dx / L, -dy / L);
  } else d.circle(px, py, 0.4, 'thin', 'solid', 'dim');
  lines.forEach((t, i) => {
    const tx = right ? kx + 0.5 : kx - W + 0.5;
    if (i === 0) d.text(tx, ky + 0.8, h, t, { layer: 'dim' });
    else d.text(tx, ky - 0.8 - i * (h + 1.5) + 0 - 0, h, t, { layer: 'dim', va: 't' });
  });
  return { x0: Math.min(px, kx - (right ? 0 : W)), x1: Math.max(px, kx + (right ? W : 0)), y: ky };
}

// Знак шероховатости: остриё в (x, y), знак вверх (или повернут)
export function roughness(d, x, y, value, opts = {}) {
  const H = 5, h = opts.h || DIM.txt;
  const rot = (opts.rot || 0) * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
  const P = (u, v) => [x + u * c - v * s, y + u * s + v * c];
  const t60 = Math.tan(Math.PI / 3);
  const tl = [-H / t60, H], tr = [2 * H / t60, 2 * H];
  const txt = value ? 'Ra ' + value : '';
  const W = txt ? textWidth(txt, h) + 1 : 0;
  d.poly([P(...tl), P(0, 0), P(...tr), P(tr[0] + W, tr[1])], false, 'thin', 'solid', 'dim');
  if (txt) {
    const [tx, ty] = P(tr[0] + 0.5, tr[1] + 0.8);
    d.text(tx, ty, h, txt, { rot: opts.rot || 0, layer: 'dim' });
  }
  return tr[0] + W;
}

// Штриховка мультиполигона линиями под углом ang с шагом step
export function hatch(d, mpoly, step = 2, ang = 45) {
  const a = ang * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  // поворот на -ang: линии штриховки становятся горизонтальными
  const edges = [];
  let vmin = Infinity, vmax = -Infinity;
  for (const poly of mpoly) for (const ring of poly) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const pu = p[0] * c + p[1] * s, pv = -p[0] * s + p[1] * c;
      const qu = q[0] * c + q[1] * s, qv = -q[0] * s + q[1] * c;
      edges.push([pu, pv, qu, qv]);
      vmin = Math.min(vmin, pv, qv); vmax = Math.max(vmax, pv, qv);
    }
  }
  if (!edges.length) return;
  const start = Math.ceil(vmin / step) * step;
  for (let v = start; v <= vmax; v += step) {
    const xs = [];
    for (const [pu, pv, qu, qv] of edges) {
      if ((pv <= v && qv > v) || (qv <= v && pv > v)) xs.push(pu + (v - pv) * (qu - pu) / (qv - pv));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const u1 = xs[i], u2 = xs[i + 1];
      if (u2 - u1 < 0.05) continue;
      d.line(u1 * c - v * s, u1 * s + v * c, u2 * c - v * s, u2 * s + v * c, 'thin', 'solid', 'hatch');
    }
  }
}

export function outlineMP(d, mpoly, w = 'main') {
  for (const poly of mpoly) for (const ring of poly) {
    const pts = ring.slice();
    if (pts.length > 1) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts.pop();
    }
    d.poly(pts, true, w);
  }
}
