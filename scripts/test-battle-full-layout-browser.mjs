import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const port=18160;
const child=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve('tmp/battle-browser-profile-v460')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
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
    await navigate('tmp/ui-v460/index.html');
    const data=await evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}}; const hp=document.querySelector('#player-hp');return {hp:{text:hp.textContent,rect:rect(hp),css:getComputedStyle(hp).cssText,color:getComputedStyle(hp).color,z:getComputedStyle(hp).zIndex},cards:[...document.querySelectorAll('#hand-cards>.mwg-card')].map(rect),hand:rect(document.querySelector('#hand-cards')),player:rect(document.querySelector('.player-section')),center:rect(document.querySelector('.center-battle-area')),slots:[...document.querySelector('#stage-enemy-party').children].map(e=>e.dataset.enemyId||'empty')}})()`);
    assert.deepEqual(data.slots,['empty','extra1','extra0','second','first']);
    for(const count of [1,2,4]) {
      await evaluate('fixture.layout('+count+')');
      const boxes=await evaluate("(()=>{const p=document.querySelector('#stage-enemy-party').getBoundingClientRect();return {left:p.left,right:p.right,actors:[...document.querySelectorAll('#stage-enemy-party .stage-enemy-member')].map(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.enemyId,left:r.left,right:r.right}})}})()");
      assert.equal(boxes.actors.length,count);assert.equal(boxes.actors.at(-1).id,'first');
      assert.ok(Math.abs(boxes.actors.at(-1).right-boxes.right)<3,JSON.stringify(boxes));
      for(const box of boxes.actors)assert.ok(box.left>=boxes.left-1&&box.right<=boxes.right+1,JSON.stringify(boxes));
    }
    await evaluate('fixture.appearance(true)');
    const details=await evaluate("document.querySelector('.status-detail-modal').textContent");
    assert.ok(details.includes('堕落能量'));assert.ok(details.includes('回合开始'));assert.ok(details.includes('😈'));
    assert.ok(!/corruption_energy|turn_start|keep/.test(details),details);
    assert.equal(await evaluate("document.querySelector('#stage-player-emoji').textContent"),'😈');
    await pause(250);
    fs.writeFileSync('tmp/v460-status-'+width+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
    await evaluate("document.querySelector('.status-detail-modal').remove();fixture.appearance(false)");
    assert.notEqual(await evaluate("document.querySelector('#stage-player-emoji').textContent"),'😈');
    assert.equal(data.hp.text,'70/70');assert.ok(data.hp.rect.height>=24);
    assert.equal(data.cards.length,5);
    for(const card of data.cards) {assert.ok(card.bottom<=data.hand.bottom,JSON.stringify(data));assert.ok(card.bottom<data.player.top,JSON.stringify(data));assert.ok(card.top>=data.hand.top,JSON.stringify(data));}
    await evaluate("speak('<img src=x onerror=alert(1)> 守护你！', '卫兵'); speak('很长的台词'.repeat(30), '玩家')");
    const speech=await evaluate("(()=>{const e=document.querySelector('#battle-dialogue');return {text:e.textContent,images:e.querySelectorAll('img').length,height:e.getBoundingClientRect().height,width:e.scrollWidth,client:e.clientWidth}})()");
    assert.ok(speech.text.includes('<img src=x'));assert.equal(speech.images,0);assert.equal(speech.height,68);assert.ok(speech.width<=speech.client+1);
    fs.writeFileSync('tmp/v460-full-baseline-'+width+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
    await evaluate("fullAnim.updateHealthBarWithAnimation('player',35,70,undefined,0,70)");
    assert.equal(await evaluate("document.querySelector('#player-hp').textContent"),'35/70');
    assert.equal(await evaluate("document.querySelector('.player-card .hp-fill').style.width"),'50%');
    const hpHit=await evaluate("(()=>{const e=document.querySelector('#player-hp'),r=e.getBoundingClientRect();return document.elementsFromPoint(r.left+r.width/2,r.top+r.height/2).some(x=>x===e)})()");assert.ok(hpHit,'HP text participates in visible hit stack');
    await evaluate("(async()=>{await fullAnim.animateEnemyDefeat('first');const s=window.fixture;const party=[...document.querySelectorAll('#stage-enemy-party .stage-enemy-member')];const dead=party.find(e=>e.dataset.enemyId==='first');fullAnim.showEnemyDeparture(window.$(dead));fullUI.updateEnemyStageParty([],null)})()");
    assert.equal(await evaluate("document.querySelectorAll('.enemy-departure').length"),1);
    assert.equal(await evaluate("document.querySelectorAll('.enemy-departure [id],.enemy-departure[data-enemy-id]').length"),0);
    await pause(400);
    assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.enemy-departure')).animationName"),'none');
    fs.writeFileSync('tmp/v460-full-death-'+width+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
    await pause(1800);assert.equal(await evaluate("document.querySelectorAll('.enemy-departure').length"),0);
    evidence.push({width,...data,healthAnimation:true,deathCleanup:true});
    fs.writeFileSync('tmp/v460-full-'+width+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  }
  fs.writeFileSync('tmp/v460-full-layout.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} finally {ws?.close();child.kill();}
