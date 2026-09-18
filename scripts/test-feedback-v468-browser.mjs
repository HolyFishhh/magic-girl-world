import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const port=18170;
const child=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve('tmp/feedback-browser-v468')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try {
  let targets;
  for(let i=0;i<100;i++){try{targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(targets.length)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(targets?.length,'isolated browser must start');
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});
  ws.on('message',raw=>{const m=JSON.parse(raw);if(m.method==='Runtime.exceptionThrown')console.error(JSON.stringify(m.params));});
  let seq=0;const pending=new Map();ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result)}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await call('Page.enable');await call('Runtime.enable');
  const evidence=[];
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const navigate=async file=>{await call('Page.navigate',{url:'file:///'+resolve(file).replaceAll('\\','/')});await pause(2500);};





  for(const width of [390,1000]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await navigate('tmp/ui-v466/index.html');
    await evaluate("document.getElementById('fixture-controls').style.display='none'");
    const first=await evaluate("fixture.preview('first')");
    assert.match(first.hand,/15↑/);assert.match(first.details,/10点伤害/);assert.equal(first.active,first.actual);
    assert.equal(await evaluate('fixture.previewHit()'),15);
    const second=await evaluate("fixture.preview('second')");
    assert.match(second.hand,/10点伤害/);assert.equal(second.changed,'');assert.equal(second.active,second.actual);
    assert.equal(await evaluate('fixture.previewHit()'),10);
    const reduced=await evaluate("fixture.preview('first',0.5)");assert.match(reduced.changed,/5↓/);assert.equal(await evaluate('fixture.previewHit()'),5);
    await evaluate("fixture.preview('second')");
    const group=await evaluate('fixture.groupBuff()');
    assert.deepEqual(group.holders.sort(),['first','second']);
    assert.deepEqual([...new Set(group.trace.filter(e=>e.side==='enemy').map(e=>e.id))].sort(),['first','second']);
    await pause(1200);
    await evaluate('fixture.select()');await pause(350);
    const sizes=await evaluate(`Array.from(document.querySelectorAll('.selection-card .mwg-card')).map(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,overflow:e.scrollWidth>e.clientWidth+1}})`);
    assert.equal(sizes.length,4);assert.ok(Math.max(...sizes.map(s=>s.h))-Math.min(...sizes.map(s=>s.h))<2,JSON.stringify(sizes));
    assert.ok(Math.max(...sizes.map(s=>s.w))-Math.min(...sizes.map(s=>s.w))<2,JSON.stringify(sizes));assert.ok(sizes.every(s=>!s.overflow));
    await evaluate("document.querySelector('.selection-card').click()");
    assert.equal(await evaluate("document.querySelector('.selection-card').getAttribute('aria-pressed')"),'true');
    const selected=await evaluate("getComputedStyle(document.querySelector('.selection-card'),'::after').content");assert.match(selected,/已选/);
    fs.writeFileSync('tmp/selection-v468-'+width+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate("document.querySelector('.cancel-selection').click()");await pause(350);
    await evaluate('fixture.victory()');await pause(450);
    const banner=await evaluate(`(()=>{const e=document.querySelector('.battle-end-dialog'),p=e.querySelector('.battle-end-panel');return {visible:getComputedStyle(p).opacity,title:e.querySelector('h2').textContent,tokens:document.querySelectorAll('.stage-action-token').length,settled:window.settled}})()`);
    assert.ok(Number(banner.visible)>.98);assert.equal(banner.tokens,0);assert.equal(banner.settled,0);
    fs.writeFileSync('tmp/victory-v468-'+width+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await pause(350);assert.equal(await evaluate('window.settled'),1);assert.equal(await evaluate("document.querySelectorAll('.battle-end-dialog').length"),1,'banner remains while settlement is pending');
    await evaluate('releaseVictory()');await pause(80);assert.equal(await evaluate("document.querySelectorAll('.battle-end-dialog').length"),0);
    evidence.push({width,first,second,group,sizes,banner});
  }
  await evaluate('fixture.victory(true)');await pause(750);await evaluate('releaseVictory()');await pause(80);
  assert.equal(await evaluate("document.querySelector('.battle-end-confirm').disabled"),false);assert.match(await evaluate("document.querySelector('.battle-end-error').textContent"),/重试/);
  fs.writeFileSync('tmp/feedback-v468-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} finally {ws?.terminate();child.kill();}
