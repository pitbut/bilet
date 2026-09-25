// Экспорт в DXF (AutoCAD R12, кодовая страница ANSI_1251) в натуральную величину (1:1, мм)
import { arcPoints, layerOf } from './common.js';
import { textWidth } from '../prims.js';

const LAYERS = {
  MAIN: 7, THIN: 7, AXIS: 1, HIDDEN: 5, DIM: 3, HATCH: 8, TEXT: 7, FRAME: 7,
};
const LNAME = { main: 'MAIN', thin: 'THIN', axis: 'AXIS', hidden: 'HIDDEN', dim: 'DIM', hatch: 'HATCH', text: 'TEXT', frame: 'FRAME' };
const LTYPE_OF = { AXIS: 'CENTER', HIDDEN: 'HIDDEN' };

function encodeText(s) {
  return String(s)
    .replace(/⌀|Ø/g, '%%c').replace(/°/g, '%%d').replace(/±/g, '%%p')
    .replace(/×/g, 'x').replace(/[−–—]/g, '-').replace(/[′]/g, "'").replace(/[″]/g, '"')
    .replace(/[₁]/g, '1').replace(/[₂]/g, '2')
    .replace(/[^\x00-\x7FЀ-џ№]/g, ch => '\\U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
}
// UTF-16 строка -> байты cp1251
function toCp1251(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) out[i] = c;
    else if (c >= 0x410 && c <= 0x44F) out[i] = c - 0x410 + 0xC0;
    else if (c === 0x401) out[i] = 0xA8;
    else if (c === 0x451) out[i] = 0xB8;
    else if (c === 0x2116) out[i] = 0xB9;
    else out[i] = 63;
  }
  return out;
}

export function toDXF(sheet) {
  const s = sheet.scale || 1;
  const k = 1 / s; // лист -> натура
  const o = [];
  const g = (code, v) => { o.push(String(code)); o.push(typeof v === 'number' ? (Math.round(v * 1e6) / 1e6).toString() : String(v)); };
  // HEADER
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1251');
  g(9, '$INSUNITS'); g(70, 4);
  g(9, '$LTSCALE'); g(40, k);
  g(9, '$EXTMIN'); g(10, 0); g(20, 0); g(30, 0);
  g(9, '$EXTMAX'); g(10, sheet.W * k); g(20, sheet.H * k); g(30, 0);
  g(0, 'ENDSEC');
  // TABLES
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 3);
  const lt = (name, desc, pat) => {
    g(0, 'LTYPE'); g(2, name); g(70, 0); g(3, desc); g(72, 65); g(73, pat.length);
    g(40, pat.reduce((a, b) => a + Math.abs(b), 0));
    for (const p of pat) g(49, p);
  };
  lt('CONTINUOUS', 'Solid line', []);
  lt('CENTER', 'Center ____ _ ____', [10, -1.5, 1, -1.5]);
  lt('HIDDEN', 'Hidden __ __ __', [3, -1.5]);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, Object.keys(LAYERS).length);
  for (const [name, color] of Object.entries(LAYERS)) {
    g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, LTYPE_OF[name] || 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
  g(0, 'STYLE'); g(2, 'GOST'); g(70, 0); g(40, 0); g(41, 0.85); g(50, 15); g(71, 0); g(42, 3.5); g(3, 'arial.ttf'); g(4, '');
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  // ENTITIES
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const line = (L, x1, y1, x2, y2) => { g(0, 'LINE'); g(8, L); g(10, x1 * k); g(20, y1 * k); g(30, 0); g(11, x2 * k); g(21, y2 * k); g(31, 0); };
  for (const q of sheet.prims) {
    if (q.layer === 'hl') continue;
    const L = LNAME[layerOf(q)] || 'MAIN';
    switch (q.t) {
      case 'L': line(L, q.x1, q.y1, q.x2, q.y2); break;
      case 'P': {
        const pts = q.pts;
        for (let i = 0; i < pts.length - 1; i++) line(L, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        if (q.closed && pts.length > 2) line(L, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
        break;
      }
      case 'C': g(0, 'CIRCLE'); g(8, L); g(10, q.x * k); g(20, q.y * k); g(30, 0); g(40, q.r * k); break;
      case 'A': {
        g(0, 'ARC'); g(8, L); g(10, q.x * k); g(20, q.y * k); g(30, 0); g(40, q.r * k);
        g(50, ((q.a0 % 360) + 360) % 360); g(51, ((q.a1 % 360) + 360) % 360);
        break;
      }
      case 'F': {
        const p = q.pts;
        g(0, 'SOLID'); g(8, 'DIM');
        const P = [p[0], p[1], p[2], p[3] || p[2]];
        g(10, P[0][0] * k); g(20, P[0][1] * k); g(30, 0);
        g(11, P[1][0] * k); g(21, P[1][1] * k); g(31, 0);
        g(12, P[3][0] * k); g(22, P[3][1] * k); g(32, 0);
        g(13, P[2][0] * k); g(23, P[2][1] * k); g(33, 0);
        break;
      }
      case 'T': {
        const a = q.rot * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
        let dx = 0, dy = q.va === 'm' ? -q.h / 2 : q.va === 't' ? -q.h : 0;
        const w = textWidth(q.text, q.h);
        if (q.anchor === 'c') dx = -w / 2; else if (q.anchor === 'r') dx = -w;
        const x = q.x + dx * c - dy * sn, y = q.y + dx * sn + dy * c;
        g(0, 'TEXT'); g(8, q.layer === 'dim' ? 'DIM' : 'TEXT'); g(7, 'GOST');
        g(10, x * k); g(20, y * k); g(30, 0); g(40, q.h * k); g(1, encodeText(q.text));
        if (q.rot) g(50, q.rot);
        g(41, 0.85); g(51, 15);
        break;
      }
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return toCp1251(o.join('\r\n') + '\r\n');
}
void arcPoints;
