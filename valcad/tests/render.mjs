import { writeFileSync, mkdirSync } from 'fs';
import { samples } from './samples.mjs';
import { buildSheet } from '../src/drawing.js';
import { toSVG } from '../src/render/svg.js';
import { chromium } from 'playwright-core';
const out = process.argv[2] || '/tmp/claude-0/-home-user-bilet/fb10bfc9-3e36-50ba-984c-77569bbcd2d1/scratchpad/render';
mkdirSync(out, { recursive: true });
const S = samples();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [k, p] of Object.entries(S)) {
  const t = Date.now();
  const sh = buildSheet(p);
  const svg = toSVG(sh, { fontUrl: 'file:///home/user/bilet/valcad/public/fonts/gost.ttf' });
  writeFileSync(`${out}/${k}.svg`, svg);
  const px = 6;
  await page.setViewportSize({ width: Math.round(sh.W * px), height: Math.round(sh.H * px) });
  await page.setContent(`<html><body style="margin:0">${svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, `width="${sh.W*px}" height="${sh.H*px}"`)}</body></html>`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${k}.png` });
  console.log(k, sh.format, sh.scale, (Date.now() - t) + 'ms', sh.warnings.join('; '), 'mass', sh.mass.toFixed(2));
}
await browser.close();
