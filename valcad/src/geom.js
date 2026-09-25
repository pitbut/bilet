// Геометрия вала: профили, внутренние контуры, элементы.
// Система координат модели: x — вдоль оси (0 = левый торец), y — вверх, z — к зрителю. Все в мм.
import {
  keyFor, ringGrooveShaft, ringGrooveHole, threadUndercutOuter, threadUndercutInner, grindGroove,
  centerHole, VBELT, threadMinor,
} from './standards.js';

const EPS = 1e-6;
const rad = a => a * Math.PI / 180;
const num = (v, d = 0) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : d; };

// Полилиния: [{x, r, s}] s — гладкая вершина (без линии перехода)
function rAt(pts, x, side = 1) {
  // side = -1 — предел слева, 1 — справа
  if (x <= pts[0].x) return pts[0].r;
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].r;
  if (side > 0) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (x >= a.x - EPS && x < b.x - EPS) {
        if (b.x - a.x < EPS) continue;
        return a.r + (b.r - a.r) * (x - a.x) / (b.x - a.x);
      }
    }
  } else {
    for (let i = pts.length - 1; i > 0; i--) {
      const a = pts[i - 1], b = pts[i];
      if (x > a.x + EPS && x <= b.x + EPS) {
        if (b.x - a.x < EPS) continue;
        return a.r + (b.r - a.r) * (x - a.x) / (b.x - a.x);
      }
    }
  }
  return pts[pts.length - 1].r;
}

// Вырез (канавка) в полилинии
function notch(pts, xa, xb, rg, slL = 0, slR = 0, rr = 0) {
  if (xb - xa < EPS) return pts;
  const ra = rAt(pts, xa, 1), rb = rAt(pts, xb, -1);
  const out = pts.filter(p => p.x < xa - EPS || (Math.abs(p.x - xa) < EPS && p === pts[0] && false));
  // сохраним точки строго левее xa и точки в xa, предшествующие (вертикальная стенка)
  const left = [], right = [];
  for (const p of pts) { if (p.x < xa - EPS) left.push(p); }
  for (const p of pts) { if (p.x > xb + EPS) right.push(p); }
  // точки ровно на xa, до первой точки правее
  const onA = pts.filter(p => Math.abs(p.x - xa) < EPS);
  const onB = pts.filter(p => Math.abs(p.x - xb) < EPS);
  void out;
  const res = [...left];
  if (onA.length) res.push(onA[0]);
  else res.push({ x: xa, r: ra, s: false });
  if (rr > 0 && slL === 0) {
    res.push({ x: xa, r: rg + rr, s: false });
    arcPts(res, xa + rr, rg + rr, rr, 180, 270, true);
  } else res.push({ x: xa + slL, r: rg, s: false });
  if (rr > 0 && slR === 0) {
    arcPts(res, xb - rr, rg + rr, rr, 270, 360, true);
    res.push({ x: xb, r: rg + rr, s: false });
  } else res.push({ x: xb - slR, r: rg, s: false });
  if (onB.length) res.push(onB[onB.length - 1]);
  else res.push({ x: xb, r: rb, s: false });
  res.push(...right);
  return res;
}
function arcPts(arr, cx, cy, r, a0, a1, smooth, n = 8) {
  for (let i = 0; i <= n; i++) {
    const a = rad(a0 + (a1 - a0) * i / n);
    arr.push({ x: cx + r * Math.cos(a), r: cy + r * Math.sin(a), s: smooth && i > 0 && i < n });
  }
}

export function segLength(seg, cat) {
  if (cat === 'outer' && seg.type === 'vpulley') {
    const g = VBELT[seg.prof] || VBELT.A;
    const auto = (num(seg.n, 1) - 1) * g.e + 2 * g.f;
    return num(seg.L) > 0 ? Math.max(num(seg.L), auto) : auto;
  }
  if (cat === 'inner' && seg.type === 'center') {
    const c = centerHole(seg.d);
    return c.l;
  }
  return Math.max(num(seg.L), 0.1);
}

// Параметры наружной ступени
export function outerInfo(seg) {
  const t = seg.type;
  const L = segLength(seg, 'outer');
  const o = { L, r0: 0, r1: 0, rb0: null, rb1: null, toothed: false, dia: [], table: null, custom: null };
  switch (t) {
    case 'cyl': o.r0 = o.r1 = num(seg.D) / 2; o.dia.push({ at: 0.5, v: num(seg.D), fit: seg.fit }); break;
    case 'cone':
      o.r0 = num(seg.D) / 2; o.r1 = num(seg.D2) / 2;
      o.dia.push({ at: 0.12, v: num(seg.D), fit: '' }, { at: 0.88, v: num(seg.D2), fit: '' });
      break;
    case 'hex': {
      const S = num(seg.S); const Rc = S / Math.sqrt(3);
      o.r0 = o.r1 = seg.orient === 'ребро' ? S / 2 : Rc;
      o.Rc = Rc; o.S = S;
      o.dia.push({ at: 0.5, label: 'S' + fmt(S), leader: true });
      break;
    }
    case 'square': { const S = num(seg.S); o.r0 = o.r1 = S / 2; o.S = S; o.dia.push({ at: 0.5, v: S, label: '□' + fmt(S) }); break; }
    case 'thread': {
      const d = num(seg.D), P = num(seg.P, 1);
      o.r0 = o.r1 = d / 2; o.minor = threadMinor(d, P) / 2;
      const Lt = num(seg.Lt) > 0 ? Math.min(num(seg.Lt), L) : L;
      o.thr = seg.from === 'справа' ? [L - Lt, L] : [0, Lt];
      o.dia.push({ at: 0.5, v: d, label: threadLabel(d, P, seg.tol, seg.lh) });
      break;
    }
    case 'spline': {
      const D = num(seg.D); const z = num(seg.z, 6);
      let d = num(seg.d);
      if (seg.kind === 'эвольвентные') { const m = num(seg.m, 1); d = D - 2 * 1.1 * m; o.m = m; }
      o.r0 = o.r1 = D / 2; o.rb0 = o.rb1 = d / 2; o.root = d / 2; o.toothed = true; o.spline = { z, d, D, b: num(seg.b), kind: seg.kind, m: o.m };
      const des = seg.des || (seg.kind === 'эвольвентные' ? `${fmt(D)}×${fmt(o.m)} ГОСТ 6033-80` : `${seg.center}-${z}×${fmt(d)}×${fmt(D)}×${fmt(num(seg.b))} ГОСТ 1139-80`);
      o.dia.push({ at: 0.5, v: D, label: des, leader: true });
      break;
    }
    case 'spur': case 'coupling': case 'couplingBlind': {
      const m = num(seg.m, 1), z = num(seg.z, 10), beta = t === 'spur' ? num(seg.beta) : 0, x = t === 'spur' ? num(seg.x) : 0;
      const d = m * z / Math.cos(rad(beta));
      const ha = t === 'spur' ? 1 : 0.8;
      const da = d + 2 * m * (ha + x), df = d - 2 * m * (1.25 - x);
      o.r0 = o.r1 = da / 2; o.rb0 = o.rb1 = df / 2; o.pitch = d / 2; o.toothed = true;
      o.dia.push({ at: 0.5, v: da, fit: seg.fit || 'h11' });
      const title = t === 'spur' ? null : 'Зубчатый венец муфты';
      o.table = {
        title, rows: [
          ['Модуль', 'm', fmt(m)], ['Число зубьев', 'z', String(z)],
          ...(t === 'spur' ? [['Угол наклона зуба', 'β', fmt(beta) + '°'], ['Направление линии зуба', '—', beta > 0 ? (seg.dir === 'левое' ? 'Левое' : 'Правое') : '—']] : []),
          ['Нормальный исходный контур', '—', 'ГОСТ 13755-2015'],
          ['Коэффициент смещения', 'x', fmt(x)],
          ...(t === 'coupling' && seg.crowned ? [['Форма зуба', '—', 'Бочкообразная']] : []),
          ['Степень точности', '—', (seg.prec || '8-B') + ' ГОСТ 1643-81'],
          ['Делительный диаметр', 'd', fmt(d)],
        ],
      };
      break;
    }
    case 'bevel': {
      const m = num(seg.m, 1), z = num(seg.z, 10), dl = rad(num(seg.delta, 45));
      const de = m * z, Re = de / (2 * Math.sin(dl)), b = L;
      const dae = de + 2 * m * Math.cos(dl), dfe = de - 2.4 * m * Math.cos(dl);
      const k = Math.max((Re - b) / Re, 0.2);
      const big = seg.big !== 'справа';
      const rBig = dae / 2, rSmall = dae / 2 * k;
      o.r0 = big ? rBig : rSmall; o.r1 = big ? rSmall : rBig;
      o.rb0 = big ? dfe / 2 : dfe / 2 * k; o.rb1 = big ? dfe / 2 * k : dfe / 2;
      o.toothed = true; o.bevel = { big, de, k };
      o.dia.push({ at: big ? 0.08 : 0.92, v: dae, fit: seg.fit || 'h11' });
      o.table = {
        rows: [
          ['Внешний окружной модуль', 'me', fmt(m)], ['Число зубьев', 'z', String(z)], ['Тип зуба', '—', 'Прямой'],
          ['Исходный контур', '—', 'ГОСТ 13754-81'], ['Угол делительного конуса', 'δ', fmt(num(seg.delta)) + '°'],
          ['Степень точности', '—', (seg.prec || '8-B') + ' ГОСТ 1758-81'],
          ['Внешнее конусное расстояние', 'Re', fmt(Re)], ['Внешний делительный диаметр', 'de', fmt(de)],
        ],
      };
      break;
    }
    case 'wormwheel': {
      const m = num(seg.m, 1), z = num(seg.z, 30), q = num(seg.q, 10), x = num(seg.x), z1 = num(seg.z1, 1);
      const d = m * z, da = m * (z + 2 + 2 * x), daM = da + 6 * m / (z1 + 2), df = m * (z - 2.4 + 2 * x);
      o.r0 = o.r1 = daM / 2; o.rb0 = o.rb1 = df / 2; o.pitch = d / 2; o.toothed = true; o.da = da;
      o.dia.push({ at: 0.5, v: daM, fit: seg.fit || 'h11' });
      o.table = {
        rows: [
          ['Модуль', 'm', fmt(m)], ['Число зубьев', 'z₂', String(z)], ['Направление линии зуба', '—', 'Правое'],
          ['Коэффициент смещения червяка', 'x', fmt(x)], ['Исходный производящий червяк', '—', 'ГОСТ 19036-94'],
          ['Степень точности', '—', (seg.prec || '8-B') + ' ГОСТ 3675-81'],
          ['Межосевое расстояние', 'aw', fmt(0.5 * m * (q + z + 2 * x))], ['Делительный диаметр', 'd₂', fmt(d)],
          ['Число витков сопряж. червяка', 'z₁', String(z1)],
        ],
      };
      break;
    }
    case 'worm': {
      const m = num(seg.m, 1), z1 = num(seg.z1, 1), q = num(seg.q, 10);
      const d1 = q * m, da = d1 + 2 * m, df = d1 - 2.4 * m, g = Math.atan(z1 / q) * 180 / Math.PI;
      o.r0 = o.r1 = da / 2; o.rb0 = o.rb1 = df / 2; o.pitch = d1 / 2; o.root = df / 2; o.toothed = true;
      o.dia.push({ at: 0.5, v: da, fit: seg.fit || 'h11' });
      const gd = Math.floor(g), gm = Math.floor((g - gd) * 60), gs = Math.round(((g - gd) * 60 - gm) * 60);
      o.table = {
        rows: [
          ['Модуль', 'm', fmt(m)], ['Число витков', 'z₁', String(z1)], ['Вид червяка', '—', seg.wtype || 'ZA'],
          ['Делительный угол подъёма', 'γ', `${gd}°${gm}′${gs}″`], ['Направление витка', '—', seg.dir === 'левое' ? 'Левое' : 'Правое'],
          ['Исходный червяк', '—', 'ГОСТ 19036-94'], ['Степень точности', '—', (seg.prec || '8-B') + ' ГОСТ 3675-81'],
          ['Делительный диаметр', 'd₁', fmt(d1)], ['Ход витка', 'pz₁', fmt(Math.PI * m * z1)],
        ],
      };
      break;
    }
    case 'sprocket': {
      const tt = num(seg.t, 19.05), z = num(seg.z, 17), d1 = num(seg.d1, 11.91);
      const d = tt / Math.sin(Math.PI / z), da = tt * (0.5 + 1 / Math.tan(Math.PI / z)), df = d - 2 * (0.5025 * d1 + 0.05);
      o.r0 = o.r1 = da / 2; o.rb0 = o.rb1 = df / 2; o.pitch = d / 2; o.toothed = true;
      o.dia.push({ at: 0.5, v: da, fit: seg.fit || 'h14' });
      o.table = {
        rows: [
          ['Число зубьев', 'z', String(z)], ['Профиль зуба', '—', 'ГОСТ 591-69'], ['Сопрягаемая цепь', '—', seg.chain || ''],
          ['Шаг цепи', 't', fmt(tt)], ['Диаметр ролика', 'd₁', fmt(d1)], ['Делительный диаметр', 'd', fmt(d)],
          ['Диаметр впадин', 'df', fmt(df)],
        ],
      };
      break;
    }
    case 'vpulley': {
      const g = VBELT[seg.prof] || VBELT.A;
      const n = Math.max(1, num(seg.n, 1)), dp = num(seg.dp, 100), de = dp + 2 * g.b;
      const al = rad(num(seg.ang, 36) / 2);
      o.r0 = o.r1 = de / 2;
      const pts = [];
      const extra = (L - ((n - 1) * g.e + 2 * g.f)) / 2;
      pts.push({ x: 0, r: de / 2, s: false });
      const wp = g.lp; // ширина по расчётному диаметру
      const depth = g.b + g.h;
      for (let i = 0; i < n; i++) {
        const xc = extra + g.f + i * g.e;
        const wt = wp + 2 * g.b * Math.tan(al);
        const wb = Math.max(wp - 2 * g.h * Math.tan(al), 0.5);
        pts.push({ x: xc - wt / 2, r: de / 2, s: false }, { x: xc - wb / 2, r: de / 2 - depth, s: false },
          { x: xc + wb / 2, r: de / 2 - depth, s: false }, { x: xc + wt / 2, r: de / 2, s: false });
      }
      pts.push({ x: L, r: de / 2, s: false });
      o.custom = pts; o.vp = { dp, g, n };
      o.dia.push({ at: extra + g.f > 0 ? (extra + g.f * 0.5) / L : 0.05, v: de, fit: seg.fit || 'h11' });
      o.note = `Профиль канавок ${seg.prof} по ГОСТ 20889-88, dp=${fmt(dp)}`;
      break;
    }
    case 'tpulley': {
      const m = num(seg.m, 3), z = num(seg.z, 20), h = num(seg.h, 2), dl = num(seg.delta, 0.6);
      const d = m * z, da = d - 2 * dl, df = da - 2 * h;
      o.r0 = o.r1 = da / 2; o.rb0 = o.rb1 = df / 2; o.pitch = d / 2; o.toothed = true;
      o.dia.push({ at: 0.5, v: da, fit: seg.fit || 'h11' });
      o.table = { rows: [['Модуль', 'm', fmt(m)], ['Число зубьев', 'z', String(z)], ['Делительный диаметр', 'd', fmt(d)], ['Высота зуба', 'h', fmt(h)]] };
      break;
    }
    case 'fpulley': {
      const D = num(seg.D), cr = num(seg.crown);
      o.r0 = o.r1 = D / 2;
      if (cr > 0) {
        const pts = [];
        const n = 16;
        for (let i = 0; i <= n; i++) {
          const u = i / n; pts.push({ x: u * L, r: D / 2 - cr + cr * 4 * u * (1 - u), s: i > 0 && i < n });
        }
        o.custom = pts; o.r0 = o.r1 = D / 2 - cr;
      }
      o.dia.push({ at: 0.5, v: D, fit: seg.fit || 'h11' });
      break;
    }
    default: o.r0 = o.r1 = 10;
  }
  if (o.rb0 === null) { o.rb0 = o.r0; o.rb1 = o.r1; }
  return o;
}

export function fmt(v) {
  const s = (Math.round(num(v) * 1000) / 1000).toString();
  return s.replace('.', ',');
}
export function threadLabel(d, P, tol, lh) {
  const coarse = { 3: 0.5, 4: 0.7, 5: 0.8, 6: 1, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2, 16: 2, 18: 2.5, 20: 2.5, 22: 2.5, 24: 3, 27: 3, 30: 3.5, 36: 4, 42: 4.5, 48: 5 };
  let s = 'M' + fmt(d);
  if (!(coarse[d] && Math.abs(coarse[d] - P) < 1e-6)) s += '×' + fmt(P);
  if (lh) s += 'LH';
  if (tol) s += '-' + tol;
  return s;
}
export function parseThread(str) {
  const m = /M\s*(\d+(?:[.,]\d+)?)(?:\s*[×xх]\s*(\d+(?:[.,]\d+)?))?/i.exec(str || '');
  if (!m) return null;
  const d = num(m[1]);
  const coarse = { 3: 0.5, 4: 0.7, 5: 0.8, 6: 1, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2, 16: 2, 18: 2.5, 20: 2.5, 24: 3, 30: 3.5 };
  const P = m[2] ? num(m[2]) : (coarse[d] || d * 0.15);
  return { d, P, minor: threadMinor(d, P) };
}

// Параметры внутренней ступени (u — от торца вглубь)
export function innerInfo(seg) {
  const L = segLength(seg, 'inner');
  const o = { L, r0: 0, r1: 0, rb0: null, rb1: null, dia: [], end: false, toothed: false };
  switch (seg.type) {
    case 'bore': o.r0 = o.r1 = num(seg.D) / 2; o.dia.push({ v: num(seg.D), fit: seg.fit }); break;
    case 'cone': o.r0 = num(seg.D) / 2; o.r1 = num(seg.D2) / 2; o.dia.push({ v: num(seg.D), at: 0.15 }, { v: num(seg.D2), at: 0.85 }); break;
    case 'hex': { const S = num(seg.S); o.r0 = o.r1 = S / Math.sqrt(3); o.S = S; o.dia.push({ label: 'S' + fmt(S), leader: true }); break; }
    case 'square': { const S = num(seg.S); o.r0 = o.r1 = S / 2; o.dia.push({ v: S, label: '□' + fmt(S) }); break; }
    case 'ithread': {
      const d = num(seg.D), P = num(seg.P, 1);
      o.r0 = o.r1 = threadMinor(d, P) / 2; o.major = d / 2;
      o.dia.push({ v: d, label: threadLabel(d, P, seg.tol, seg.lh), r: d / 2 });
      break;
    }
    case 'blind': {
      o.r0 = o.r1 = num(seg.D) / 2; o.end = true;
      o.tip = o.r0 / Math.tan(rad(num(seg.ang, 118) / 2));
      o.dia.push({ v: num(seg.D), fit: '' });
      break;
    }
    case 'center': {
      const c = centerHole(seg.d);
      o.center = c; o.end = true; o.r0 = o.r1 = c.d / 2;
      o.label = `Центровое отв. ${seg.form}${seg.d} ГОСТ 14034-74`;
      break;
    }
    case 'igear': {
      const m = num(seg.m, 1), z = num(seg.z, 40), x = num(seg.x);
      const d = m * z, da = d - 2 * m * (1 - x), df = d + 2 * m * (1.25 + x);
      o.r0 = o.r1 = df / 2; o.tipR = da / 2; o.pitch = d / 2; o.toothed = true;
      o.dia.push({ v: da, fit: seg.fit || 'H11', r: da / 2 });
      o.table = {
        title: 'Внутренний венец', rows: [
          ['Модуль', 'm', fmt(m)], ['Число зубьев', 'z', String(z)], ['Нормальный исходный контур', '—', 'ГОСТ 13755-2015'],
          ['Коэффициент смещения', 'x', fmt(x)], ['Степень точности', '—', (seg.prec || '8-B') + ' ГОСТ 1643-81'], ['Делительный диаметр', 'd', fmt(d)],
        ],
      };
      break;
    }
    case 'ispline': {
      const D = num(seg.D), z = num(seg.z, 6);
      let d = num(seg.d); let m = 0;
      if (seg.kind === 'эвольвентные') { m = num(seg.m, 1); d = D - 2 * 1.1 * m; }
      o.r0 = o.r1 = D / 2; o.tipR = d / 2; o.toothed = true;
      const des = seg.des || (seg.kind === 'эвольвентные' ? `${fmt(D)}×${fmt(m)} ГОСТ 6033-80` : `d-${z}×${fmt(d)}×${fmt(D)}×${fmt(num(seg.b))} ГОСТ 1139-80`);
      o.dia.push({ label: des, leader: true });
      o.spline = { z, d, D, b: num(seg.b), kind: seg.kind, m };
      break;
    }
    default: o.r0 = o.r1 = 5;
  }
  if (o.rb0 === null) { o.rb0 = o.r0; o.rb1 = o.r1; }
  return o;
}

// Полный расчёт модели
export function computeModel(project) {
  const warnings = [];
  const outer = [];
  let x = 0;
  for (const seg of project.outer) {
    const info = outerInfo(seg);
    outer.push({ seg, info, x0: x, x1: x + info.L });
    x += info.L;
  }
  const Lt = x;

  // Базовый видимый профиль (с фасками, галтелями, канавками)
  let vis = [], body = [];
  const keyways = [], crossholes = [], ringholes = [], faceholes = [], facegrooves = [], grooves = [], chamfers = [], fillets = [];
  outer.forEach((o, i) => {
    const { seg, info, x0, x1 } = o;
    const prev = outer[i - 1], next = outer[i + 1];
    const rPrev = prev ? prev.info.r1 : 0, rNext = next ? next.info.r0 : 0;
    let pts = info.custom ? info.custom.map(p => ({ x: x0 + p.x, r: p.r, s: p.s })) :
      [{ x: x0, r: info.r0, s: false }, { x: x1, r: info.r1, s: false }];
    let bpts = info.toothed ? [{ x: x0, r: info.rb0, s: false }, { x: x1, r: info.rb1, s: false }] : null;
    const chA = num(seg.chA, 45);
    const chL = num(seg.chL), chR = num(seg.chR);
    const fL = num(seg.fL), fR = num(seg.fR);
    // Канавки
    for (const f of seg.features || []) {
      if (f.type !== 'groove') continue;
      const dNom = info.r0 * 2;
      let b = num(f.b, 2), dg = num(f.dg);
      let slL = 0, slR = 0, rr = 0;
      if (dg <= 0) {
        if (f.kind === 'выход резьбы') { const u = threadUndercutOuter(dNom, num(seg.P, 1.5)); dg = u.dg; b = u.b; }
        else if (f.kind === 'шлифовальная') { const u = grindGroove(dNom); dg = dNom - 2 * u.h; b = u.b; }
        else if (f.kind === 'стопорное кольцо') { const u = ringGrooveShaft(dNom); dg = u.dg; b = u.b; }
        else dg = dNom - 2;
      }
      let xa;
      if (f.at === 'слева') xa = x0; else if (f.at === 'справа') xa = x1 - b; else xa = x0 + num(f.pos);
      const xb = xa + b;
      const depth = (dNom - dg) / 2;
      if (f.kind === 'выход резьбы' || f.kind === 'шлифовальная') {
        if (f.at === 'справа') slL = Math.min(depth, b * 0.4); else if (f.at === 'слева') slR = Math.min(depth, b * 0.4);
      } else if (f.kind === 'прямоугольная') rr = Math.min(num(f.r), b / 2 - 0.01, depth - 0.01);
      if (f.kind === 'выход резьбы' && f.at !== 'по координате') rr = 0;
      pts = notch(pts, xa, xb, dg / 2, slL, slR, Math.max(rr, 0));
      grooves.push({ f, seg, xa, xb, dg, b, rOuter: dNom / 2 });
    }
    // Фаски (только на выпуклых углах)
    const hasGrooveL = (seg.features || []).some(f => f.type === 'groove' && f.at === 'слева');
    const hasGrooveR = (seg.features || []).some(f => f.type === 'groove' && f.at === 'справа');
    if (chL > 0 && !hasGrooveL && rPrev < info.r0 - EPS) {
      const c = Math.min(chL, info.L / 2), cr = Math.min(c * Math.tan(rad(chA)), info.r0 - rPrev - 0.01);
      const r1 = rAt(pts, x0 + c, 1);
      pts = [{ x: x0, r: info.r0 - cr, s: false }, { x: x0 + c, r: r1, s: false }, ...pts.filter(p => p.x > x0 + c + EPS)];
      chamfers.push({ x: x0, side: -1, c, a: chA, r: info.r0, cr });
    }
    if (chR > 0 && !hasGrooveR && rNext < info.r1 - EPS) {
      const c = Math.min(chR, info.L / 2), cr = Math.min(c * Math.tan(rad(chA)), info.r1 - rNext - 0.01);
      const r1 = rAt(pts, x1 - c, -1);
      pts = [...pts.filter(p => p.x < x1 - c - EPS), { x: x1 - c, r: r1, s: false }, { x: x1, r: info.r1 - cr, s: false }];
      chamfers.push({ x: x1, side: 1, c, a: chA, r: info.r1, cr });
    }
    // Галтели (вогнутые углы)
    if (fL > 0 && rPrev > info.r0 + EPS && !hasGrooveL) {
      const R = Math.min(fL, rPrev - info.r0, info.L / 2);
      const arc = []; arcPts(arc, x0 + R, info.r0 + R, R, 180, 270, true);
      arc[0].s = true; arc[arc.length - 1].s = true;
      pts = [...arc, ...pts.filter(p => p.x > x0 + R + EPS)];
      fillets.push({ x: x0 + R * 0.3, y: info.r0 + R * 0.3, R, side: -1 });
    }
    if (fR > 0 && rNext > info.r1 + EPS && !hasGrooveR) {
      const R = Math.min(fR, rNext - info.r1, info.L / 2);
      const arc = []; arcPts(arc, x1 - R, info.r1 + R, R, 270, 360, true);
      arc[0].s = true; arc[arc.length - 1].s = true;
      pts = [...pts.filter(p => p.x < x1 - R - EPS), ...arc];
      fillets.push({ x: x1 - R * 0.3, y: info.r1 + R * 0.3, R, side: 1 });
    }
    o.pts = pts;
    vis.push(...pts);
    body.push(...(bpts || pts));
    // Прочие элементы
    const rNom = Math.max(info.r0, info.r1);
    for (const f of seg.features || []) {
      if (f.type === 'keyway') {
        const dN = info.r0 * 2;
        let b = num(f.b), t = num(f.t), len = num(f.len);
        if (f.auto) {
          const k = keyFor(dN); b = k.b; t = k.t1;
          if (f.kind === 'сегментная') { t = Math.max(t, num(f.dseg) * 0.3); }
        }
        let x1k, x2k;
        if (f.kind === 'сегментная') {
          const Rk = num(f.dseg, 20) / 2;
          len = 2 * Math.sqrt(Math.max(Rk * Rk - (Rk - t) * (Rk - t), 0));
        }
        x1k = x0 + num(f.pos); x2k = Math.min(x1k + len, x1);
        if (x1k + len > x1 + EPS) warnings.push(`Шпоночный паз выходит за ступень ${project.outer.indexOf(seg) + 1}`);
        keyways.push({ f, seg, x1: x1k, x2: x2k, b, t, r: info.r0, len: x2k - x1k, kind: f.kind, angle: f.angle, dseg: num(f.dseg), fitb: f.fitb, segX0: x0, segX1: x1 });
      } else if (f.type === 'crosshole') {
        const th = parseThread(f.thr);
        const d = th ? th.minor : num(f.d, 5);
        crossholes.push({ f, seg, x: x0 + num(f.pos), d, th, r: rAt(pts, x0 + num(f.pos)), through: !!f.through, depth: num(f.depth), angle: f.angle, segX0: x0 });
      } else if (f.type === 'ringhole') {
        ringholes.push({ f, seg, x: x0 + num(f.pos), d: num(f.d), n: Math.max(1, num(f.n, 1)), a0: num(f.a0), r: rAt(pts, x0 + num(f.pos)), depth: num(f.depth), segX0: x0 });
      } else if (f.type === 'faceholes') {
        const left = f.side !== 'правый';
        const th = parseThread(f.thr);
        faceholes.push({ f, seg, xf: left ? x0 : x1, dir: left ? 1 : -1, n: Math.max(1, num(f.n, 1)), d: th ? th.minor : num(f.d), th, pcd: num(f.pcd), depth: num(f.depth), a0: num(f.a0), rFace: rNom });
      } else if (f.type === 'facegroove') {
        const left = f.side !== 'правый';
        facegrooves.push({ f, seg, xf: left ? x0 : x1, dir: left ? 1 : -1, rIn: num(f.dIn) / 2, rOut: num(f.dOut) / 2, depth: num(f.depth) });
      }
    }
  });
  if (!vis.length) vis = [{ x: 0, r: 0, s: false }, { x: 1, r: 0, s: false }];
  if (!body.length) body = vis;

  // Внутренние контуры
  const inner = { L: buildInner(project.innerL || [], 'L', Lt, warnings), R: buildInner(project.innerR || [], 'R', Lt, warnings) };
  const Rmax = Math.max(0.5, ...vis.map(p => p.r));
  if (inner.L.depth + inner.R.depth > Lt + EPS && inner.L.depth > 0 && inner.R.depth > 0) {
    // сквозное — это нормально
  }
  for (const side of ['L', 'R']) {
    for (const s of inner[side].segs) {
      const xm = side === 'L' ? (s.u0 + s.u1) / 2 : Lt - (s.u0 + s.u1) / 2;
      const ro = rAt(body, Math.max(0, Math.min(Lt, xm)));
      if (Math.max(s.info.r0, s.info.r1) >= ro - 0.3) warnings.push('Внутренний диаметр больше наружного');
    }
    if (inner[side].depth > Lt + EPS) warnings.push('Глубина отверстия больше длины вала');
  }

  return {
    Lt, Rmax, outer, vis, body, inner, keyways, crossholes, ringholes, faceholes, facegrooves, grooves, chamfers, fillets,
    warnings: [...new Set(warnings)],
    rAt: (x, side) => rAt(vis, x, side),
    rBodyAt: (x, side) => rAt(body, x, side),
  };
}

function buildInner(list, side, Lt, warnings) {
  const segs = [];
  let u = 0;
  let pts = [];
  let tipU = null; // вершина конуса сверла
  let ended = false;
  const keyways = [], grooves = [];
  for (let i = 0; i < list.length; i++) {
    const seg = list[i];
    if (ended) { warnings.push('Элементы после глухого/центрового отверстия не учитываются'); break; }
    const info = innerInfo(seg);
    const u0 = u, u1 = u + info.L;
    let sp = [];
    if (seg.type === 'center') {
      const c = info.center;
      let uu = 0;
      if (seg.form === 'B' || seg.form === 'F') {
        const lb = (c.D2 - c.D) / 2 / Math.tan(rad(60));
        sp.push({ x: u0, r: c.D2 / 2, s: false }); uu = lb;
      }
      const lc = (c.D - c.d) / 2 / Math.tan(rad(30));
      sp.push({ x: u0 + uu, r: c.D / 2, s: false }, { x: u0 + uu + lc, r: c.d / 2, s: false });
      const lcyl = Math.max(c.l - uu - lc, c.d * 0.4);
      sp.push({ x: u0 + uu + lc + lcyl, r: c.d / 2, s: false });
      info.L = uu + lc + lcyl;
      tipU = u0 + info.L + (c.d / 2) / Math.tan(rad(59));
      ended = true;
      segs.push({ seg, info, u0, u1: u0 + info.L, pts: sp });
      pts.push(...sp);
      u = u0 + info.L;
      continue;
    }
    sp = [{ x: u0, r: info.r0, s: false }, { x: u1, r: info.r1, s: false }];
    const ch = num(seg.ch);
    const rPrev = pts.length ? pts[pts.length - 1].r : 1e9;
    if (ch > 0 && rPrev > info.r0 + ch - EPS) {
      sp = [{ x: u0, r: info.r0 + ch, s: false }, { x: u0 + Math.min(ch, info.L / 2), r: info.r0, s: false }, sp[1]];
    }
    for (const f of seg.features || []) {
      if (f.type === 'igroove') {
        const dNom = (seg.type === 'ithread' ? info.major : info.r0) * 2;
        let b = num(f.b, 2), dg = num(f.dg);
        if (dg <= 0) {
          if (f.kind === 'стопорное кольцо') { const g = ringGrooveHole(dNom); dg = g.dg; b = g.b; }
          else if (f.kind === 'выход резьбы') { const g = threadUndercutInner(dNom, num(seg.P, 1.5)); dg = g.dg; b = g.b; }
          else dg = dNom + 2;
        }
        const ua = u0 + num(f.pos), ub = ua + b;
        sp = notchUp(sp, ua, ub, dg / 2);
        grooves.push({ f, seg, ua, ub, dg, b });
      } else if (f.type === 'ikeyway') {
        let b = num(f.b), t = num(f.t);
        if (f.auto) { const k = keyFor(info.r0 * 2); b = k.b; t = k.t2; }
        keyways.push({ f, seg, u0, u1, b, t, r: info.r0, angle: f.angle, fitb: f.fitb });
      }
    }
    if (seg.type === 'blind') { tipU = u1 + info.tip; ended = true; }
    segs.push({ seg, info, u0, u1, pts: sp });
    pts.push(...sp);
    u = u1;
  }
  const depth = tipU !== null ? tipU : u;
  return { segs, pts, depth, cylDepth: u, tipU, keyways, grooves, side, map: side === 'L' ? (uu => uu) : (uu => Lt - uu) };
}

function notchUp(pts, ua, ub, rg) {
  const left = pts.filter(p => p.x < ua - EPS), right = pts.filter(p => p.x > ub + EPS);
  return [...left, { x: ua, r: rAt(pts, ua, 1), s: false }, { x: ua, r: rg, s: false }, { x: ub, r: rg, s: false }, { x: ub, r: rAt(pts, ub, -1), s: false }, ...right];
}

// Замкнутые контуры в плоскости XY (полные, с зеркалом) — для булевых операций
export function outerPolygon(pts) {
  const top = pts.map(p => [p.x, p.r]);
  const bot = pts.slice().reverse().map(p => [p.x, -p.r]);
  return clean([...top, ...bot]);
}
export function innerPolygon(inner) {
  if (!inner.pts.length) return null;
  const m = inner.map;
  const top = inner.pts.map(p => [m(p.x), p.r]);
  const end = inner.tipU !== null ? [[m(inner.tipU), 0]] : [[m(inner.cylDepth), 0]];
  const bot = inner.pts.slice().reverse().map(p => [m(p.x), -p.r]);
  // выход за торец для надёжного вычитания
  const f = m(0), dir = inner.side === 'L' ? -1 : 1;
  const r0 = inner.pts[0].r;
  return clean([[f + dir * 1, r0], ...top, ...end, ...bot, [f + dir * 1, -r0]]);
}
function clean(poly) {
  const out = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-7 || Math.abs(q[1] - p[1]) > 1e-7) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7) out.pop();
  }
  return out;
}

// Точки вершин (для линий переходов): [{x, r}] — вертикальные линии ±r
export function vertexLines(pts) {
  const map = new Map();
  for (const p of pts) {
    if (p.s) continue;
    const k = Math.round(p.x * 1e5) / 1e5;
    map.set(k, Math.max(map.get(k) ?? 0, p.r));
  }
  return [...map.entries()].map(([x, r]) => ({ x, r }));
}

export { rAt, num };
