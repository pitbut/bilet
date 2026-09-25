import { chromium } from 'playwright-core';
const out = '/tmp/claude-0/-home-user-bilet/fb10bfc9-3e36-50ba-984c-77569bbcd2d1/scratchpad/ui';
import { mkdirSync } from 'fs'; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 412, height: 870 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = [];
pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
await pg.goto('http://localhost:4173/');
await pg.waitForTimeout(1200);
await pg.screenshot({ path: out + '/1_start.png' });
// добавить ступень
await pg.click('text=Добавить ступень');
await pg.waitForTimeout(300);
await pg.screenshot({ path: out + '/2_picker.png' });
await pg.click('.tile:has-text("Шестерня цилиндрическая")');
await pg.waitForTimeout(500);
await pg.screenshot({ path: out + '/3_editor.png' });
await pg.click('.tile:has-text("Шпоночный паз")').catch(()=>{});
await pg.waitForTimeout(300);
await pg.click('.edhead .mini'); // назад к ступени
await pg.waitForTimeout(300);
// на первую ступень добавить шпонку
await pg.click('.edhead .mini');
await pg.click('.item >> nth=0');
await pg.waitForTimeout(300);
await pg.click('.tile:has-text("Шпоночный паз")');
await pg.waitForTimeout(500);
await pg.screenshot({ path: out + '/4_feature.png' });
await pg.click('#tabs button[data-t=innerR]');
await pg.click('text=Добавить элемент отверстия');
await pg.click('.tile:has-text("Резьба внутренняя")');
await pg.waitForTimeout(400);
await pg.click('#tabs button[data-t=sheet]');
await pg.waitForTimeout(300);
await pg.screenshot({ path: out + '/5_sheet.png' });
await pg.click('#btnView'); await pg.waitForTimeout(400);
await pg.click('#btnView'); await pg.waitForTimeout(400);
await pg.screenshot({ path: out + '/6_section.png' });
await pg.click('#mode2d3d button[data-m="3d"]');
await pg.waitForTimeout(3500);
await pg.screenshot({ path: out + '/7_3d.png' });
await pg.click('#btnCut3d'); await pg.waitForTimeout(2500);
await pg.screenshot({ path: out + '/8_3dcut.png' });
await pg.click('#mode2d3d button[data-m="2d"]');
await pg.click('#tabs button[data-t=file]');
await pg.waitForTimeout(500);
await pg.screenshot({ path: out + '/9_file.png' });
// экспорт — через download
for (const f of ['DXF', 'PDF', 'JPG']) {
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 15000 }).catch(e => null), pg.click(`.exp:nth-of-type(2) .btn:has-text("${f}")`)]);
  if (dl) { await dl.saveAs(out + '/export.' + f.toLowerCase()); console.log('saved', f); } else console.log('no download', f);
}
console.log(errs.join('\n'));
await b.close();
