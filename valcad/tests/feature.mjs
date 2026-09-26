import { writeFileSync, readFileSync } from 'fs';
import { chromium } from 'playwright-core';
import { samples } from './samples.mjs';
import { buildSheet } from '../src/drawing.js';
import { toSVG } from '../src/render/svg.js';
const p = samples().c; p.meta.sheetMode = 'деталь';
const sh = buildSheet(p);
const svg = toSVG(sh).replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%" height="100%" preserveAspectRatio="xMidYMid meet"').replace('<rect', '<rect fill-opacity="0"');
const d3 = readFileSync('/tmp/claude-0/3d_t.png').toString('base64');
const font = 'file:///home/user/bilet/valcad/public/fonts/gost.ttf';
const html = `<html><head><style>
@font-face{font-family:G;src:url(${font})}
body{margin:0;width:1024px;height:500px;overflow:hidden;background:linear-gradient(120deg,#151b24 0%,#1f2b3b 60%,#25354b 100%);font-family:Roboto,'DejaVu Sans',sans-serif;color:#fff;position:relative}
.t{position:absolute;left:52px;top:118px;width:380px}
h1{margin:0;font-size:66px;font-weight:800;letter-spacing:-1px}h1 span{color:#ff9a3c}
p{margin:14px 0 0;font-size:25px;line-height:1.3;color:#cfd8e3}
.tags{margin-top:26px;display:flex;gap:8px;flex-wrap:wrap}.tags b{font-size:16px;font-weight:600;background:#2f4058;border-radius:14px;padding:6px 12px;color:#e8edf3}
.card{position:absolute;right:36px;top:34px;width:${Math.min(540, 300 * sh.W / sh.H)}px;height:300px;background:#fff;border-radius:14px;box-shadow:0 18px 40px rgba(0,0,0,.45);padding:10px}
.d3{position:absolute;right:40px;bottom:18px;width:430px;filter:drop-shadow(0 10px 18px rgba(0,0,0,.6))}
svg text{font-family:G}
</style></head><body>
<div class="t"><h1>Вал<span>CAD</span></h1><p>Чертёж вала по ЕСКД прямо на телефоне</p>
<div class="tags"><b>Размеры</b><b>Сечения</b><b>3D</b><b>DXF · PDF</b></div></div>
<div class="card">${svg}</div>
<img class="d3" src="data:image/png;base64,${d3}">
</body></html>`;
writeFileSync('/tmp/claude-0/feature.html', html);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pg = await b.newPage({ viewport: { width: 1024, height: 500 } });
await pg.goto('file:///tmp/claude-0/feature.html'); await pg.waitForTimeout(600);
await pg.screenshot({ path: '/home/user/bilet/valcad/store/feature_1024x500.png' });
await b.close();
