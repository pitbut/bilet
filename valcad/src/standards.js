// Допуски ГОСТ 25346/25347 (ISO 286) и стандартные таблицы.

const R = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];
const IT = {
  5: [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6: [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7: [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8: [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9: [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
  12: [100, 120, 150, 180, 210, 250, 300, 350, 400, 460, 520, 570, 630],
  13: [140, 180, 220, 270, 330, 390, 460, 540, 630, 720, 810, 890, 970],
  14: [250, 300, 360, 430, 520, 620, 740, 870, 1000, 1150, 1300, 1400, 1550],
};
// Основные отклонения валов (мкм). a..h — верхнее es (со знаком минус), j..zc — нижнее ei
const SH = {
  d: [20, 30, 40, 50, 65, 80, 100, 120, 145, 170, 190, 210, 230],
  e: [14, 20, 25, 32, 40, 50, 60, 72, 85, 100, 110, 125, 135],
  f: [6, 10, 13, 16, 20, 25, 30, 36, 43, 50, 56, 62, 68],
  g: [2, 4, 5, 6, 7, 9, 10, 12, 14, 15, 17, 18, 20],
  k: [0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5],
  m: [2, 4, 6, 7, 8, 9, 11, 13, 15, 17, 20, 21, 23],
  n: [4, 8, 10, 12, 15, 17, 20, 23, 27, 31, 34, 37, 40],
  p: [6, 12, 15, 18, 22, 26, 32, 37, 43, 50, 56, 62, 68],
};
const RF = [3, 6, 10, 18, 30, 50, 65, 80, 100, 120, 140, 160, 180, 200, 225, 250, 280, 315, 355, 400, 450, 500];
const SHF = {
  r: [10, 15, 19, 23, 28, 34, 41, 43, 51, 54, 63, 65, 68, 77, 80, 84, 94, 98, 108, 114, 126, 132],
  s: [14, 19, 23, 28, 35, 43, 53, 59, 71, 79, 92, 100, 108, 122, 130, 140, 158, 170, 190, 208, 232, 252],
};

function idx(d, ranges) {
  for (let i = 0; i < ranges.length; i++) if (d <= ranges[i]) return i;
  return -1;
}

// Возвращает { es, ei } в мм или null
export function deviations(fit, d) {
  if (!fit || !(d > 0) || d > 500) return null;
  const m = /^([a-zA-Z]{1,2})(\d{1,2})$/.exec(fit);
  if (!m) return null;
  const letter = m[1], grade = +m[2];
  const i = idx(d, R);
  if (!IT[grade] || i < 0) return null;
  const it = IT[grade][i];
  const isHole = letter[0] === letter[0].toUpperCase();
  const l = letter.toLowerCase();
  let es, ei;
  const shaft = (L, g) => {
    // основное отклонение вала для буквы L и квалитета g
    if (L === 'h') return { es: 0 };
    if (L === 'js') return { js: true };
    if ('defg'.includes(L)) return { es: -SH[L][i] };
    if (L === 'k') return { ei: (g >= 4 && g <= 7 && d > 3) ? SH.k[i] : 0 };
    if ('mnp'.includes(L)) return { ei: SH[L][i] };
    if ('rs'.includes(L)) return { ei: SHF[L][idx(d, RF)] };
    return null;
  };
  if (!isHole) {
    const b = shaft(l, grade);
    if (!b) return null;
    if (b.js) { es = it / 2; ei = -it / 2; }
    else if (b.es !== undefined) { es = b.es; ei = es - it; }
    else { ei = b.ei; es = ei + it; }
  } else {
    if (l === 'h') { ei = 0; es = it; }
    else if (l === 'js') { es = it / 2; ei = -it / 2; }
    else if ('defg'.includes(l)) { ei = SH[l][i]; es = ei + it; }
    else if ('kmn'.includes(l)) {
      const delta = (grade <= 8 && d > 3 && IT[grade - 1]) ? it - IT[grade - 1][i] : 0;
      const sh = shaft(l, grade);
      if (l === 'k') {
        es = grade <= 8 ? -(d > 3 ? SH.k[i] : 0) + delta : 0;
      } else if (l === 'm') {
        es = grade <= 8 ? -SH.m[i] + delta : -SH.m[i];
      } else {
        es = grade <= 8 ? -SH.n[i] + delta : 0;
      }
      if (d <= 3 && l === 'n' && grade > 8) es = -4;
      ei = es - it;
      void sh;
    } else if (l === 'p') {
      if (grade > 7) es = -SH.p[i];
      else es = -SH.p[i] + (IT[grade - 1] ? it - IT[grade - 1][i] : 0);
      ei = es - it;
    } else return null;
  }
  return { es: es / 1000, ei: ei / 1000 };
}

export function fmtNum(v, dec = 3) {
  let s = (Math.round(v * 1000) / 1000).toFixed(dec).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s.replace('.', ',');
}
export function fmtDev(v) {
  if (Math.abs(v) < 1e-9) return '0';
  return (v > 0 ? '+' : '−') + fmtNum(Math.abs(v));
}

// Шпонки призматические ГОСТ 23360-78: [dmin, dmax, b, h, t1, t2]
const KEYS = [
  [6, 8, 2, 2, 1.2, 1], [8, 10, 3, 3, 1.8, 1.4], [10, 12, 4, 4, 2.5, 1.8], [12, 17, 5, 5, 3, 2.3],
  [17, 22, 6, 6, 3.5, 2.8], [22, 30, 8, 7, 4, 3.3], [30, 38, 10, 8, 5, 3.3], [38, 44, 12, 8, 5, 3.3],
  [44, 50, 14, 9, 5.5, 3.8], [50, 58, 16, 10, 6, 4.3], [58, 65, 18, 11, 7, 4.4], [65, 75, 20, 12, 7.5, 4.9],
  [75, 85, 22, 14, 9, 5.4], [85, 95, 25, 14, 9, 5.4], [95, 110, 28, 16, 10, 6.4], [110, 130, 32, 18, 11, 7.4],
  [130, 150, 36, 20, 12, 8.4], [150, 170, 40, 22, 13, 9.4], [170, 200, 45, 25, 15, 10.4], [200, 230, 50, 28, 17, 11.4],
];
export function keyFor(d) {
  for (const k of KEYS) if (d > k[0] && d <= k[1]) return { b: k[2], h: k[3], t1: k[4], t2: k[5] };
  return d <= 6 ? { b: 2, h: 2, t1: 1.2, t2: 1 } : { b: 50, h: 28, t1: 17, t2: 11.4 };
}
const STD_LEN = [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40, 45, 50, 56, 63, 70, 80, 90, 100, 110, 125, 140, 160, 180, 200, 220, 250];
export function keyLen(maxLen) {
  let best = STD_LEN[0];
  for (const l of STD_LEN) if (l <= maxLen) best = l;
  return best;
}

// Канавки под стопорные кольца на валу ГОСТ 13942-86: [d, d2, m]
const RING_SHAFT = [
  [8, 7.6, 0.9], [10, 9.6, 1.1], [12, 11.5, 1.1], [14, 13.4, 1.1], [15, 14.3, 1.1], [16, 15.2, 1.1], [17, 16.2, 1.1],
  [18, 17, 1.3], [20, 19, 1.3], [22, 21, 1.3], [25, 23.9, 1.3], [28, 26.6, 1.6], [30, 28.6, 1.6], [32, 30.3, 1.6],
  [35, 33, 1.6], [40, 37.5, 1.9], [45, 42.5, 1.9], [50, 47, 2.2], [55, 52, 2.2], [60, 57, 2.2], [65, 62, 2.7],
  [70, 67, 2.7], [75, 72, 2.7], [80, 76.5, 2.7], [85, 81.5, 3.2], [90, 86.5, 3.2], [100, 96.5, 3.2], [110, 106, 4.2],
  [120, 116, 4.2],
];
export function ringGrooveShaft(d) {
  let best = RING_SHAFT[0];
  for (const r of RING_SHAFT) if (Math.abs(r[0] - d) < Math.abs(best[0] - d)) best = r;
  const k = d / best[0];
  return { dg: +(best[1] * k).toFixed(1), b: best[2] };
}
// Канавки под кольца в отверстии ГОСТ 13943-86 (приближённо: d2 ≈ d·1.045+0.3)
export function ringGrooveHole(d) {
  const b = d <= 20 ? 1.1 : d <= 40 ? 1.3 : d <= 60 ? 1.9 : d <= 90 ? 2.2 : 2.7;
  return { dg: +(d * 1.045 + 0.3).toFixed(1), b };
}
// Канавка для выхода резьбы ГОСТ 10549-80 (наружная): dg = d - 1.5P ~, b по шагу
export function threadUndercutOuter(d, P) {
  const b = P <= 0.5 ? 1.6 : P <= 0.75 ? 2 : P <= 1 ? 3 : P <= 1.25 ? 3.5 : P <= 1.5 ? 4 : P <= 1.75 ? 4 : P <= 2 ? 5 : P <= 2.5 ? 6 : 8;
  return { dg: +(d - 1.5 * P).toFixed(1), b };
}
export function threadUndercutInner(d, P) {
  const b = P <= 1 ? 4 : P <= 1.5 ? 5 : P <= 2 ? 6 : 8;
  return { dg: +(d + 0.5 * P).toFixed(1), b };
}
// Шлифовальная канавка ГОСТ 8820-69 (наружное шлифование)
export function grindGroove(d) {
  if (d <= 10) return { b: 1, h: 0.2 };
  if (d <= 50) return { b: 3, h: 0.3 };
  if (d <= 100) return { b: 5, h: 0.5 };
  return { b: 8, h: 0.5 };
}

// Центровые отверстия ГОСТ 14034-74: d -> D (форма A), D2 (форма B), l
const CENTERS = {
  '1': [2.12, 3.15, 1.3], '1,6': [3.35, 5, 2], '2': [4.25, 6.3, 2.5], '2,5': [5.3, 8, 3.1], '3,15': [6.7, 10, 3.9],
  '4': [8.5, 12.5, 5], '5': [10.6, 16, 6.3], '6,3': [13.2, 18, 8], '8': [17, 22.4, 10.1], '10': [21.2, 28, 12.8], '12': [25.4, 33, 14.6],
};
export function centerHole(dStr) {
  const c = CENTERS[dStr] || CENTERS['3,15'];
  return { d: parseFloat(String(dStr).replace(',', '.')), D: c[0], D2: c[1], l: c[2] };
}

// Профили клиновых ремней ГОСТ 20889-88: lp, b (над расч. диам.), h (под), e (шаг канавок), f
export const VBELT = {
  Z: { lp: 8.5, b: 2.5, h: 7, e: 12, f: 8 },
  A: { lp: 11, b: 3.3, h: 8.7, e: 15, f: 10 },
  B: { lp: 14, b: 4.2, h: 10.8, e: 19, f: 12.5 },
  C: { lp: 19, b: 5.7, h: 14.3, e: 25.5, f: 17 },
  SPZ: { lp: 8.5, b: 2, h: 11, e: 12, f: 8 },
  SPA: { lp: 11, b: 2.75, h: 13.75, e: 15, f: 10 },
  SPB: { lp: 14, b: 3.5, h: 17.5, e: 19, f: 12.5 },
};

export function threadMinor(d, P) { return d - 1.0825 * P; }
export function threadName(d, P, coarse) {
  return 'M' + fmtNum(d) + (coarse ? '' : '×' + fmtNum(P));
}
// Крупные шаги метрической резьбы
const COARSE = { 3: 0.5, 4: 0.7, 5: 0.8, 6: 1, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2, 16: 2, 18: 2.5, 20: 2.5, 22: 2.5, 24: 3, 27: 3, 30: 3.5, 33: 3.5, 36: 4, 42: 4.5, 48: 5, 56: 5.5, 64: 6 };
export function isCoarse(d, P) { return COARSE[d] !== undefined && Math.abs(COARSE[d] - P) < 1e-6; }
export function coarsePitch(d) { return COARSE[d]; }

export const STEEL_DENSITY = 7.85e-6; // кг/мм³
