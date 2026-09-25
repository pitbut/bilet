import { LW, DASH } from './common.js';
import { CAP } from '../prims.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toSVG(sheet, opts = {}) {
  const { W, H, prims } = sheet;
  const out = [];
  const Y = y => H - y;
  const st = q => {
    const w = LW[q.w] || LW.main;
    const d = DASH[q.s];
    return `stroke="#000" stroke-width="${w}" fill="none"${d ? ` stroke-dasharray="${d.join(' ')}"` : ''} stroke-linecap="round"`;
  };
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  if (opts.fontUrl) out.push(`<style>@font-face{font-family:G;src:url(${opts.fontUrl})}</style>`);
  for (const q of prims) {
    if (q.layer === 'hl' && !opts.highlight) continue;
    switch (q.t) {
      case 'L': out.push(`<line x1="${q.x1}" y1="${Y(q.y1)}" x2="${q.x2}" y2="${Y(q.y2)}" ${st(q)}/>`); break;
      case 'P': out.push(`<${q.closed ? 'polygon' : 'polyline'} points="${q.pts.map(([x, y]) => x.toFixed(3) + ',' + Y(y).toFixed(3)).join(' ')}" ${st(q)}/>`); break;
      case 'C': out.push(`<circle cx="${q.x}" cy="${Y(q.y)}" r="${q.r}" ${st(q)}/>`); break;
      case 'A': {
        const a0 = q.a0 * Math.PI / 180, a1 = q.a1 * Math.PI / 180;
        const x1 = q.x + q.r * Math.cos(a0), y1 = Y(q.y + q.r * Math.sin(a0));
        const x2 = q.x + q.r * Math.cos(a1), y2 = Y(q.y + q.r * Math.sin(a1));
        const large = Math.abs(q.a1 - q.a0) > 180 ? 1 : 0;
        out.push(`<path d="M${x1} ${y1} A${q.r} ${q.r} 0 ${large} 0 ${x2} ${y2}" ${st(q)}/>`);
        break;
      }
      case 'F': out.push(`<polygon points="${q.pts.map(([x, y]) => x + ',' + Y(y)).join(' ')}" fill="${q.layer === 'hl' ? 'rgba(255,120,0,0.25)' : '#000'}" stroke="none"/>`); break;
      case 'T': {
        const fs = q.h / CAP;
        const anchor = q.anchor === 'c' ? 'middle' : q.anchor === 'r' ? 'end' : 'start';
        const dy = q.va === 'm' ? q.h / 2 : q.va === 't' ? q.h : 0;
        out.push(`<text x="${q.x}" y="${Y(q.y)}" font-family="G, DejaVu Sans Condensed, sans-serif" font-style="italic" font-size="${fs.toFixed(3)}" text-anchor="${anchor}" transform="rotate(${-q.rot} ${q.x} ${Y(q.y)})" dy="${dy}">${esc(q.text)}</text>`);
        break;
      }
    }
  }
  out.push('</svg>');
  return out.join('\n');
}
