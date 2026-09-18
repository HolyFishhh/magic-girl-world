import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const port=18175, out=resolve('tmp/pile-reward-v471-evidence'); fs.mkdirSync(out,{recursive:true});
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve('tmp/pile-reward-browser-v471')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try {
  let pages; for(let i=0;i<100;i++){try{pages=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(pages.length)break;}catch{} await new Promise(r=>setTimeout(r,100));} assert.ok(pages?.length,'isolated Edge starts');
  ws=new WebSocket(pages.find(x=>x.type==='page').webSocketDebuggerUrl); await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});
  let id=0; const waiters=new Map; ws.on('message',raw=>{const x=JSON.parse(raw);if(x.id){const p=waiters.get(x.id);waiters.delete(x.id);x.error?p.reject(x.error):p.resolve(x.result)}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;waiters.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
  const evalJs=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
  const pause=ms=>new Promise(r=>setTimeout(r,ms)); await call('Page.enable'); await call('Runtime.enable');

  const shot=async name=>fs.writeFileSync(resolve(out,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  const evidence=[];
  for(const width of [390,1000]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:'file:///'+resolve('tmp/ui-v466/index.html').replaceAll('\\','/')});
    for(let i=0;i<80;i++){if(await evalJs("typeof complexCards==='function'"))break;await pause(100);}
    await evalJs("complexCards();document.querySelector('.hand-section').scrollIntoView({block:'start'})");
    const layout=await evalJs(`(()=>{const h=document.querySelector('.hand-section').getBoundingClientRect(),d=document.querySelector('.battle-pile-dock').getBoundingClientRect(),s=document.querySelector('.pile-stack').getBoundingClientRect();return {gap:d.top-h.bottom,height:d.height,w:s.width,h:s.height,overflow:document.documentElement.scrollWidth>innerWidth,order:[...document.querySelectorAll('.battle-pile-dock [data-pile]')].map(x=>x.dataset.pile)}})()`);
    assert.ok(layout.gap>=0&&layout.gap<20,JSON.stringify(layout));assert.ok(layout.h>layout.w*1.3);assert.ok(layout.w>=50);assert.equal(layout.overflow,false);assert.deepEqual(layout.order,['discard','exhaust','draw']);
    await shot('dock-'+width);
    await evalJs('window.particlePromise=pileFlowTest();void 0');await pause(180);await shot('particles-'+width);
    const particles=await evalJs('particlePromise');
    assert.equal(particles.single,1);assert.equal(particles.realFace,true);assert.equal(particles.proxyEmoji,false);assert.equal(particles.visibleParticles,true);assert.equal(particles.grouped,1);assert.match(particles.text,/5/);assert.equal(particles.left,0);
    assert.equal(await evalJs("document.querySelectorAll('.pile-flow-canvas').length"),0);
    const cardText=await evalJs('statusLinkFixture()');assert.match(cardText,/赋予4层终末标记/);assert.doesNotMatch(cardText,/状态规则|回合开始|最多叠加/);
    const popup=await evalJs(`(()=>{const link=document.querySelector('.collection-card .mwg-status-reference');if(!link)return null;link.click();return document.querySelector('.mwg-status-popover')?.textContent})()`);
    assert.match(popup,/终末标记/);assert.match(popup,/行动前/);
    evidence.push({width,layout,particles,cardText,popup});
  }
  fs.writeFileSync(resolve(out,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{ws?.terminate();edge.kill();}
