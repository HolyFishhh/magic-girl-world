import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
process.env.MWG_PRESENTATION_HTML='tmp/mobile-rewards.html';
await import('./test-unified-content-presentation.mjs');
delete process.env.MWG_PRESENTATION_HTML;
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




  for(const width of [320,360,390,430,540,1000]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
    await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await navigate('tmp/ui-v466/index.html');
    await evaluate("document.getElementById('fixture-controls').style.display='none';fixture.formation(5);enablePhoneCards()");
    const dimensions=await evaluate(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right}};const cards=[...document.querySelectorAll('#hand-cards>.mwg-card')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,w:r.width,scroll:e.scrollWidth,client:e.clientWidth}});const title=document.querySelector('#hand-cards>.mwg-card .card-name'),rules=document.querySelector('#hand-cards>.mwg-card .card-rules');return {stage:rect('#battle-stage'),hand:rect('#hand-cards'),center:rect('.center-battle-area'),scene:rect('#battle-scene'),pile:rect('.battle-pile-dock'),controls:rect('.bottom-controls'),endTurn:rect('.end-turn-button'),overflow:document.documentElement.scrollWidth,innerWidth:innerWidth,card:cards[0],cards,title:{scroll:title.scrollWidth,client:title.clientWidth,height:title.clientHeight,fullHeight:title.scrollHeight,text:title.textContent},rules:{height:rules.clientHeight,fullHeight:rules.scrollHeight,overflow:getComputedStyle(rules).overflowY},touch:getComputedStyle(document.querySelector('#hand-cards .mwg-card')).touchAction,actors:[...document.querySelectorAll('#stage-enemy-party [data-enemy-id]')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,w:r.width}})};})()`);
    assert.ok(dimensions.overflow<=width,JSON.stringify({width,dimensions}));
    if(width<=760){
      assert.ok(dimensions.hand.h<=166,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.scene.h<=800&&dimensions.controls.bottom<=844,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.hand.y<=410,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.actors.every(a=>a.x>=dimensions.stage.x&&a.right<=dimensions.stage.right+1),JSON.stringify({width,dimensions}));
      assert.ok(dimensions.stage.h<300,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.hand.y<520,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.card.w<=92 && dimensions.card.w>=60,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.card.x>=dimensions.hand.x&&dimensions.card.right<=dimensions.hand.right+1,JSON.stringify({width,dimensions}));
      const visibleCards=width>=430?5:4;
      assert.ok(dimensions.cards[visibleCards-1].right<=dimensions.hand.right+1,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.card.scroll<=dimensions.card.client+1,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.title.height>=20&&dimensions.title.height<=30,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.rules.height>30&&dimensions.rules.overflow==='auto',JSON.stringify({width,dimensions}));
      assert.match(dimensions.title.text,/长名称/);assert.equal(dimensions.touch,'pan-x');
      assert.ok(dimensions.endTurn.w>=76&&dimensions.endTurn.h>=36,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.pile.h<=80&&dimensions.controls.h>=40,JSON.stringify({width,dimensions}));
      const h=dimensions.hand;
      await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:h.x+h.w-35,y:h.y+35}]});
      for(let step=1;step<=12;step++){await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:h.x+h.w-35-h.w*.62*step/12,y:h.y+35}]});await pause(25);}
      await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(500);
      const swipe=await evaluate(`({scroll:document.querySelector('#hand-cards').scrollLeft,count:document.querySelectorAll('#hand-cards>.mwg-card').length,flights:document.querySelectorAll('.card-cast-flight').length})`);
      if(width<430) assert.ok(swipe.scroll>20,JSON.stringify({width,swipe}));
      else assert.ok(swipe.scroll>=0,JSON.stringify({width,swipe}));
      assert.equal(swipe.count,5);assert.equal(swipe.flights,0);
      evidence.push({width,dimensions,swipe});
      await evaluate("document.querySelector('#hand-cards').scrollLeft=0");
      await pause(250);
      fs.writeFileSync('tmp/mobile-final-'+width+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
      await evaluate('fixture.select()');await pause(150);
      const modal=await evaluate(`(()=>{const e=document.querySelector('.card-selection-modal .modal-content'),r=e.getBoundingClientRect();return {x:r.x,w:r.width,h:r.height,scroll:e.scrollWidth,client:e.clientWidth,cards:document.querySelectorAll('.selection-card').length};})()`);
      assert.ok(modal.x>=0 && modal.x+modal.w<=width);assert.ok(modal.h<=844*.89);assert.ok(modal.scroll<=modal.client+1);assert.equal(modal.cards,4);
      await evaluate("document.querySelector('.cancel-selection').click()");await pause(350);
      assert.equal(await evaluate("document.querySelectorAll('.card-selection-modal').length"),0,'selection cancel closes dialog');
      await evaluate('fixture.appearance(true)');await pause(250);
      const status=await evaluate(`(()=>{const el=document.querySelector('.status-detail-content'),r=el.getBoundingClientRect(),b=el.querySelector('.close-status-detail').getBoundingClientRect();return {x:r.x,w:r.width,h:r.height,scroll:el.scrollWidth,client:el.clientWidth,close:b.width};})()`);
      assert.ok(status.x>=0&&status.x+status.w<=width);assert.ok(status.scroll<=status.client+1);assert.ok(status.close>=36);assert.ok(status.h<=844*.89);
      await evaluate("document.querySelector('.close-status-detail').click()");await pause(250);
      assert.equal(await evaluate("document.querySelectorAll('.status-detail-modal').length"),0);
      evidence.push({width,modal,status});
      if(width===390){
        await evaluate("document.querySelector('#hand-cards').scrollLeft=0");await pause(250);
        const rulePoint=await evaluate(`(()=>{const e=document.querySelector('#hand-cards .card-rules'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height-8};})()`);
        await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[rulePoint]});
        for(let i=1;i<=8;i++){await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rulePoint.x,y:rulePoint.y-i*8}]});await pause(25);}
        await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(300);
        const ruleScroll=await evaluate(`({top:document.querySelector('#hand-cards .card-rules').scrollTop,cards:document.querySelectorAll('#hand-cards>.mwg-card').length,flights:document.querySelectorAll('.card-cast-flight').length})`);
        assert.ok(ruleScroll.top>20,JSON.stringify(ruleScroll));assert.equal(ruleScroll.cards,5);assert.equal(ruleScroll.flights,0);
        await evaluate("document.querySelector('#hand-cards').scrollLeft=0;window.phonePlays=0;$('#hand-cards>.mwg-card').on('mwg:play-card',()=>window.phonePlays++)");await pause(250);
        const point=await evaluate(`(()=>{const r=document.querySelector('#hand-cards>.mwg-card').getBoundingClientRect(),s=document.querySelector('#battle-stage').getBoundingClientRect();return {x:r.x+60,y:r.y+60,end:s.y+s.height/2};})()`);
        await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});
        for(let i=1;i<=10;i++){await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y+(point.end-point.y)*i/10}]});await pause(25);}
        await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(350);
        const drag=await evaluate(`({plays:window.phonePlays,flights:document.querySelectorAll('.card-cast-flight').length})`);
        assert.equal(drag.plays,1,JSON.stringify(drag));assert.equal(drag.flights,1);evidence.push({width,drag});
      }

    } else evidence.push({width,dimensions});
  }

  for(const width of [320,390,430]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
    await navigate('tmp/mobile-rewards.html');
    const rewards=await evaluate(`(()=>{const el=document.querySelector('.mwg-card-choice'),card=el.querySelector('.mwg-card');el.classList.add('is-selected');const e=getComputedStyle(el),c=getComputedStyle(card);return {page:document.documentElement.scrollWidth,width:innerWidth,outerShadow:e.boxShadow,outerBorder:e.borderWidth,cardShadow:c.boxShadow,cardWidth:card.getBoundingClientRect().width,count:document.querySelectorAll('.mwg-card-choice').length};})()`);
    assert.ok(rewards.page<=width);assert.equal(rewards.count,3);assert.equal(rewards.outerShadow,'none');assert.equal(rewards.outerBorder,'0px');assert.notEqual(rewards.cardShadow,'none');assert.ok(rewards.cardWidth>=55&&rewards.cardWidth<=110,JSON.stringify({width,rewards}));evidence.push({width,rewards});
    fs.writeFileSync('tmp/mobile-reward-'+width+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  fs.writeFileSync('tmp/mobile-final.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));

} finally {ws?.close();child.kill();}
