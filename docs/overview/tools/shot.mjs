// dùng: node shot.mjs out_dir t1 t2 ...   (chụp khung hình tại các thời điểm giây)
import puppeteer from 'puppeteer-core';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const [,, out, ...ts] = process.argv;
mkdirSync(out,{recursive:true});
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--hide-scrollbars']});
const p = await b.newPage();
p.on('pageerror',e=>console.log('PAGEERROR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
await p.setViewport({width:1920,height:1080});
await p.goto('file://'+resolve('../deck/index.html')+'?rec=1',{waitUntil:'networkidle0'});
await p.evaluate(()=>window.ready());
for(const t of ts){await p.evaluate(x=>window.seek(x),+t);await p.screenshot({path:`${out}/t${String(t).padStart(6,'0')}.png`});}
await b.close();
console.log('done',ts.length);
