import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const port=18166;
const child=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve('tmp/battle-browser-profile-v466')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
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


  for(const width of [1000,540,390]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:1050,deviceScaleFactor:1,mobile:false});
    await navigate('tmp/ui-v466/index.html');
    const formations=[];
    for(const count of [1,2,3,4,5]) {
      await evaluate('fixture.formation('+count+')');
      const positions=await evaluate(`(()=>{const p=document.getElementById('stage-enemy-party').getBoundingClientRect();return Array.from(document.querySelectorAll('#stage-enemy-party [data-enemy-id]')).map(e=>({id:e.dataset.enemyId,x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right,gap:p.right-e.getBoundingClientRect().right}));})()`);
      const first=positions.find(e=>e.id==='formation_0');assert.ok(first.gap<2,JSON.stringify({count,width,positions}));
      const byId=[...positions].sort((a,b)=>a.id.localeCompare(b.id));for(let i=1;i<byId.length;i++)assert.ok(byId[i].x<byId[i-1].x);
      if(count>1){await evaluate('fixture.formation('+count+',0)');const survivor=await evaluate("document.querySelector('#stage-enemy-party [data-enemy-id=formation_1]').getBoundingClientRect().x");assert.ok(Math.abs(survivor-byId[1].x)<1,'death must not move survivor');}
      formations.push({count,rightGap:first.gap});
    }
    await navigate('tmp/ui-v466/index.html');
    const handFlavor=await evaluate(`(()=>{const card=document.querySelector('#hand-cards .mwg-card');const footer=card.querySelector('.card-flavor-footer');const text=footer.querySelector('.card-flavor-text');return {display:getComputedStyle(text).display,height:text.getBoundingClientRect().height,line:parseFloat(getComputedStyle(text).lineHeight),below:footer.getBoundingClientRect().top>=card.querySelector('.card-rules').getBoundingClientRect().bottom-1};})()`);
    assert.notEqual(handFlavor.display,'none');assert.ok(handFlavor.height>0&&handFlavor.height<=handFlavor.line*2+1);assert.ok(handFlavor.below);
    assert.match(await evaluate('abilityRules()'),/每回合首次/);
    const protection=await evaluate('protectionDetails()');assert.match(protection.abilityText,/保护.*齿轮/);assert.match(protection.statusText,/齿轮.*分摊/); 
    await evaluate("speak('第一位敌人的台词',{actor:'enemy',id:'first',name:'火焰'});speak('召唤物台词',{actor:'summon',id:'unit_0',name:'机器人'});");
    await pause(300);
    const speech=await evaluate("Array.from(document.querySelectorAll('.battle-speech-bubble')).map(e=>({text:e.textContent,tag:e.tagName,parent:e.parentElement.dataset.enemyId||e.parentElement.dataset.summonId,width:e.getBoundingClientRect().width}))");
    assert.equal(speech.length,2);assert.ok(speech.every(e=>e.tag==='SPAN'));assert.deepEqual(speech.map(e=>e.parent).sort(),['first','unit_0']);
    fs.writeFileSync('tmp/player-feedback-speech-'+width+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
    await evaluate("document.querySelector('.battle-speech-bubble').click()");assert.equal(await evaluate("document.querySelectorAll('.battle-speech-bubble').length"),1);
    const death=await evaluate(`(()=>{const first=document.querySelector('[data-enemy-id="first"]');const second=document.querySelector('[data-enemy-id="second"]');const old=first.getBoundingClientRect(),before=second.getBoundingClientRect();fullAnim.showEnemyDeparture($(first));first.remove();const ghost=document.querySelector('.enemy-departure');const after=second.getBoundingClientRect(),g=ghost.getBoundingClientRect();return {old:old.toJSON(),ghost:g.toJSON(),parent:ghost.offsetParent?.id,delta:Math.hypot(g.x-old.x,g.y-old.y),otherDelta:Math.hypot(after.x-before.x,after.y-before.y)}})()`);
    assert.ok(death.delta<3,JSON.stringify(death));assert.ok(death.otherDelta<1,JSON.stringify(death));
    const queue=await evaluate('rapid()');assert.equal(queue.immediate,3);assert.equal(queue.held,3);assert.equal(queue.remaining,0);assert.deepEqual(queue.trace,['start0','end0','start1','end1','start2','end2']);
    await pause(4000);assert.equal(await evaluate("document.querySelectorAll('.battle-speech-bubble').length"),0);
    evidence.push({width,formations,handFlavor,speech,death,queue});
  }
  await navigate('tmp/ui-v466/index.html');
  await evaluate('fixture.flavorPreview()');
  const flavors=await evaluate(`Array.from(document.querySelectorAll('#flavor-test .card-flavor-text')).map(e=>({display:getComputedStyle(e).display,height:e.getBoundingClientRect().height,line:parseFloat(getComputedStyle(e).lineHeight),preview:!!e.closest('.mwg-card-preview')}))`);
  assert.equal(flavors.length,3);for(const item of flavors){assert.notEqual(item.display,'none');assert.ok(item.height>0);if(!item.preview)assert.ok(item.height<=item.line*2+1);else assert.ok(item.height>item.line*2);}
  evidence.push({flavors});
  await evaluate(`(()=>{document.querySelectorAll('style,link[rel=stylesheet]').forEach(e=>e.remove());const link=document.createElement('link');link.rel='stylesheet';link.href='common.css';document.head.append(link);})()`);
  await pause(500);
  const commonFlavors=await evaluate(`Array.from(document.querySelectorAll('#flavor-test .card-flavor-text')).map(e=>({display:getComputedStyle(e).display,height:e.getBoundingClientRect().height,line:parseFloat(getComputedStyle(e).lineHeight),preview:!!e.closest('.mwg-card-preview')}))`);
  for(const item of commonFlavors){assert.notEqual(item.display,'none');assert.ok(item.height>0);if(!item.preview)assert.ok(item.height<=item.line*2+1);else assert.ok(item.height>item.line*2);}
  evidence.push({commonFlavors});

  const scroll=await evaluate(`(async()=>{const host=document.createElement('div');host.style.cssText='position:fixed;inset:10px;height:400px;width:300px;overflow:auto;background:white;z-index:9999';host.innerHTML='<div style="height:900px">历史</div><iframe style="height:150px;width:100%"></iframe><div style="height:500px">之后</div>';document.body.append(host);const frame=host.querySelector('iframe');host.scrollTop=820;const before=host.scrollTop;await new Promise(r=>setTimeout(r,1200));resizeFrame(frame,'1800px');await new Promise(r=>setTimeout(r,120));const after=host.scrollTop;host.scrollTop=920;resizeFrame(frame,'2200px');const manual=host.scrollTop;host.remove();return {before,after,manual};})()`);
  assert.equal(scroll.after,scroll.before);assert.equal(scroll.manual,920);evidence.push({scroll});
  fs.writeFileSync('tmp/player-feedback-layout.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} finally {ws?.close();child.kill();}
