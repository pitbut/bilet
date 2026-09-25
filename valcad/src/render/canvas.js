import { LW, DASH, arcPoints } from './common.js';
import { CAP } from '../prims.js';

export const FONT = 'GOSTF';

// view: { k (px на мм), ox, oy (px смещение левого-нижнего угла листа) }
export function drawSheet(ctx, sheet, view, opts = {}) {
  const { prims, W, H } = sheet;
  const k = view.k;
  const X = x => view.ox + x * k;
  const Y = y => view.oy - y * k;
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(X(0), Y(H), W * k, H * k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ink = opts.ink || '#000';
  const setStroke = q => {
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(opts.minPx ?? 0.6, (LW[q.w] || LW.main) * k);
    const d = DASH[q.s];
    ctx.setLineDash(d ? d.map(v => v * k) : []);
  };
  for (const q of prims) {
    if (q.layer === 'hl') {
      if (!opts.highlight) continue;
      ctx.fillStyle = 'rgba(255,140,0,0.28)';
      ctx.setLineDash([]);
      ctx.beginPath();
      q.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.closePath(); ctx.fill();
      continue;
    }
    switch (q.t) {
      case 'L':
        setStroke(q); ctx.beginPath(); ctx.moveTo(X(q.x1), Y(q.y1)); ctx.lineTo(X(q.x2), Y(q.y2)); ctx.stroke(); break;
      case 'P':
        setStroke(q); ctx.beginPath();
        q.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        if (q.closed) ctx.closePath();
        ctx.stroke(); break;
      case 'C':
        setStroke(q); ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), q.r * k, 0, Math.PI * 2); ctx.stroke(); break;
      case 'A': {
        setStroke(q); ctx.beginPath();
        arcPoints(q.x, q.y, q.r, q.a0, q.a1).forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        ctx.stroke(); break;
      }
      case 'F':
        ctx.fillStyle = ink; ctx.setLineDash([]); ctx.beginPath();
        q.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        ctx.closePath(); ctx.fill(); break;
      case 'T': {
        const fs = q.h / CAP * k;
        if (fs < 1.2) break;
        ctx.save();
        ctx.translate(X(q.x), Y(q.y));
        ctx.rotate(-q.rot * Math.PI / 180);
        ctx.font = `italic ${fs}px ${FONT}, "DejaVu Sans", sans-serif`;
        ctx.fillStyle = ink;
        ctx.textAlign = q.anchor === 'c' ? 'center' : q.anchor === 'r' ? 'right' : 'left';
        ctx.textBaseline = 'alphabetic';
        const dy = q.va === 'm' ? q.h / 2 * k : q.va === 't' ? q.h * k : 0;
        ctx.fillText(q.text, 0, dy);
        ctx.restore();
        break;
      }
    }
  }
  ctx.restore();
}

// Рендер в картинку (dataURL)
export function sheetToImage(sheet, dpi = 200, type = 'image/jpeg') {
  const k = dpi / 25.4;
  const w = Math.round(sheet.W * k), h = Math.round(sheet.H * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  drawSheet(ctx, sheet, { k, ox: 0, oy: h }, { minPx: 1 });
  const url = c.toDataURL(type, 0.93);
  c.width = c.height = 0;
  return url;
}
