import { chromium } from 'playwright-core';
const out = '/tmp/claude-0/-home-user-bilet/fb10bfc9-3e36-50ba-984c-77569bbcd2d1/scratchpad/ui';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1000, height: 600 } });
pg.on('pageerror', e => console.log('ERR', e.message));
for (const k of process.argv.slice(2)) {
  await pg.goto('http://localhost:5174/t3d.html?k=' + k);
  await pg.waitForFunction(() => window.done, null, { timeout: 60000 });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${out}/3d_${k}.png` });
}
await b.close();
