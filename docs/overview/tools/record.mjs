// dùng: node record.mjs out.mp4 [start=0] [end=360] [fps=30]
import puppeteer from 'puppeteer-core';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const [,, out, a='0', b='360', f='30'] = process.argv;
const start=+a,end=+b,fps=+f,N=Math.round((end-start)*fps);
const br = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--hide-scrollbars']});
const p = await br.newPage();
p.on('pageerror',e=>console.log('PAGEERROR',e.message));
await p.setViewport({width:1920,height:1080});
await p.goto('file://'+resolve('../deck/index.html')+'?rec=1',{waitUntil:'networkidle0'});
await p.evaluate(()=>window.ready());
const ff = spawn('ffmpeg',['-y','-f','image2pipe','-framerate',String(fps),'-c:v','mjpeg','-i','-','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',out],{stdio:['pipe','inherit','inherit']});
const t0=Date.now();
for(let i=0;i<N;i++){
  await p.evaluate(t=>window.seek(t),start+i/fps);
  const buf=await p.screenshot({type:'jpeg',quality:94});
  if(!ff.stdin.write(buf))await new Promise(r=>ff.stdin.once('drain',r));
  if(i%300===0)console.log(`frame ${i}/${N}  ${((Date.now()-t0)/1000).toFixed(0)}s`);
}
ff.stdin.end();await new Promise(r=>ff.on('close',r));await br.close();
console.log('xong',out,((Date.now()-t0)/1000).toFixed(0)+'s');
