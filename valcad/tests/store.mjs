import { chromium } from 'playwright-core';
import { samples } from './samples.mjs';
const out = '/home/user/bilet/valcad/store';
const S = samples();
const demo = S.a; demo.meta.name = 'Вал-шестерня'; demo.meta.view = 'полуразрез'; demo.meta.sheetMode = 'деталь';
demo.meta.developer = 'Иванов'; demo.meta.checker = 'Петров';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
await pg.addInitScript(p => { if (!localStorage.getItem('valcad.last')) { localStorage.setItem('valcad.projects.v1', JSON.stringify({ demo: p })); localStorage.setItem('valcad.last', 'demo'); } }, demo);
await pg.goto('http://localhost:4173/');
await pg.waitForTimeout(1500);
const shot = async n => { await pg.waitForTimeout(700); await pg.screenshot({ path: `${out}/screen_${n}.png` }); };
await shot(1);                                   // список ступеней + чертёж
await pg.click('.item >> nth=3'); await shot(2);  // редактор шестерни
await pg.click('.edhead .mini');
await pg.click('text=Добавить ступень'); await shot(3); // выбор элементов
await pg.click('#modal', { position: { x: 10, y: 10 } });
await pg.click('#btnSheet'); await pg.waitForTimeout(500);
await pg.click('#btnBig'); await shot(4);         // лист целиком
await pg.click('#btnBig'); await pg.click('#btnSheet');
await pg.click('#tabs button[data-t=sections]'); await shot(5); // сечения
await pg.click('#mode2d3d button[data-m="3d"]'); await pg.waitForTimeout(4000); await shot(6); // 3D
await pg.click('#mode2d3d button[data-m="2d"]');
await pg.click('#tabs button[data-t=file]'); await shot(7);   // экспорт
await b.close();
