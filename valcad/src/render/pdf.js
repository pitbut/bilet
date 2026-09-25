// Экспорт в векторный PDF (jsPDF) со шрифтом с кириллицей
import { jsPDF } from 'jspdf';
import { LW, DASH, arcPoints } from './common.js';
import { CAP, textWidth } from '../prims.js';

let fontB64 = null;
async function loadFont() {
  if (fontB64) return fontB64;
  const buf = await (await fetch('fonts/gost.ttf')).arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  fontB64 = btoa(bin);
  return fontB64;
}

export async function toPDF(sheet) {
  const { W, H, prims } = sheet;
  const doc = new jsPDF({ orientation: W > H ? 'landscape' : 'portrait', unit: 'mm', format: [W, H], compress: true });
  doc.addFileToVFS('gost.ttf', await loadFont());
  doc.addFont('gost.ttf', 'GOST', 'normal');
  doc.setFont('GOST', 'normal');
  const Y = y => H - y;
  const stroke = q => {
    doc.setLineWidth(LW[q.w] || LW.main);
    const d = DASH[q.s];
    doc.setLineDashPattern(d || [], 0);
  };
  doc.setDrawColor(0); doc.setFillColor(0); doc.setTextColor(0);
  doc.setLineCap('round');
  const path = (pts, closed) => {
    for (let i = 0; i < pts.length - 1; i++) doc.line(pts[i][0], Y(pts[i][1]), pts[i + 1][0], Y(pts[i + 1][1]));
    if (closed && pts.length > 2) doc.line(pts[pts.length - 1][0], Y(pts[pts.length - 1][1]), pts[0][0], Y(pts[0][1]));
  };
  for (const q of prims) {
    if (q.layer === 'hl') continue;
    switch (q.t) {
      case 'L': stroke(q); doc.line(q.x1, Y(q.y1), q.x2, Y(q.y2)); break;
      case 'P': stroke(q); path(q.pts, q.closed); break;
      case 'C': stroke(q); doc.circle(q.x, Y(q.y), q.r, 'S'); break;
      case 'A': stroke(q); path(arcPoints(q.x, q.y, q.r, q.a0, q.a1), false); break;
      case 'F': {
        doc.setLineDashPattern([], 0);
        const p = q.pts;
        doc.triangle(p[0][0], Y(p[0][1]), p[1][0], Y(p[1][1]), p[2][0], Y(p[2][1]), 'F');
        break;
      }
      case 'T': {
        const fsMM = q.h / CAP;
        doc.setFontSize(fsMM / 0.352778);
        const a = q.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const w = textWidth(q.text, q.h);
        let dx = q.anchor === 'c' ? -w / 2 : q.anchor === 'r' ? -w : 0;
        const dy = q.va === 'm' ? -q.h / 2 : q.va === 't' ? -q.h : 0;
        const x = q.x + dx * c - dy * s, y = q.y + dx * s + dy * c;
        doc.text(q.text, x, Y(y), { angle: q.rot });
        break;
      }
    }
  }
  return doc.output('arraybuffer');
}
