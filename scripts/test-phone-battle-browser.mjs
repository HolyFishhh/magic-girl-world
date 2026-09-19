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
    const dimensions=await evaluate(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right}};const cards=[...document.querySelectorAll('#hand-cards>.mwg-card')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,w:r.width,h:r.height,scroll:e.scrollWidth,client:e.clientWidth}});const title=document.querySelector('#hand-cards>.mwg-card .card-name'),rules=document.querySelector('#hand-cards>.mwg-card .card-rules'),detail=document.querySelector('#hand-cards>.mwg-card .card-preview-trigger');return {stage:rect('#battle-stage'),hand:rect('#hand-cards'),center:rect('.center-battle-area'),scene:rect('#battle-scene'),pile:rect('.battle-pile-dock'),controls:rect('.bottom-controls'),endTurn:rect('.end-turn-button'),overflow:document.documentElement.scrollWidth,innerWidth:innerWidth,card:cards[0],cards,title:{scroll:title.scrollWidth,client:title.clientWidth,height:title.clientHeight,fullHeight:title.scrollHeight,text:title.textContent},rules:{height:rules.clientHeight,fullHeight:rules.scrollHeight,overflow:getComputedStyle(rules).overflowY,font:parseFloat(getComputedStyle(rules).fontSize)},detail:{text:detail.textContent,w:detail.getBoundingClientRect().width,h:detail.getBoundingClientRect().height},touch:getComputedStyle(document.querySelector('#hand-cards .mwg-card')).touchAction,actors:[...document.querySelectorAll('#stage-enemy-party [data-enemy-id]')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,w:r.width}})};})()`);
    assert.ok(dimensions.overflow<=width,JSON.stringify({width,dimensions}));
    if(width<=760){
      assert.ok(dimensions.hand.h<=222,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.scene.h<=844&&dimensions.controls.bottom<=844,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.hand.y<=410,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.actors.every(a=>a.x>=dimensions.stage.x&&a.right<=dimensions.stage.right+1),JSON.stringify({width,dimensions}));
      assert.ok(dimensions.stage.h<300,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.hand.y<520,JSON.stringify({width,dimensions}));
      assert.ok(Math.abs(dimensions.card.w-140)<1&&Math.abs(dimensions.card.h-210)<1,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.card.x>=dimensions.hand.x&&dimensions.card.right<=dimensions.hand.right+1,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.cards[1].right<=dimensions.hand.right+1,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.card.scroll<=dimensions.card.client+1,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.title.height>=26&&dimensions.title.height<=30,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.rules.height>30&&dimensions.rules.overflow==='auto'&&dimensions.rules.font>=10,JSON.stringify({width,dimensions}));
      assert.equal(dimensions.detail.text,'详情');assert.ok(dimensions.detail.w>=36&&dimensions.detail.h>=24,JSON.stringify({width,dimensions}));
      assert.match(dimensions.title.text,/长名称/);assert.equal(dimensions.touch,'pan-x');
      assert.ok(dimensions.endTurn.w>=76&&dimensions.endTurn.h>=36,JSON.stringify({width,dimensions}));
      assert.ok(dimensions.pile.h<=80&&dimensions.controls.h>=40,JSON.stringify({width,dimensions}));
      if(width===390){
        await evaluate("document.querySelector('#hand-cards .card-preview-trigger').click()");await pause(100);
        const preview=await evaluate(`(()=>{const p=document.querySelector('.mwg-card-preview'),r=p.getBoundingClientRect(),rules=p.querySelector('.card-rules');return {x:r.x,right:r.right,w:r.width,h:r.height,font:parseFloat(getComputedStyle(rules).fontSize),text:p.textContent}})()`);
        assert.ok(preview.x>=0&&preview.right<=width&&preview.w>=280&&preview.font>=13,JSON.stringify(preview));assert.match(preview.text,/完整长名称/);
        await evaluate("document.querySelector('.mwg-card-preview > button').click()");
        await evaluate("window.statusLinkFixture()");await pause(100);
        const statusCard=await evaluate(`(()=>{const e=document.querySelector('#mwg-status-fold .collection-card .mwg-card'),r=e.getBoundingClientRect(),rules=e.querySelector('.card-rules');return {w:r.width,h:r.height,font:parseFloat(getComputedStyle(rules).fontSize),detail:e.querySelector('.card-preview-trigger')?.textContent,page:document.documentElement.scrollWidth}})()`);
        assert.ok(Math.abs(statusCard.w-dimensions.card.w)<1&&Math.abs(statusCard.h-dimensions.card.h)<1,JSON.stringify({dimensions,statusCard}));
        assert.ok(statusCard.font>=10);assert.equal(statusCard.detail,'详情');assert.ok(statusCard.page<=width);
        evidence.push({width,preview,statusCard});
      }
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
    const rewards=await evaluate(`(()=>{const list=document.querySelector('.mwg-card-choice-list'),el=document.querySelector('.mwg-card-choice'),card=el.querySelector('.mwg-card'),rules=card.querySelector('.card-rules'),detail=card.querySelector('.card-preview-trigger');el.classList.add('is-selected');const e=getComputedStyle(el),c=getComputedStyle(card),r=card.getBoundingClientRect();return {page:document.documentElement.scrollWidth,width:innerWidth,outerShadow:e.boxShadow,outerBorder:e.borderWidth,cardShadow:c.boxShadow,cardWidth:r.width,cardHeight:r.height,rulesFont:parseFloat(getComputedStyle(rules).fontSize),rulesOverflow:getComputedStyle(rules).overflowY,detail:detail?.textContent,detailHeight:detail?.getBoundingClientRect().height,listScroll:list.scrollWidth,listClient:list.clientWidth,count:document.querySelectorAll('.mwg-card-choice').length};})()`);
    assert.ok(rewards.page<=width);assert.equal(rewards.count,3);assert.equal(rewards.outerShadow,'none');assert.equal(rewards.outerBorder,'0px');assert.notEqual(rewards.cardShadow,'none');assert.ok(Math.abs(rewards.cardWidth-140)<1&&Math.abs(rewards.cardHeight-210)<1,JSON.stringify({width,rewards}));assert.ok(rewards.rulesFont>=10&&rewards.rulesOverflow==='auto');assert.equal(rewards.detail,'详情');assert.ok(rewards.detailHeight>=24&&rewards.listScroll>rewards.listClient);evidence.push({width,rewards});
    fs.writeFileSync('tmp/mobile-reward-'+width+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  for(const width of [320,390,430]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:640,deviceScaleFactor:1,mobile:false});
    await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await navigate('tmp/ui-v466/index.html');
    await evaluate("document.getElementById('fixture-controls').style.display='none';fixture.formation(5);enablePhoneCards()");
    const compactBattle=await evaluate(`(()=>{const hand=document.querySelector('#hand-cards'),card=hand.querySelector('.mwg-card'),r=card.getBoundingClientRect(),rules=card.querySelector('.card-rules'),detail=card.querySelector('.card-preview-trigger'),h=hand.getBoundingClientRect();return {page:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight,handHeight:h.height,cardWidth:r.width,cardHeight:r.height,rulesFont:parseFloat(getComputedStyle(rules).fontSize),detailWidth:detail.getBoundingClientRect().width,detailHeight:detail.getBoundingClientRect().height,flavor:getComputedStyle(card.querySelector('.card-flavor-footer')).display};})()`);
    assert.ok(compactBattle.page<=width);assert.equal(compactBattle.height,640);assert.ok(Math.abs(compactBattle.cardWidth-96)<1&&Math.abs(compactBattle.cardHeight-144)<1,JSON.stringify({width,compactBattle}));assert.ok(compactBattle.handHeight<=156&&compactBattle.rulesFont>=8);assert.ok(compactBattle.detailWidth>=34&&compactBattle.detailHeight>=20);assert.equal(compactBattle.flavor,'none');
    if(width===390){
      await evaluate('window.statusLinkFixture()');await pause(100);
      const compactStatus=await evaluate(`(()=>{const card=document.querySelector('#mwg-status-fold .collection-card .mwg-card'),r=card.getBoundingClientRect();return {w:r.width,h:r.height,page:document.documentElement.scrollWidth}})()`);
      assert.ok(Math.abs(compactStatus.w-compactBattle.cardWidth)<1&&Math.abs(compactStatus.h-compactBattle.cardHeight)<1,JSON.stringify({compactBattle,compactStatus}));assert.ok(compactStatus.page<=width);evidence.push({width,compactBattle,compactStatus});
      fs.writeFileSync('tmp/mobile-low-battle-390.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
    } else evidence.push({width,compactBattle});
    await navigate('tmp/mobile-rewards.html');
    const compactReward=await evaluate(`(()=>{const list=document.querySelector('.mwg-card-choice-list'),card=list.querySelector('.mwg-card'),r=card.getBoundingClientRect(),rules=card.querySelector('.card-rules');return {page:document.documentElement.scrollWidth,w:r.width,h:r.height,font:parseFloat(getComputedStyle(rules).fontSize),flavor:getComputedStyle(card.querySelector('.card-flavor-footer')).display,scroll:list.scrollWidth,client:list.clientWidth}})()`);
    assert.ok(compactReward.page<=width);assert.ok(Math.abs(compactReward.w-compactBattle.cardWidth)<1&&Math.abs(compactReward.h-compactBattle.cardHeight)<1,JSON.stringify({compactBattle,compactReward}));assert.ok(compactReward.font>=8);assert.equal(compactReward.flavor,'none');if(width===320)assert.ok(compactReward.scroll>compactReward.client);else assert.ok(compactReward.scroll<=compactReward.client+1);evidence.push({width,compactReward});
    if(width===390)fs.writeFileSync('tmp/mobile-low-reward-390.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    if(width===390){
      await navigate('tmp/common-removal-v461/index.html');
      const compactCommonStatus=await evaluate(`(()=>{const card=document.querySelector('#mwg-status-fold .collection-card .mwg-card'),r=card.getBoundingClientRect(),rules=card.querySelector('.card-rules');return {w:r.width,h:r.height,font:parseFloat(getComputedStyle(rules).fontSize),page:document.documentElement.scrollWidth}})()`);
      assert.ok(Math.abs(compactCommonStatus.w-compactBattle.cardWidth)<1&&Math.abs(compactCommonStatus.h-compactBattle.cardHeight)<1,JSON.stringify({compactBattle,compactCommonStatus}));assert.ok(compactCommonStatus.font>=8&&compactCommonStatus.page<=width);evidence.push({width,compactCommonStatus});
      fs.writeFileSync('tmp/mobile-low-common-status-390.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
    }
  }
  fs.writeFileSync('tmp/mobile-final.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));

} finally {ws?.close();child.kill();}
