import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const port=18161, out=resolve('tmp/common-removal-v461-evidence'); fs.mkdirSync(out,{recursive:true});
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve('tmp/common-removal-browser-profile-v461')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try {
  let pages; for(let i=0;i<100;i++){try{pages=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(pages.length)break;}catch{} await new Promise(r=>setTimeout(r,100));} assert.ok(pages?.length,'isolated Edge starts');
  ws=new WebSocket(pages.find(x=>x.type==='page').webSocketDebuggerUrl); await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});
  let id=0; const waiters=new Map; ws.on('message',raw=>{const x=JSON.parse(raw);if(x.id){const p=waiters.get(x.id);waiters.delete(x.id);x.error?p.reject(x.error):p.resolve(x.result)}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;waiters.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
  const evalJs=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
  const pause=ms=>new Promise(r=>setTimeout(r,ms)); await call('Page.enable'); await call('Runtime.enable');
  const waitForFixture=async()=>{for(let attempt=0;attempt<60;attempt++){if(await evalJs("Boolean(window.fixture && document.querySelector('#mwg-status-fold'))"))return;await pause(100);}assert.fail('isolated common fixture did not finish rendering');};
  const shot=async name=>fs.writeFileSync(resolve(out,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  const evidence=[];
  await call('Emulation.setDeviceMetricsOverride',{width:1180,height:900,deviceScaleFactor:1,mobile:false}); await call('Page.navigate',{url:'file:///'+resolve('tmp/common-removal-v461/index.html').replaceAll('\\','/')}); await waitForFixture();
  await evalJs("document.querySelector('#tower-player-resolve-removals').click()"); await pause(100); assert.equal(await evalJs("document.querySelectorAll('.non-combat-selection-option').length"),2); await shot('selector-open');
  if(process.env.SELECTOR_ONLY){console.log(JSON.stringify({selector:{options:2}}));process.exitCode=0;}
  else {
  console.log('selector open');
  await evalJs("document.querySelector('[data-choice-index=\"0\"]').click();[...document.querySelectorAll('.non-combat-selection-footer button')].find(x=>x.textContent==='确认选择').click()"); await pause(150);
  console.log('selector confirmed');
  let result=await evalJs("({ids:fixture.stat().battle.cards.map(x=>x.runInstanceId),remaining:fixture.stat().battle.core.card_removal_count,revision:fixture.stat().run_transaction_revision,error:window.__fixtureCommitError})"); assert.deepEqual(result.ids,['keep-long']); assert.equal(result.remaining,0); assert.equal(result.revision,1); assert.equal(result.error,undefined);
  await evalJs("fixture.setRemovals(2);void fixture.offer();'started'"); await pause(100); await evalJs("document.querySelector('.non-combat-selection-footer button').click()"); await pause(80); result=await evalJs("({remaining:fixture.stat().battle.core.card_removal_count,count:fixture.stat().battle.cards.length})"); assert.deepEqual(result,{remaining:2,count:1});
  await evalJs("void fixture.offer();'started'"); await pause(80); await evalJs("document.querySelector('[data-choice-index=\"0\"]').click();[...document.querySelectorAll('.non-combat-selection-footer button')].find(x=>x.textContent==='确认选择').click()"); await pause(100); result=await evalJs("({remaining:fixture.stat().battle.core.card_removal_count,count:fixture.stat().battle.cards.length})"); assert.deepEqual(result,{remaining:1,count:0}); await shot('selector-confirmed');
  fs.writeFileSync(resolve(out,'result.json'),JSON.stringify({evidence,transactions:{exactRemoval:true,cancelPreserves:true,multiCount:true}},null,2)); console.log(JSON.stringify({evidence,transactions:{exactRemoval:true,cancelPreserves:true,multiCount:true}}));
  }
} finally {ws?.terminate();edge.kill();}
