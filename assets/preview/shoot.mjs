import {chromium} from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:2050,height:1200}});
for (const [name,s] of [['industries-1','agro,forest,metal,auto'],['industries-2','tourism,gas,oil,finance'],['others','others']]) {
  await p.goto('http://localhost:8766/preview/sheet.html?s='+s); await p.waitForFunction(()=>document.title==='done',null,{timeout:180000});
  await p.locator('body').screenshot({path:`preview/${name}.png`}); }
await b.close();
