// Построение чертежа вала: вид / полуразрез / разрез, сечения, размеры, лист.
import pc from 'polygon-clipping';
import { computeModel, outerPolygon, innerPolygon, vertexLines, rAt, fmt, num } from './geom.js';
import { deviations, fmtDev } from './standards.js';
import {
  Drawing, DIM, textWidth, dimAligned, dimDiameter, leader, roughness, hatch, outlineMP, arrow, labelWidth, bboxOf, shift,
} from './prims.js';

const LETTERS = 'АБВГДЕЖИКЛМНПРСТУФЦШЭЮЯ';
export const FORMATS = { A4: [210, 297], A3: [420, 297], A2: [594, 420], A1: [841, 594] };
const SCALES = [5, 4, 2.5, 2, 1, 0.5, 0.4, 0.25, 0.2, 0.1, 0.05];
export function scaleName(s) {
  if (s >= 1) return fmt(s) + ':1';
  return '1:' + fmt(Math.round(1 / s * 100) / 100);
}
export function parseScale(str) {
  const m = /^(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)$/.exec(String(str || ''));
  if (!m) return null;
  return num(m[1]) / num(m[2]);
}

function diaLabel(v, fit, prefix = '⌀') {
  const lab = { main: prefix + fmt(v) + (fit || '') };
  const dv = deviations(fit, v);
  if (dv) {
    if (Math.abs(dv.es + dv.ei) < 1e-9) lab.main += ' ±' + fmtDev(dv.es).replace('+', '');
    else { lab.up = fmtDev(dv.es); lab.lo = fmtDev(dv.ei); lab.paren = true; }
  }
  return lab;
}
function lenLabel(v) { return { main: fmt(Math.round(v * 100) / 100) }; }

// ---------- Геометрия областей (в мм модели) ----------
function circlePoly(cx, cy, r, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
function rectPoly(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
function safeDiff(subject, clips) {
  let res = [[subject]];
  for (const c of clips) {
    if (!c || c.length < 3) continue;
    try { res = pc.difference(res, [c]); } catch (e) { /* пропустить вырожденное */ }
  }
  return res;
}
function sectionCuts(geo) {
  const cuts = [];
  const R = geo.Rmax + 5;
  for (const inn of [geo.inner.L, geo.inner.R]) {
    const p = innerPolygon(inn); if (p) cuts.push(p);
    for (const k of inn.keyways) {
      const a = inn.map(k.u0), b = inn.map(k.u1);
      const sg = k.angle === 'снизу' ? -1 : 1;
      cuts.push(rectPoly(Math.min(a, b) - (inn.side === 'L' ? 1 : 0), sg * (k.r - 0.2), Math.max(a, b) + (inn.side === 'R' ? 1 : 0), sg * (k.r + k.t)));
    }
  }
  for (const k of geo.keyways) {
    if (k.angle !== 'сверху' && k.angle !== 'снизу') continue;
    const sg = k.angle === 'снизу' ? -1 : 1;
    if (k.kind === 'сегментная') {
      const Rk = k.dseg / 2, xm = (k.x1 + k.x2) / 2;
      cuts.push(circlePoly(xm, sg * (k.r - k.t + Rk), Rk, 64));
    } else cuts.push(rectPoly(k.x1, sg * (k.r - k.t), k.x2, sg * (k.r + 5)));
  }
  for (const h of geo.crossholes) {
    const d = h.d;
    if (h.angle === 'вертикально') {
      if (h.through) cuts.push(rectPoly(h.x - d / 2, -R, h.x + d / 2, R));
      else {
        const yb = h.r - h.depth, tip = (d / 2) / Math.tan(59 * Math.PI / 180);
        cuts.push([[h.x - d / 2, R], [h.x - d / 2, yb], [h.x, yb - tip], [h.x + d / 2, yb], [h.x + d / 2, R]]);
      }
    } else if (h.through || h.depth >= h.r) cuts.push(circlePoly(h.x, 0, d / 2, 32));
  }
  for (const h of geo.ringholes) {
    for (let i = 0; i < h.n; i++) {
      const a = (h.a0 + i * 360 / h.n) * Math.PI / 180;
      if (Math.abs(Math.cos(a)) > 0.3) continue;
      const sg = Math.sin(a) > 0 ? 1 : -1;
      const inner = h.depth > 0 ? h.r - h.depth : 0;
      cuts.push(rectPoly(h.x - h.d / 2, sg * inner, h.x + h.d / 2, sg * (h.r + 5)));
    }
  }
  for (const h of geo.faceholes) {
    const x2 = h.xf + h.dir * h.depth, tip = (h.d / 2) / Math.tan(59 * Math.PI / 180);
    const ext = h.xf - h.dir * 1;
    for (const sg of h.n >= 2 ? [1, -1] : [1]) {
      const yc = sg * h.pcd / 2;
      cuts.push([[ext, yc - h.d / 2], [x2, yc - h.d / 2], [x2 + h.dir * tip, yc], [x2, yc + h.d / 2], [ext, yc + h.d / 2]]);
    }
  }
  for (const g of geo.facegrooves) {
    const x2 = g.xf + g.dir * g.depth, ext = g.xf - g.dir * 1;
    cuts.push(rectPoly(Math.min(ext, x2), g.rIn, Math.max(ext, x2), g.rOut));
    cuts.push(rectPoly(Math.min(ext, x2), -g.rOut, Math.max(ext, x2), -g.rIn));
  }
  return cuts;
}

export function regionModel(geo) {
  const outer = outerPolygon(geo.body);
  return safeDiff(outer, sectionCuts(geo));
}

// Масса по объёму тела вращения (приближённо)
export function massKg(geo, region, density = 7.85e-6) {
  let top;
  try { top = pc.intersection(region, [[rectPoly(-10, 0, geo.Lt + 10, geo.Rmax + 10)]]); } catch (e) { return 0; }
  let V = 0;
  for (const poly of top) for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      V += (x2 - x1) * (y1 * y1 + y1 * y2 + y2 * y2) / 3;
    }
  }
  return Math.abs(Math.PI * V) * density;
}

function scaleMP(mp, s) { return mp.map(poly => poly.map(ring => ring.map(([x, y]) => [x * s, y * s]))); }

// ---------- Отсечение примитивов полуплоскостью (для полуразреза) ----------
function clipHalf(prims, keepUpper) {
  const out = [];
  const inside = y => keepUpper ? y >= -1e-9 : y <= 1e-9;
  const clipSeg = (x1, y1, x2, y2) => {
    const a = inside(y1), b = inside(y2);
    if (a && b) return [x1, y1, x2, y2];
    if (!a && !b) return null;
    const t = (0 - y1) / (y2 - y1), xi = x1 + (x2 - x1) * t;
    return a ? [x1, y1, xi, 0] : [xi, 0, x2, y2];
  };
  for (const q of prims) {
    if (q.t === 'L') {
      const r = clipSeg(q.x1, q.y1, q.x2, q.y2);
      if (r) out.push({ ...q, x1: r[0], y1: r[1], x2: r[2], y2: r[3] });
    } else if (q.t === 'P' || q.t === 'C' || q.t === 'A') {
      let pts;
      if (q.t === 'P') { pts = q.pts.slice(); if (q.closed) pts.push(pts[0]); }
      else {
        const a0 = q.t === 'C' ? 0 : q.a0, a1 = q.t === 'C' ? 360 : q.a1;
        pts = []; const n = 48;
        for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts.push([q.x + q.r * Math.cos(a), q.y + q.r * Math.sin(a)]); }
      }
      let cur = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const r = clipSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        if (r) {
          if (!cur.length) cur.push([r[0], r[1]]);
          cur.push([r[2], r[3]]);
          if (!inside(pts[i + 1][1]) || Math.abs(r[3]) < 1e-9 && !inside(pts[i + 1][1])) { out.push({ t: 'P', pts: cur, closed: false, w: q.w, s: q.s, layer: q.layer }); cur = []; }
        } else if (cur.length) { out.push({ t: 'P', pts: cur, closed: false, w: q.w, s: q.s, layer: q.layer }); cur = []; }
      }
      if (cur.length > 1) out.push({ t: 'P', pts: cur, closed: false, w: q.w, s: q.s, layer: q.layer });
    } else if (q.t === 'F') {
      if (q.pts.every(p => inside(p[1]))) out.push(q);
    } else out.push(q);
  }
  return out;
}

// ---------- Главный вид ----------
function mainView(project, geo, s, mode, region, opts) {
  const V = new Drawing();   // видимая часть (вид)
  const S = new Drawing();   // разрез
  const X = x => x * s, Y = y => y * s;
  const Lt = geo.Lt;

  // --- Вид ---
  const visTop = geo.vis.map(p => ({ ...p }));
  const visBot = geo.vis.map(p => ({ ...p }));
  let top = visTop, bot = visBot;
  for (const k of geo.keyways) {
    if (k.angle !== 'сверху' && k.angle !== 'снизу') continue;
    const tgt = k.angle === 'сверху' ? 'top' : 'bot';
    const cut = (pts) => {
      const left = pts.filter(p => p.x < k.x1 - 1e-6), right = pts.filter(p => p.x > k.x2 + 1e-6);
      const mid = [];
      if (k.kind === 'сегментная') {
        const Rk = k.dseg / 2, xm = (k.x1 + k.x2) / 2, cy = k.r - k.t + Rk;
        for (let i = 0; i <= 16; i++) {
          const xx = k.x1 + (k.x2 - k.x1) * i / 16;
          mid.push({ x: xx, r: Math.min(rAt(pts, xx), cy - Math.sqrt(Math.max(Rk * Rk - (xx - xm) ** 2, 0))), s: i > 0 && i < 16 });
        }
      } else {
        mid.push({ x: k.x1, r: rAt(pts, k.x1, 1), s: false }, { x: k.x1, r: k.r - k.t, s: false }, { x: k.x2, r: k.r - k.t, s: false }, { x: k.x2, r: rAt(pts, k.x2, -1), s: false });
      }
      return [...left, ...mid, ...right];
    };
    if (tgt === 'top') top = cut(top); else bot = cut(bot);
  }
  V.poly(top.map(p => [X(p.x), Y(p.r)]), false, 'main');
  V.poly(bot.map(p => [X(p.x), -Y(p.r)]), false, 'main');
  for (const v of vertexLines(geo.vis)) V.line(X(v.x), -Y(v.r), X(v.x), Y(v.r), 'main');
  // спецлинии
  special(V, geo, s, 'view');
  // внутренние невидимые
  for (const inn of [geo.inner.L, geo.inner.R]) {
    if (!inn.pts.length) continue;
    const m = inn.map;
    const seq = inn.pts.map(p => [X(m(p.x)), Y(p.r)]);
    if (inn.tipU !== null) seq.push([X(m(inn.tipU)), 0]); else seq.push([X(m(inn.cylDepth)), Y(inn.pts[inn.pts.length - 1].r)], [X(m(inn.cylDepth)), 0]);
    V.poly(seq, false, 'thin', 'dash');
    V.poly(seq.map(([x, y]) => [x, -y]), false, 'thin', 'dash');
    for (const v of vertexLines(inn.pts)) if (v.x > 1e-6) V.line(X(m(v.x)), -Y(v.r), X(m(v.x)), Y(v.r), 'thin', 'dash');
    for (const s2 of inn.segs) if (s2.info.toothed) {
      const r = s2.info.tipR;
      V.line(X(m(s2.u0)), Y(r), X(m(s2.u1)), Y(r), 'thin', 'dash');
      V.line(X(m(s2.u0)), -Y(r), X(m(s2.u1)), -Y(r), 'thin', 'dash');
    }
  }
  // шпоночные пазы к зрителю
  for (const k of geo.keyways) {
    if (k.angle !== 'к зрителю' && k.angle !== 'от зрителя') continue;
    const st = k.angle === 'к зрителю' ? 'solid' : 'dash', w = k.angle === 'к зрителю' ? 'main' : 'thin';
    const b2 = Y(k.b / 2);
    if (k.kind === 'сегментная') V.poly([[X(k.x1), -b2], [X(k.x2), -b2], [X(k.x2), b2], [X(k.x1), b2]], true, w, st);
    else {
      const rr = Math.min(b2, X(k.len) / 2);
      V.line(X(k.x1) + rr, b2, X(k.x2) - rr, b2, w, st);
      V.line(X(k.x1) + rr, -b2, X(k.x2) - rr, -b2, w, st);
      V.arc(X(k.x1) + rr, 0, rr, 90, 270, w, st);
      V.arc(X(k.x2) - rr, 0, rr, -90, 90, w, st);
    }
  }
  // поперечные отверстия
  for (const h of geo.crossholes) {
    const cx = X(h.x);
    if (h.angle === 'вертикально') {
      const y1 = h.through ? -Y(h.r) : Y(h.r - h.depth), y2 = Y(h.r);
      V.line(cx - Y(h.d / 2), y1, cx - Y(h.d / 2), y2, 'thin', 'dash');
      V.line(cx + Y(h.d / 2), y1, cx + Y(h.d / 2), y2, 'thin', 'dash');
      V.line(cx, y1 - 3, cx, y2 + 3, 'thin', 'dashdot');
    } else {
      V.circle(cx, 0, Y(h.d / 2), 'main');
      if (h.th) V.arc(cx, 0, Y(h.th.d / 2), 0, 270, 'thin');
      const e = Y(h.d / 2) + 3;
      V.line(cx - e, 0, cx + e, 0, 'thin', 'dashdot'); V.line(cx, -e, cx, e, 'thin', 'dashdot');
    }
  }
  for (const h of geo.ringholes) {
    for (let i = 0; i < h.n; i++) {
      const a = (h.a0 + i * 360 / h.n) * Math.PI / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      if (ca > 0.2) {
        const pts = []; const cy = Y(h.r * sa);
        for (let j = 0; j < 40; j++) { const t = 2 * Math.PI * j / 40; pts.push([X(h.x) + Y(h.d / 2) * Math.cos(t), cy + Y(h.d / 2) * ca * Math.sin(t)]); }
        V.poly(pts, true, 'main');
      } else if (Math.abs(ca) <= 0.3) {
        const sg = sa > 0 ? 1 : -1, y1 = sg * Y(h.depth > 0 ? h.r - h.depth : 0), y2 = sg * Y(h.r);
        V.line(X(h.x) - Y(h.d / 2), y1, X(h.x) - Y(h.d / 2), y2, 'thin', 'dash');
        V.line(X(h.x) + Y(h.d / 2), y1, X(h.x) + Y(h.d / 2), y2, 'thin', 'dash');
      }
    }
    V.line(X(h.x), -Y(h.r) - 3, X(h.x), Y(h.r) + 3, 'thin', 'dashdot');
  }
  for (const h of geo.faceholes) {
    const x1 = X(h.xf), x2 = X(h.xf + h.dir * h.depth);
    for (const sg of h.n >= 2 ? [1, -1] : [1]) {
      const yc = sg * Y(h.pcd / 2), r = Y(h.d / 2);
      V.line(x1, yc - r, x2, yc - r, 'thin', 'dash'); V.line(x1, yc + r, x2, yc + r, 'thin', 'dash');
      V.line(x1 - h.dir * 3, yc, x2 + h.dir * 3, yc, 'thin', 'dashdot');
    }
  }
  for (const g of geo.facegrooves) {
    const x1 = X(g.xf), x2 = X(g.xf + g.dir * g.depth);
    for (const sg of [1, -1]) {
      V.poly([[x1, sg * Y(g.rIn)], [x2, sg * Y(g.rIn)], [x2, sg * Y(g.rOut)], [x1, sg * Y(g.rOut)]], false, 'thin', 'dash');
    }
  }

  // --- Разрез ---
  const regP = scaleMP(region, s);
  hatch(S, regP, Math.max(1.2, Math.min(3, geo.Rmax * s / 8)), 45);
  outlineMP(S, regP, 'main');
  S.poly(geo.vis.map(p => [X(p.x), Y(p.r)]), false, 'main');
  S.poly(geo.vis.map(p => [X(p.x), -Y(p.r)]), false, 'main');
  for (const o of geo.outer) if (o.info.toothed) {
    for (const [xx, rb] of [[o.x0, o.info.rb0], [o.x1, o.info.rb1]]) {
      const rv = rAt(o.pts, xx === o.x0 ? xx + 1e-4 : xx - 1e-4);
      S.line(X(xx), Y(rb), X(xx), Y(rv), 'main'); S.line(X(xx), -Y(rb), X(xx), -Y(rv), 'main');
    }
  }
  for (const inn of [geo.inner.L, geo.inner.R]) {
    const m = inn.map;
    for (const v of vertexLines(inn.pts)) if (v.x > 1e-6) S.line(X(m(v.x)), -Y(v.r), X(m(v.x)), Y(v.r), 'main');
    for (const s2 of inn.segs) if (s2.info.toothed) {
      const r = s2.info.tipR, R = s2.info.r0;
      for (const sg of [1, -1]) {
        S.line(X(m(s2.u0)), sg * Y(r), X(m(s2.u1)), sg * Y(r), 'main');
        S.line(X(m(s2.u0)), sg * Y(r), X(m(s2.u0)), sg * Y(R), 'main');
        S.line(X(m(s2.u1)), sg * Y(r), X(m(s2.u1)), sg * Y(R), 'main');
      }
    }
  }
  special(S, geo, s, 'section');
  for (const h of geo.crossholes) if (h.angle !== 'вертикально') {
    const e = Y(h.d / 2) + 3, cx = X(h.x);
    S.line(cx - e, 0, cx + e, 0, 'thin', 'dashdot'); S.line(cx, -e, cx, e, 'thin', 'dashdot');
  } else S.line(X(h.x), -Y(h.r) - 3, X(h.x), Y(h.r) + 3, 'thin', 'dashdot');
  for (const h of geo.faceholes) for (const sg of h.n >= 2 ? [1, -1] : [1]) {
    const yc = sg * Y(h.pcd / 2);
    S.line(X(h.xf) - h.dir * 3, yc, X(h.xf + h.dir * h.depth) + h.dir * 3, yc, 'thin', 'dashdot');
    if (h.th) {
      const x1 = X(h.xf), x2 = X(h.xf + h.dir * Math.min(h.depth, h.depth * 0.8));
      S.line(x1, yc + Y(h.th.d / 2), x2, yc + Y(h.th.d / 2), 'thin'); S.line(x1, yc - Y(h.th.d / 2), x2, yc - Y(h.th.d / 2), 'thin');
    }
  }

  const D = new Drawing();
  if (mode === 'разрез') D.add(S);
  else if (mode === 'полуразрез') { D.p.push(...clipHalf(V.p, true), ...clipHalf(S.p, false)); }
  else D.add(V);
  // ось
  D.line(-5, 0, X(Lt) + 5, 0, 'thin', 'dashdot');

  // подсветка выбранного элемента
  if (opts.highlight) {
    const o = geo.outer.find(q => q.seg.id === opts.highlight);
    if (o) D.p.push({ t: 'F', pts: [[X(o.x0), -Y(o.info.r0)], [X(o.x1), -Y(o.info.r1)], [X(o.x1), Y(o.info.r1)], [X(o.x0), Y(o.info.r0)]], layer: 'hl' });
    for (const inn of [geo.inner.L, geo.inner.R]) {
      const q = inn.segs.find(z => z.seg.id === opts.highlight);
      if (q) {
        const a = X(inn.map(q.u0)), b = X(inn.map(q.u1)), r = Y(Math.max(q.info.r0, q.info.r1));
        D.p.push({ t: 'F', pts: [[a, -r], [b, -r], [b, r], [a, r]], layer: 'hl' });
      }
    }
  }
  return D;
}

function special(d, geo, s, mode) {
  const X = x => x * s, Y = y => y * s;
  for (const o of geo.outer) {
    const { seg, info, x0, x1 } = o;
    const pl = (r, st = 'dashdot', w = 'thin', ext = 2) => {
      d.line(X(x0) - ext, Y(r), X(x1) + ext, Y(r), w, st); d.line(X(x0) - ext, -Y(r), X(x1) + ext, -Y(r), w, st);
    };
    switch (seg.type) {
      case 'thread': {
        const a = x0 + info.thr[0], b = x0 + info.thr[1];
        d.line(X(a), Y(info.minor), X(b), Y(info.minor), 'thin'); d.line(X(a), -Y(info.minor), X(b), -Y(info.minor), 'thin');
        const xe = seg.from === 'справа' ? a : b;
        d.line(X(xe), -Y(info.r0), X(xe), Y(info.r0), 'main');
        break;
      }
      case 'spline': if (mode === 'view') pl(info.root, 'solid', 'thin', 0); break;
      case 'worm': pl(info.pitch); if (mode === 'view') pl(info.root, 'solid', 'thin', 0); break;
      case 'spur': case 'coupling': case 'couplingBlind': case 'wormwheel': case 'sprocket': case 'tpulley': pl(info.pitch); break;
      case 'bevel': {
        const { big, de, k } = info.bevel;
        const xb = big ? x0 : x1, xs = big ? x1 : x0;
        const ext = (xs - xb) * 0.15;
        for (const sg of [1, -1]) d.line(X(xb - ext), sg * Y(de / 2 * (1 + 0.15 * (1 - k))), X(xs + ext), sg * Y(de / 2 * (k - 0.15 * (1 - k))), 'thin', 'dashdot');
        break;
      }
      case 'vpulley': {
        const { dp } = info.vp; pl(dp / 2, 'dashdot', 'thin', 0); break;
      }
      case 'hex':
        if (mode === 'view') {
          if (seg.orient === 'ребро') d.line(X(x0), 0.01, X(x1), 0.01, 'main');
          else { d.line(X(x0), Y(info.Rc / 2), X(x1), Y(info.Rc / 2), 'main'); d.line(X(x0), -Y(info.Rc / 2), X(x1), -Y(info.Rc / 2), 'main'); }
        }
        break;
      case 'square':
        if (mode === 'view') {
          const h = Y(info.S / 2);
          d.line(X(x0), h, X(x1), -h, 'thin'); d.line(X(x0), -h, X(x1), h, 'thin');
        }
        break;
      default: break;
    }
  }
  for (const inn of [geo.inner.L, geo.inner.R]) {
    const m = inn.map;
    for (const q of inn.segs) {
      if (q.seg.type === 'ithread') {
        const st = mode === 'view' ? 'dash' : 'solid';
        const R = Y(q.info.major);
        d.line(X(m(q.u0)), R, X(m(q.u1)), R, 'thin', st); d.line(X(m(q.u0)), -R, X(m(q.u1)), -R, 'thin', st);
        d.line(X(m(q.u1)), -R, X(m(q.u1)), R, mode === 'view' ? 'thin' : 'main', st);
      }
      if (q.seg.type === 'igear') {
        const P = Y(q.info.pitch);
        d.line(X(m(q.u0)), P, X(m(q.u1)), P, 'thin', 'dashdot'); d.line(X(m(q.u0)), -P, X(m(q.u1)), -P, 'thin', 'dashdot');
      }
    }
  }
}

// ---------- Размеры главного вида ----------
class Rows {
  constructor(base, step, sign) { this.base = base; this.step = step; this.sign = sign; this.rows = []; }
  place(x0, x1) {
    for (let i = 0; ; i++) {
      const row = this.rows[i] || (this.rows[i] = []);
      if (row.every(([a, b]) => x1 + 2 < a || x0 - 2 > b)) { row.push([x0, x1]); return this.base + this.sign * this.step * i; }
    }
  }
  get extent() { return this.base + this.sign * this.step * Math.max(0, this.rows.length - 1); }
}

function dimExtent(xa, xb, lab) {
  const W = labelWidth(lab), len = xb - xa;
  if (len >= W + 2 * DIM.arrowL + 1) return [xa, xb];
  return [xa - DIM.arrowL - 3, xb + DIM.arrowL + 3 + W + 2];
}

function mainDims(d, project, geo, s, mode) {
  const X = x => x * s, Y = y => y * s;
  const meta = project.meta;
  const Rp = Y(geo.Rmax);
  const rEdge = x => Math.max(rAt(geo.vis, x - 1e-4, -1), rAt(geo.vis, x + 1e-4, 1), 0);
  const bottom = new Rows(-Rp - 10, 8, -1);
  const topR = new Rows(Rp + 10, 8, 1);
  const pendingTop = [], pendingBot = [];
  // выноска, полка которой встанет в свободный ряд сверху/снизу
  const lead = (px, py, text, dir = 1, where = 'top') => (where === 'top' ? pendingTop : pendingBot).push({ px, py, text, dir });

  // --- Длины ступеней (снизу) ---
  const segs = geo.outer;
  const n = segs.length;
  if (n) {
    const bounds = segs.map(o => o.x1);
    if (meta.dims === 'от базы') {
      const list = [];
      segs.forEach((o, i) => { if (!o.seg.noLen && i < n - 1) list.push(o.x1); });
      list.push(geo.Lt);
      list.sort((a, b) => a - b);
      for (const xb of list) {
        const lab = lenLabel(xb);
        const lev = bottom.place(...dimExtent(0, X(xb), lab));
        dimAligned(d, [0, -Y(rEdge(0))], [X(xb), -Y(rEdge(xb))], lev, lab);
      }
    } else {
      let skip = -1;
      if (n > 1 && meta.closing === 'последняя') skip = n - 1;
      if (n > 1 && meta.closing === 'первая') skip = 0;
      const rowY = -Rp - 10;
      segs.forEach((o, i) => {
        if (i === skip || o.seg.noLen || n === 1) return;
        const lab = lenLabel(o.info.L);
        dimAligned(d, [X(o.x0), -Y(rEdge(o.x0))], [X(o.x1), -Y(rEdge(o.x1))], rowY, lab, { textSide: i === n - 1 ? 1 : (i === 0 ? -1 : 1) });
      });
      bottom.rows[0] = [[-1e9, 1e9]];
      void bounds;
      const lab = lenLabel(geo.Lt);
      const lev = bottom.place(0, X(geo.Lt));
      dimAligned(d, [0, -Y(rEdge(0))], [X(geo.Lt), -Y(rEdge(geo.Lt))], lev, lab);
    }
  }

  // --- Диаметры ---
  const usedX = [];
  const avoid = [];
  for (const k of geo.keyways) if (k.angle === 'к зрителю' || k.angle === 'от зрителя') avoid.push([X(k.x1) - 2, X(k.x2) + 2]);
  for (const h of geo.crossholes) avoid.push([X(h.x - h.d / 2) - 3, X(h.x + h.d / 2) + 3]);
  const pickX = (xa, xb, pref) => {
    let x = pref;
    const bad = xx => avoid.some(([a, b]) => xx > a && xx < b) || usedX.some(u => Math.abs(u - xx) < 5);
    if (!bad(x)) return x;
    const cands = [];
    for (let t = 0.1; t <= 0.9; t += 0.1) cands.push(xa + (xb - xa) * t);
    cands.sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref));
    for (const c of cands) if (!bad(c)) return c;
    return pref;
  };
  for (const o of segs) {
    const { info, x0, x1, seg } = o;
    for (const dd of info.dia) {
      const xp = pickX(X(x0), X(x1), X(x0 + info.L * (dd.at ?? 0.5)));
      const rr = dd.v !== undefined ? dd.v / 2 : info.r0;
      if (dd.leader) {
        const yy = Y(rAt(o.pts, x0 + info.L * (dd.at ?? 0.5)));
        lead(xp, yy, dd.label, 1);
        continue;
      }
      usedX.push(xp);
      const lab = dd.label ? { main: dd.label } : diaLabel(dd.v, dd.fit);
      if (dd.label && seg.type === 'square') Object.assign(lab, diaLabel(dd.v, seg.fit, '□'));
      if (dd.label && seg.type === 'thread') lab.main = dd.label;
      dimDiameter(d, xp, -Y(rr), Y(rr), lab);
    }
    if (seg.type === 'cone' && seg.showK) {
      const dD = Math.abs(num(seg.D) - num(seg.D2));
      if (dD > 1e-6) {
        const K = info.L / dD;
        const xm = (x0 + x1) / 2, ym = rAt(o.pts, xm);
        lead(X(xm), Y(ym), (num(seg.D) > num(seg.D2) ? '▷' : '◁') + '1:' + fmt(Math.round(K * 100) / 100), 1);
      }
    }
    if (info.note) {
      const yy = Y(info.r0);
      lead(X(x0 + info.L * 0.5), yy, info.note, 1);
    }
  }
  // Внутренние диаметры
  for (const inn of [geo.inner.L, geo.inner.R]) {
    for (const q of inn.segs) {
      const um = (q.u0 + q.u1) / 2;
      let xp = X(inn.map(um));
      if (q.seg.type === 'center') {
        const xf = X(inn.map(0)), r = Y(q.info.center.D / 2);
        lead(xf, r * 0.6, q.info.label, inn.side === 'L' ? -1 : 1);
        continue;
      }
      for (const dd of q.info.dia) {
        if (dd.leader) {
          lead(xp, Y(q.info.r0), dd.label, inn.side === 'L' ? 1 : -1);
          continue;
        }
        if (dd.at !== undefined) xp = X(inn.map(q.u0 + (q.u1 - q.u0) * dd.at));
        if (usedX.some(u => Math.abs(u - xp) < 5)) xp += 5;
        usedX.push(xp);
        const v = dd.v, rr = dd.r ?? v / 2;
        const lab = dd.label ? { main: dd.label } : diaLabel(v, dd.fit);
        if (Y(rr) * 2 < labelWidth(lab) + 8 && mode !== 'вид') {
          dimDiameter(d, xp, -Y(rr), Y(rr), lab);
        } else dimDiameter(d, xp, -Y(rr), Y(rr), lab);
      }
    }
  }

  // --- Верхние размеры (внутренние ступени, пазы, отверстия) ---
  const tops = [];
  for (const inn of [geo.inner.L, geo.inner.R]) {
    const face = inn.map(0);
    for (const q of inn.segs) {
      if (q.seg.noLen || q.seg.type === 'center') continue;
      const xe = inn.map(q.u1);
      const r = Math.max(q.info.r1, q.info.r0);
      tops.push({ a: [X(Math.min(face, xe)), Y(face < xe ? rEdge(face) : r)], b: [X(Math.max(face, xe)), Y(face < xe ? r : rEdge(face))], v: q.u1 });
    }
  }
  for (const k of geo.keyways) {
    const yk = (k.angle === 'к зрителю' || k.angle === 'от зрителя') ? Y(k.b / 2) : Y(k.r);
    if (k.kind !== 'сегментная') tops.push({ a: [X(k.x1), yk], b: [X(k.x2), yk], v: k.len });
    if (k.x1 - k.segX0 > 0.05) tops.push({ a: [X(k.segX0), Y(rEdge(k.segX0))], b: [X(k.x1), yk], v: k.x1 - k.segX0 });
    if (k.kind === 'сегментная') {
      const yy = Y(k.r);
      lead(X((k.x1 + k.x2) / 2), yy, `Шпонка сегм. ${fmt(k.b)}×${fmt(k.dseg)}`, 1);
    }
  }
  for (const g of geo.grooves) {
    const yg = Y(g.rOuter);
    tops.push({ a: [X(g.xa), yg], b: [X(g.xb), yg], v: g.b });
    if (g.f.at === 'по координате') tops.push({ a: [X(g.seg && geo.outer.find(o => o.seg === g.seg).x0), Y(rEdge(geo.outer.find(o => o.seg === g.seg).x0))], b: [X(g.xa), yg], v: g.xa - geo.outer.find(o => o.seg === g.seg).x0 });
    const std = g.f.kind === 'выход резьбы' ? 'Канавка ' : g.f.kind === 'шлифовальная' ? 'Канавка ' : '';
    void std;
    lead(X((g.xa + g.xb) / 2), -Y(g.dg / 2), '⌀' + fmt(g.dg), 1, 'bot');
  }
  for (const h of geo.crossholes) {
    if (h.x - h.segX0 > 0.05) tops.push({ a: [X(h.segX0), Y(rEdge(h.segX0))], b: [X(h.x), Y(h.angle === 'вертикально' ? h.r : 0) + (h.angle === 'вертикально' ? 0 : Y(h.d / 2))], v: h.x - h.segX0 });
    const txt = (h.th ? h.f.thr + '-7H' : '⌀' + fmt(h.d)) + (h.through ? ' сквозн.' : ` на глуб. ${fmt(h.depth)}`);
    const py = h.angle === 'вертикально' ? Y(h.r) : Y(h.d / 2) * 0.7;
    const px = X(h.x) + (h.angle === 'вертикально' ? Y(h.d / 2) : Y(h.d / 2) * 0.7);
    lead(px, -py, txt, 1, 'bot');
  }
  for (const h of geo.ringholes) {
    if (h.x - h.segX0 > 0.05) tops.push({ a: [X(h.segX0), Y(rEdge(h.segX0))], b: [X(h.x), Y(h.r)], v: h.x - h.segX0 });
    lead(X(h.x) + Y(h.d / 2), -Y(h.r) * 0.3, `${h.n} отв. ⌀${fmt(h.d)}` + (h.depth > 0 ? ` глуб. ${fmt(h.depth)}` : ''), 1, 'bot');
  }
  for (const g of geo.facegrooves) {
    lead(X(g.xf + g.dir * g.depth / 2), Y((g.rIn + g.rOut) / 2), `Кольц. канавка ⌀${fmt(g.rIn * 2)}/⌀${fmt(g.rOut * 2)}, глуб. ${fmt(g.depth)}`, g.dir);
  }
  for (const h of geo.faceholes) {
    tops.push({ a: [X(h.xf), Y(h.pcd / 2 + h.d / 2)], b: [X(h.xf + h.dir * h.depth), Y(h.pcd / 2 + h.d / 2)], v: h.depth });
  }
  for (const t of tops) {
    const lab = lenLabel(t.v);
    const [xa, xb] = [Math.min(t.a[0], t.b[0]), Math.max(t.a[0], t.b[0])];
    if (xb - xa < 0.01) continue;
    const lev = topR.place(...dimExtent(xa, xb, lab));
    dimAligned(d, t.a, t.b, lev, lab);
  }

  // --- Фаски и галтели ---
  for (const c of geo.chamfers) {
    const px = X(c.x - c.side * c.c / 2), py = Y(c.r - c.cr / 2);
    const txt = fmt(c.c) + '×' + c.a + '°';
    lead(px, py, txt, c.side);
  }
  for (const f of geo.fillets) {
    lead(X(f.x), Y(f.y), 'R' + fmt(f.R), f.side);
  }

  // --- Выноски в свободные ряды ---
  for (const [list, rows, sg] of [[pendingTop, topR, 1], [pendingBot, bottom, -1]]) {
    list.sort((a, b) => a.px - b.px);
    for (const L of list) {
      const W = textWidth(L.text, DIM.txt) + 1;
      const knee = L.px + L.dir * 4;
      const x0 = L.dir > 0 ? Math.min(L.px, knee) : knee - W, x1 = L.dir > 0 ? knee + W : Math.max(L.px, knee);
      let y = rows.place(x0, x1);
      if (sg > 0 && y < L.py + 5) y = L.py + 5;
      if (sg < 0 && y > L.py - 5) y = L.py - 5;
      leader(d, L.px, L.py, L.text, { dx: knee - L.px, dy: y - L.py });
    }
  }

  // --- Шероховатость ---
  for (const o of segs) {
    if (!o.seg.ra) continue;
    const xm = o.x0 + o.info.L * 0.72;
    const yy = Y(rAt(o.pts, xm));
    roughness(d, X(xm), yy, o.seg.ra);
  }
  for (const inn of [geo.inner.L, geo.inner.R]) for (const q of inn.segs) {
    if (!q.seg.ra) continue;
    const xm = inn.map(q.u0 + (q.u1 - q.u0) * 0.5);
    roughness(d, X(xm), -Y(q.info.r0), q.seg.ra, { rot: 180 });
  }
  return { topY: Math.max(topR.extent, Rp) + 6, botY: Math.min(bottom.extent, -Rp) - 6 };
}

// ---------- Поперечные сечения ----------
function polyN(n, R, a0) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (a0 + i * 360 / n) * Math.PI / 180; pts.push([R * Math.cos(a), R * Math.sin(a)]); }
  return pts;
}
function splinePoly(sp, internal) {
  const { z, d, D, b, kind, m } = sp;
  const rd = d / 2, rD = D / 2;
  const pts = [];
  const half = kind === 'эвольвентные' ? null : b / 2;
  for (let k = 0; k < z; k++) {
    const th = 90 + k * 360 / z;
    const phiD = half !== null ? Math.asin(Math.min(half / rD, 1)) * 180 / Math.PI : (90 / z) * 0.7;
    const phid = half !== null ? Math.asin(Math.min(half / rd, 1)) * 180 / Math.PI : (90 / z) * 1.1;
    void m;
    const P = (r, a) => [r * Math.cos(a * Math.PI / 180), r * Math.sin(a * Math.PI / 180)];
    // зуб вала: по впадинам d, по вершинам D (для отверстия — наоборот рисуется так же)
    pts.push(P(rd, th - phid), P(rD, th - phiD));
    for (let i = 0; i <= 4; i++) pts.push(P(rD, th - phiD + (2 * phiD) * i / 4));
    pts.push(P(rd, th + phid));
    const next = th + 360 / z;
    for (let i = 1; i < 6; i++) pts.push(P(rd, th + phid + (next - phid - th - phid) * i / 6));
  }
  void internal;
  return pts;
}
function rotPts(pts, ang) {
  const a = ang * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}
const ANG = { 'сверху': 90, 'снизу': 270, 'к зрителю': 0, 'от зрителя': 180 };

export function crossSection(geo, x) {
  const o = geo.outer.find(q => x >= q.x0 - 1e-6 && x <= q.x1 + 1e-6) || geo.outer[0];
  if (!o) return null;
  const { seg, info } = o;
  let outer;
  const r = rAt(o.pts, x);
  if (seg.type === 'hex') outer = polyN(6, info.Rc, seg.orient === 'ребро' ? 0 : 90);
  else if (seg.type === 'square') outer = polyN(4, info.S / Math.SQRT2, 45);
  else if (seg.type === 'spline') outer = splinePoly(info.spline);
  else outer = circlePoly(0, 0, r, 96);
  const cuts = [];
  const dims = [];
  for (const inn of [geo.inner.L, geo.inner.R]) {
    const u = inn.side === 'L' ? x : geo.Lt - x;
    if (u < 0 || u > inn.depth) continue;
    const q = inn.segs.find(z => u >= z.u0 - 1e-6 && u <= z.u1 + 1e-6);
    let ri;
    if (u > inn.cylDepth && inn.tipU !== null) {
      const last = inn.pts[inn.pts.length - 1];
      ri = last.r * (inn.tipU - u) / (inn.tipU - inn.cylDepth);
    } else ri = rAt(inn.pts, u);
    if (ri <= 0.01) continue;
    if (q && q.seg.type === 'hex') cuts.push(polyN(6, q.info.S / Math.sqrt(3), 90));
    else if (q && q.seg.type === 'square') cuts.push(polyN(4, q.info.r0 * Math.SQRT2, 45));
    else if (q && q.seg.type === 'ispline') cuts.push(splinePoly(q.info.spline, true));
    else cuts.push(circlePoly(0, 0, ri, 64));
    for (const k of inn.keyways) {
      const a = Math.min(inn.map(k.u0), inn.map(k.u1)), b = Math.max(inn.map(k.u0), inn.map(k.u1));
      if (x < a || x > b) continue;
      const sg = k.angle === 'снизу' ? -1 : 1;
      cuts.push(rectPoly(-k.b / 2, sg * (ri - 0.3), k.b / 2, sg * (k.r + k.t)));
      dims.push({ type: 'ikey', k, sg, ri });
    }
  }
  for (const k of geo.keyways) {
    if (x < k.x1 - 1e-6 || x > k.x2 + 1e-6) continue;
    let t = k.t;
    if (k.kind === 'сегментная') {
      const Rk = k.dseg / 2, xm = (k.x1 + k.x2) / 2, cy = k.r - k.t + Rk;
      const yb = cy - Math.sqrt(Math.max(Rk * Rk - (x - xm) ** 2, 0));
      t = k.r - yb;
    }
    const base = rectPoly(-k.b / 2, k.r - t, k.b / 2, k.r + 5).map(([a, b]) => [b, a]).map(([a, b]) => [a, -b]);
    // base построен вдоль +x (к зрителю), повернём на угол
    const ang = ANG[k.angle] ?? 0;
    cuts.push(rotPts(rectPoly(k.r - t, -k.b / 2, k.r + 5, k.b / 2), ang));
    void base;
    dims.push({ type: 'key', k, ang, t });
  }
  for (const h of geo.crossholes) {
    const dx = x - h.x;
    if (Math.abs(dx) >= h.d / 2) continue;
    const w = Math.sqrt((h.d / 2) ** 2 - dx * dx);
    const ang = h.angle === 'вертикально' ? 90 : 0;
    const R = geo.Rmax + 5;
    const inner = h.through ? -R : h.r - h.depth;
    cuts.push(rotPts(rectPoly(inner, -w, R, w), ang));
  }
  for (const h of geo.ringholes) {
    const dx = x - h.x;
    if (Math.abs(dx) >= h.d / 2) continue;
    const w = Math.sqrt((h.d / 2) ** 2 - dx * dx);
    for (let i = 0; i < h.n; i++) {
      const a = h.a0 + i * 360 / h.n;
      cuts.push(rotPts(rectPoly(h.depth > 0 ? h.r - h.depth : 0, -w, h.r + 5, w), a));
    }
  }
  for (const h of geo.faceholes) {
    const a = Math.min(h.xf, h.xf + h.dir * h.depth), b = Math.max(h.xf, h.xf + h.dir * h.depth);
    if (x < a || x > b) continue;
    for (let i = 0; i < h.n; i++) {
      const an = (h.a0 + i * 360 / h.n) * Math.PI / 180;
      cuts.push(circlePoly(h.pcd / 2 * Math.cos(an), h.pcd / 2 * Math.sin(an), h.d / 2, 24));
    }
  }
  const clipsGeom = cuts;
  let mp = safeDiff(outer, clipsGeom);
  for (const g of geo.facegrooves) {
    const a = Math.min(g.xf, g.xf + g.dir * g.depth), b = Math.max(g.xf, g.xf + g.dir * g.depth);
    if (x < a || x > b) continue;
    try { mp = pc.difference(mp, [circlePoly(0, 0, g.rOut, 64), circlePoly(0, 0, g.rIn, 64).reverse()]); } catch (e) { /* */ }
  }
  return { mp, r, seg, info, dims, o };
}

function sectionBlock(geo, x, label, s) {
  const cs = crossSection(geo, x);
  if (!cs) return null;
  const d = new Drawing();
  const mp = scaleMP(cs.mp, s);
  hatch(d, mp, Math.max(1.2, Math.min(3, cs.r * s / 6)), 45);
  outlineMP(d, mp, 'main');
  const R = Math.max(cs.r, cs.info.Rc || 0, cs.info.S ? cs.info.S / Math.SQRT2 : 0) * s;
  d.line(-R - 3, 0, R + 3, 0, 'thin', 'dashdot'); d.line(0, -R - 3, 0, R + 3, 'thin', 'dashdot');
  // размеры
  for (const dm of cs.dims) {
    if (dm.type === 'key') {
      const k = dm.k, rp = k.r * s, t = dm.t * s, b2 = k.b / 2 * s;
      const fitLab = { main: fmt(k.b) + (k.fitb || '') };
      const dv = deviations(k.fitb, k.b);
      if (dv) { fitLab.up = fmtDev(dv.es); fitLab.lo = fmtDev(dv.ei); fitLab.paren = true; }
      const rest = { main: fmt(Math.round((2 * k.r - dm.t) * 100) / 100), up: '', lo: '−0,2' };
      const ang = dm.ang;
      if (ang === 90 || ang === 270) {
        const sg = ang === 90 ? 1 : -1;
        const yT = sg * Math.sqrt(Math.max(rp * rp - b2 * b2, 0));
        dimAligned(d, [-b2, yT], [b2, yT], sg * (rp + 7), fitLab);
        dimAligned(d, [b2, sg * (rp - t)], [0, -sg * rp], rp + 8, rest, { vertical: true });
      } else {
        const sg = ang === 0 ? 1 : -1;
        const xT = sg * Math.sqrt(Math.max(rp * rp - b2 * b2, 0));
        dimAligned(d, [xT, -b2], [xT, b2], sg * (rp + 7), fitLab, { vertical: true });
        dimAligned(d, [sg * (rp - t), -b2], [-sg * rp, 0], -(rp + 8), rest);
      }
    } else if (dm.type === 'ikey') {
      const k = dm.k, b2 = k.b / 2 * s, sg = dm.sg;
      const lab = { main: fmt(k.b) + (k.fitb || '') };
      const dv = deviations(k.fitb, k.b);
      if (dv) { lab.up = fmtDev(dv.es); lab.lo = fmtDev(dv.ei); lab.paren = true; }
      dimAligned(d, [-b2, sg * (k.r + k.t) * s], [b2, sg * (k.r + k.t) * s], sg * (R + 7), lab);
      const tl = { main: fmt(Math.round((2 * k.r + k.t) * 100) / 100), up: '+0,2', lo: '' };
      dimAligned(d, [b2, sg * (k.r + k.t) * s], [0, -sg * k.r * s], R + 8, tl, { vertical: true });
    }
  }
  if (cs.seg.type === 'hex') {
    const S2 = cs.info.S / 2 * s, Rc = cs.info.Rc * s;
    if (cs.seg.orient === 'ребро') dimAligned(d, [-Rc / 2, S2], [-Rc / 2, -S2], -(R + 7), { main: fmt(cs.info.S) }, { vertical: true });
    else dimAligned(d, [-S2, Rc / 2], [S2, Rc / 2], R + 7, { main: fmt(cs.info.S) });
  } else if (cs.seg.type === 'square') {
    const S2 = cs.info.S / 2 * s;
    dimAligned(d, [-S2, S2], [S2, S2], S2 + 7, { main: fmt(cs.info.S) });
  }
  const bb = d.bbox();
  d.text(0, bb.y1 + 3, 5, `${label}–${label}`, { anchor: 'c' });
  return d;
}

// Вид с торца (для отверстий по окружности)
function endViewBlock(geo, side, s, letter) {
  const d = new Drawing();
  const list = side === 'L' ? geo.outer : geo.outer.slice().reverse();
  let mx = 0;
  const circles = [];
  const fh0 = geo.faceholes.concat(geo.facegrooves).filter(h => (side === 'L' ? h.dir > 0 : h.dir < 0));
  const lim = Math.max(...fh0.map(h => (h.pcd ? h.pcd / 2 + h.d : h.rOut + 2)), 0);
  for (const o of list) {
    const r = Math.max(o.info.r0, o.info.r1);
    if (r > mx + 1e-6) { circles.push(r); mx = r; }
    if (mx >= lim) break;
  }
  for (const r of circles) d.circle(0, 0, r * s, 'main');
  const inn = side === 'L' ? geo.inner.L : geo.inner.R;
  if (inn.pts.length) d.circle(0, 0, inn.pts[0].r * s, 'main');
  const fh = geo.faceholes.filter(h => (side === 'L' ? h.dir > 0 : h.dir < 0));
  for (const h of fh) {
    d.circle(0, 0, h.pcd / 2 * s, 'thin', 'dashdot');
    for (let i = 0; i < h.n; i++) {
      const an = (h.a0 + i * 360 / h.n) * Math.PI / 180;
      const cx = h.pcd / 2 * Math.cos(an) * s * (side === 'L' ? -1 : 1), cy = h.pcd / 2 * Math.sin(an) * s;
      d.circle(cx, cy, h.d / 2 * s, 'main');
      if (h.th) d.arc(cx, cy, h.th.d / 2 * s, 0, 270, 'thin');
      const e = h.d / 2 * s + 2;
      d.line(cx - e, cy, cx + e, cy, 'thin', 'dashdot'); d.line(cx, cy - e, cx, cy + e, 'thin', 'dashdot');
    }
    const an = h.a0 * Math.PI / 180;
    const cx = h.pcd / 2 * Math.cos(an) * s * (side === 'L' ? -1 : 1), cy = h.pcd / 2 * Math.sin(an) * s;
    const txt = `${h.n} отв. ` + (h.th ? h.f.thr + '-7H' : '⌀' + fmt(h.d));
    leader(d, cx + h.d / 2 * s * 0.7, cy + h.d / 2 * s * 0.7, txt, { dx: 6, dy: mx * s - cy + 6 });
    dimAligned(d, [-h.pcd / 2 * s, 0], [h.pcd / 2 * s, 0], -(mx * s + 8), { main: '⌀' + fmt(h.pcd) });
  }
  for (const g of geo.facegrooves.filter(q => (side === 'L' ? q.dir > 0 : q.dir < 0))) {
    d.circle(0, 0, g.rIn * s, 'main'); d.circle(0, 0, g.rOut * s, 'main');
  }
  const R = mx * s + 3;
  d.line(-R, 0, R, 0, 'thin', 'dashdot'); d.line(0, -R, 0, R, 'thin', 'dashdot');
  const bb = d.bbox();
  d.text(0, bb.y1 + 3, 5, letter, { anchor: 'c' });
  return d;
}

export function sectionList(project, geo) {
  const list = [];
  const add = (x, auto) => { if (x >= 0 && x <= geo.Lt && !list.some(q => Math.abs(q.x - x) < 2)) list.push({ x, auto }); };
  for (const q of project.sections || []) add(num(q.x), false);
  if (project.meta.autoSections !== false) {
    for (const k of geo.keyways) add((k.x1 + k.x2) / 2, true);
    for (const o of geo.outer) if (['hex', 'square', 'spline'].includes(o.seg.type)) add((o.x0 + o.x1) / 2, true);
    for (const h of geo.crossholes) add(h.x, true);
    for (const h of geo.ringholes) add(h.x, true);
    for (const inn of [geo.inner.L, geo.inner.R]) for (const k of inn.keyways) add(inn.map((k.u0 + k.u1) / 2), true);
  }
  list.sort((a, b) => a.x - b.x);
  return list;
}

// ---------- Лист целиком ----------
export function buildSheet(project, opts = {}) {
  const geo = opts.geo || computeModel(project);
  const region = regionModel(geo);
  const meta = project.meta;
  const mode = meta.view || 'вид';
  const secs = sectionList(project, geo);
  const hasEndL = geo.faceholes.some(h => h.dir > 0) || geo.facegrooves.some(g => g.dir > 0);
  const hasEndR = geo.faceholes.some(h => h.dir < 0) || geo.facegrooves.some(g => g.dir < 0);
  const tables = [];
  for (const o of geo.outer) if (o.info.table) tables.push(o.info.table);
  for (const inn of [geo.inner.L, geo.inner.R]) for (const q of inn.segs) if (q.info.table) tables.push(q.info.table);
  const mass = massKg(geo, region);

  const compose = (s) => {
    // основной вид + размеры
    const mv = mainView(project, geo, s, mode, region, opts);
    const ext = mainDims(mv, project, geo, s, mode);
    // метки сечений
    const blocks = [];
    let li = 0;
    const letters = [];
    for (const sc of secs) {
      const L = LETTERS[li++ % LETTERS.length]; letters.push(L);
      const xp = sc.x * s, rp = geo.rAt(sc.x) * s;
      for (const sg of [1, -1]) {
        mv.line(xp, sg * (rp + 2), xp, sg * (rp + 10), 'thick');
        mv.line(xp, sg * (rp + 8), xp + 6, sg * (rp + 8), 'thin', 'solid', 'dim');
        arrow(mv, xp + 6, sg * (rp + 8), 1, 0);
      }
      mv.text(xp + 3, rp + 9, 5, L, { anchor: 'c' });
      const b = sectionBlock(geo, sc.x, L, s);
      if (b) blocks.push(b);
    }
    for (const side of ['L', 'R']) {
      if (side === 'L' ? !hasEndL : !hasEndR) continue;
      const L = LETTERS[li++ % LETTERS.length];
      const xf = side === 'L' ? -8 : geo.Lt * s + 8, dir = side === 'L' ? 1 : -1;
      const yy = geo.Rmax * s * 0.45 + 4;
      mv.line(xf - dir * 10, yy, xf, yy, 'thin', 'solid', 'dim'); arrow(mv, xf, yy, dir, 0);
      mv.text(xf - dir * 5, yy + 1.5, 5, L, { anchor: 'c' });
      blocks.push(endViewBlock(geo, side, s, L));
    }
    return { mv, ext, blocks, letters };
  };

  const buildAt = (fmtName, s, finalize) => {
    const [W, H] = FORMATS[fmtName];
    const c = compose(s);
    const mb = c.mv.bbox();
    const frame = { x0: 20, y0: 5, x1: W - 5, y1: H - 5 };
    const ttLines = ttLayout(meta.tt || [], 185);
    const ttH = ttLines.length ? ttLines.length * 6 + 6 : 0;
    const tabH = tables.reduce((a, t) => a + t.rows.length * 7 + (t.title ? 8 : 0) + 6, 0);
    const topRes = Math.max(16, tabH) + 2;
    const areaTop = frame.y1 - (tabH > 0 ? 16 : 16);
    const areaBot = frame.y0 + 55 + ttH + 4;
    const areaL = frame.x0 + 4, areaR = frame.x1 - 4 - (tabH > 0 ? 0 : 0);
    // главный вид сверху по центру
    const mw = mb.x1 - mb.x0, mh = mb.y1 - mb.y0;
    let ok = mw <= areaR - areaL - (tabH > 0 && mh > areaTop - areaBot - tabH ? 112 : 0);
    let ox = areaL + (areaR - areaL - mw) / 2 - mb.x0;
    let oy = areaTop - mb.y1;
    if (tabH > 0) {
      // таблица справа сверху: сдвигаем вид влево или вниз
      const tabL = frame.x1 - 110;
      if (ox + mb.x1 > tabL - 4) {
        const wantX = tabL - 4 - mb.x1;
        if (wantX + mb.x0 >= areaL) ox = wantX; else oy = frame.y1 - topRes - 4 - mb.y1;
      }
    }
    if (oy + mb.y0 < areaBot) ok = false;
    // сечения в ряд под видом
    let cx = areaL, rowTop = oy + mb.y0 - 6, rowH = 0;
    const placed = [];
    for (const b of c.blocks) {
      const bb = b.bbox();
      const bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
      if (cx + bw > areaR) { cx = areaL; rowTop -= rowH + 6; rowH = 0; }
      const bx = cx - bb.x0, by = rowTop - bb.y1;
      const bottomY = rowTop - bh;
      const limitR = bottomY < areaBot ? frame.x1 - 185 - 4 : areaR;
      if (cx + bw > limitR || bottomY < frame.y0 + 3) ok = false;
      placed.push([b, bx, by]);
      cx += bw + 10; rowH = Math.max(rowH, bh);
    }
    if (!finalize) return { ok };
    const sheet = new Drawing();
    const sheetMode = meta.sheetMode !== 'деталь';
    sheet.add(c.mv, ox, oy);
    for (const [b, bx, by] of placed) sheet.add(b, bx, by);
    if (sheetMode) {
      frameAndTitle(sheet, W, H, project, s, mass);
      ttDraw(sheet, ttLines, frame.x1 - 185, frame.y0 + 55 + 6 + (ttLines.length - 1) * 6 + 4);
      let ty = frame.y1;
      for (const t of tables) ty = tableDraw(sheet, t, frame.x1 - 110, ty) - 6;
      const raX = tables.length ? frame.x1 - 110 - 34 : frame.x1 - 34;
      if (meta.raGeneral) {
        const w = roughness(sheet, raX, frame.y1 - 18, meta.raGeneral);
        sheet.text(raX + w + 1, frame.y1 - 16, 5, '(', {});
        roughness(sheet, raX + w + 4.5, frame.y1 - 16.5, '', {});
        sheet.text(raX + w + 9.5, frame.y1 - 16, 5, ')', {});
      }
    }
    return { ok, prims: sheet.p, W, H, format: fmtName, scale: s, mass, geo, sheetMode, origin: { ox, oy, s }, secs };
  };

  // выбор формата и масштаба
  const userScale = parseScale(meta.scale);
  const userFmt = FORMATS[meta.format] ? meta.format : null;
  const maxUp = geo.Lt < 40 ? 5 : geo.Lt < 80 ? 4 : geo.Lt < 150 ? 2 : 1;
  const scales = userScale ? [userScale] : SCALES.filter(x => x <= maxUp);
  const fmts = userFmt ? [userFmt] : ['A4', 'A3', 'A2', 'A1'];
  let choice = null;
  outer: for (const f of fmts) {
    for (const s of scales) {
      const r = buildAt(f, s, false);
      if (r.ok) {
        const acceptable = userFmt || userScale || s >= 1 || (f === 'A3' && s >= 0.5) || (f === 'A2' && s >= 0.25) || f === 'A1';
        if (acceptable) { choice = [f, s]; break outer; }
        break;
      }
    }
  }
  if (!choice) choice = [userFmt || 'A1', userScale || 0.1];
  const res = buildAt(choice[0], choice[1], true);
  res.warnings = geo.warnings.slice();
  if (!res.ok) res.warnings.push('Чертёж не помещается на выбранный формат — выберите масштаб/формат');
  if (!res.sheetMode) {
    const bb = bboxOf(res.prims);
    const m = 8;
    res.prims = res.prims.map(q => shift(q, -bb.x0 + m, -bb.y0 + m));
    res.origin = { ox: res.origin.ox - bb.x0 + m, oy: res.origin.oy - bb.y0 + m, s: res.origin.s };
    res.W = bb.x1 - bb.x0 + 2 * m; res.H = bb.y1 - bb.y0 + 2 * m;
  }
  return res;
}

function ttLayout(items, width) {
  const lines = [];
  const list = items.filter(t => t && t.trim());
  const h = 3.5;
  list.forEach((t, i) => {
    const prefix = list.length > 1 ? (i + 1) + '. ' : '';
    const words = (prefix + t.trim()).split(/\s+/);
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (textWidth(test, h) > width - 2 && cur) { lines.push(cur); cur = '   ' + w; } else cur = test;
    }
    if (cur) lines.push(cur);
  });
  return lines;
}
function ttDraw(d, lines, x, yTop) {
  lines.forEach((l, i) => d.text(x + 1, yTop - i * 6, 3.5, l, {}));
}
function tableDraw(d, t, x, yTop) {
  const rowH = 7, cw = [60, 15, 35];
  let y = yTop;
  if (t.title) { d.text(x + 55, y - 6, 3.5, t.title, { anchor: 'c' }); y -= 8; }
  const n = t.rows.length;
  d.poly([[x, y], [x + 110, y], [x + 110, y - n * rowH], [x, y - n * rowH]], true, 'main', 'solid', 'frame');
  d.line(x + cw[0], y, x + cw[0], y - n * rowH, 'main', 'solid', 'frame');
  d.line(x + cw[0] + cw[1], y, x + cw[0] + cw[1], y - n * rowH, 'main', 'solid', 'frame');
  t.rows.forEach((r, i) => {
    const yy = y - (i + 1) * rowH;
    if (i < n - 1) d.line(x, yy, x + 110, yy, 'thin', 'solid', 'frame');
    const fit = (str, w, h0) => { let h = h0; while (textWidth(str, h) > w - 2 && h > 1.8) h -= 0.25; return h; };
    d.text(x + 1, yy + 2.2, fit(r[0], cw[0], 3), r[0], {});
    d.text(x + cw[0] + cw[1] / 2, yy + 2.2, 3, r[1], { anchor: 'c' });
    d.text(x + cw[0] + cw[1] + cw[2] / 2, yy + 2.2, fit(r[2], cw[2], 3), r[2], { anchor: 'c' });
  });
  return y - n * rowH;
}

function frameAndTitle(d, W, H, project, s, mass) {
  const m = project.meta;
  const F = 'frame';
  d.poly([[0, 0], [W, 0], [W, H], [0, H]], true, 'thin', 'solid', F);
  d.poly([[20, 5], [W - 5, 5], [W - 5, H - 5], [20, H - 5]], true, 'main', 'solid', F);
  // основная надпись (форма 1)
  const x0 = W - 5 - 185, y0 = 5;
  const L = (a, b, c, e, w = 'main') => d.line(x0 + a, y0 + b, x0 + c, y0 + e, w, 'solid', F);
  L(0, 55, 185, 55);
  L(0, 0, 0, 55);
  // левая часть: колонки 7,10,23,15,10
  L(7, 30, 7, 55); L(17, 0, 17, 55); L(40, 0, 40, 55); L(55, 0, 55, 55);
  for (let i = 1; i < 11; i++) L(0, i * 5, 65, i * 5, i === 6 || i === 7 ? 'main' : 'thin');
  const TT = (x, y, h, t, o = {}) => d.text(x0 + x, y0 + y, h, t, { layer: 'frame', ...o });
  const fitTxt = (t, w, h0) => { let h = h0; while (textWidth(t, h) > w - 1.5 && h > 1.6) h -= 0.25; return h; };
  TT(3.5, 31.3, 2.5, 'Изм.', { anchor: 'c' }); TT(12, 31.3, 2.5, 'Лист', { anchor: 'c' }); TT(28.5, 31.3, 2.5, '№ докум.', { anchor: 'c' });
  TT(47.5, 31.3, 2.5, 'Подп.', { anchor: 'c' }); TT(60, 31.3, 2.5, 'Дата', { anchor: 'c' });
  const people = [['Разраб.', m.developer], ['Пров.', m.checker], ['Т.контр.', m.tcontrol], ['', ''], ['Н.контр.', m.ncontrol], ['Утв.', m.approved]];
  people.forEach(([a, b], i) => {
    const y = 26.3 - i * 5;
    TT(1, y, 2.5, a); TT(18, y, fitTxt(b || '', 23, 2.5), b || '');
  });
  // правая часть
  L(65, 0, 65, 55);
  L(65, 40, 185, 40);
  L(135, 0, 135, 40);
  L(65, 15, 135, 15);
  L(135, 35, 185, 35, 'thin'); L(135, 20, 185, 20); L(135, 15, 185, 15);
  L(150, 20, 150, 40); L(167, 20, 167, 40);
  L(140, 20, 140, 35, 'thin'); L(145, 20, 145, 35, 'thin');
  L(155, 15, 155, 20);
  TT(142.5, 36.3, 2.5, 'Лит.', { anchor: 'c' }); TT(158.5, 36.3, 2.5, 'Масса', { anchor: 'c' }); TT(176, 36.3, 2.5, 'Масштаб', { anchor: 'c' });
  TT(137.5, 25.5, 3.5, m.litera || '', { anchor: 'c' });
  const massTxt = m.mass || (mass > 0 ? fmt(Math.round(mass * 100) / 100) : '');
  TT(158.5, 25.5, 3.5, massTxt, { anchor: 'c' });
  TT(176, 25.5, 3.5, scaleName(s), { anchor: 'c' });
  TT(136, 16.3, 2.5, 'Лист'); TT(156, 16.3, 2.5, 'Листов 1');
  TT(160, 6, fitTxt(m.org || '', 50, 3.5), m.org || '', { anchor: 'c' });
  const des = m.designation || '';
  TT(125, 45, fitTxt(des, 120, 7), des, { anchor: 'c' });
  const nm = m.name || '';
  TT(100, 25, fitTxt(nm, 70, 7), nm, { anchor: 'c' });
  const mat = m.material || '';
  TT(100, 5.5, fitTxt(mat, 70, 3.5), mat, { anchor: 'c' });
  // графа 26 (обозначение, повёрнутое на 180°) в левом верхнем углу
  const gx = 20, gy = H - 5;
  d.poly([[gx, gy], [gx + 70, gy], [gx + 70, gy - 14], [gx, gy - 14]], true, 'main', 'solid', F);
  d.text(gx + 35, gy - 7, fitTxt(des, 70, 5), des, { anchor: 'c', va: 'm', rot: 180, layer: 'frame' });
}
