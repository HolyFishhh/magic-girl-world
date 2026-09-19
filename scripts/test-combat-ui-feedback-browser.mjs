import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const port=18174, out=resolve('tmp/combat-ui-v470-evidence'); fs.mkdirSync(out,{recursive:true});
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve('tmp/combat-ui-browser-v470')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
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
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:'file:///'+resolve('tmp/ui-v466/index.html').replaceAll('\\','/')});for(let i=0;i<80;i++){if(await evalJs('typeof complexCards === \'function\''))break;await pause(100);}
    await evalJs('complexCards()');
    const rules=await evalJs(`(()=>{const c=document.querySelector('[data-card-id="curse-test"]'),a=document.querySelector('[data-card-id="scaled-test"]');return {curse:c.textContent,cls:c.className,attack:a.textContent}})()`);
    assert.match(rules.curse,/弃置时.*失去3/s);assert.doesNotMatch(rules.curse,/回合结束时|传说/);assert.match(rules.cls,/rarity-Curse/);assert.match(rules.attack,/成长.*3.*当前预计/s);
    const stable=await evalJs(`(()=>{const el=document.querySelector('[data-card-id="scaled-test"] .card-rules');const t=performance.now();for(let i=0;i<8;i++)refreshComplex();return {same:el===document.querySelector('[data-card-id="scaled-test"] .card-rules'),ms:performance.now()-t}})()`);assert.equal(stable.same,true);
    const piles=await evalJs('pileFlowTest()');assert.equal(piles.single,1);assert.equal(piles.id,'curse-test');assert.equal(piles.grouped,1);assert.match(piles.text,/5/);assert.equal(piles.left,0);
    assert.deepEqual(await evalJs("[...document.querySelectorAll('.battle-pile-dock [data-pile]')].map(e=>e.dataset.pile)"),['discard','exhaust','draw']);
    const pov=await evalJs('enemyPov()');assert.match(pov,/自身赋予|赋予自身/);assert.doesNotMatch(pov,/敌方赋予/);
    await shot('cards-'+width);await evalJs("document.querySelector('.support-details-popover').remove()");
    const escape=await evalJs(`(async()=>{const member=document.querySelector('#stage-enemy-party .stage-enemy-member');let done=false;const t=performance.now();const p=fullAnim.animateEnemyEscape(member.dataset.enemyId).then(()=>done=true);member.querySelector('span')?.dispatchEvent(new AnimationEvent('animationend',{bubbles:true,animationName:'other'}));await new Promise(r=>setTimeout(r,100));const early=done;await p;return {early,elapsed:performance.now()-t,complete:member.dataset.escapeComplete}})()`);assert.equal(escape.early,false);assert.ok(escape.elapsed>=700);assert.equal(escape.complete,'true');
    const history=await evalJs(`(async()=>{const c=document.createElement('div');document.body.append(c);const records=Array.from({length:5},(_,i)=>({key:String(i),requestId:'r'+i,stage:'response',kind:'自然语言修改',recordedAt:Date.now(),text:'原文'.repeat(100000)}));let loaded=false;renderEvidence(c,{total:100,records},()=>loaded=true);const before=c.textContent.length;c.querySelector('details').open=true;await new Promise(r=>setTimeout(r,20));const first=c.querySelector('pre').textContent.length;c.querySelector('details button').click();const second=c.querySelector('pre').textContent.length;[...c.querySelectorAll('button')].at(-1).click();const result={before,first,second,loaded,records:c.querySelectorAll('details').length};c.remove();return result})()`);assert.ok(history.before<1500);assert.equal(history.first,12000);assert.equal(history.second,24000);assert.equal(history.loaded,true);assert.equal(history.records,5);
    await call('Page.navigate',{url:'file:///'+resolve('tmp/common-removal-v461/index.html').replaceAll('\\','/')});await pause(1300);
    const id=await evalJs('routeFocusFixture()');await evalJs('returnRoute()');await pause(120);
    const position=await evalJs(`(()=>{const v=document.querySelector('.tower-map-viewport'),n=document.querySelector('[data-node-id="${id}"]');return {scroll:v.scrollTop,h:v.clientHeight,node:n?.getBoundingClientRect().top,top:v.getBoundingClientRect().top}})()`);assert.ok(position.scroll>0);assert.ok(position.node>=position.top&&position.node<position.top+position.h);
    await evalJs("document.querySelector('.tower-map-viewport').scrollTop=20;updateRoute()");await pause(100);assert.equal(await evalJs("document.querySelector('.tower-map-viewport').scrollTop"),20,'passive map update preserves manual scroll');
    await shot('map-'+width);
    await evalJs("shopFixture();document.querySelector('[data-shop-inspect]').scrollIntoView({block:'center'});document.querySelector('[data-shop-inspect]').click()");
    const shop=await evalJs(`(()=>{const a=document.querySelector('[data-shop-inspect]').getBoundingClientRect(),d=document.querySelector('.shop-detail').getBoundingClientRect();return {delta:Math.abs(a.top-d.top),count:document.querySelectorAll('.shop-detail').length}})()`);assert.ok(shop.delta<40);assert.equal(shop.count,1);
    await shot('shop-detail-'+width);
    await evalJs("document.querySelector('.shop-detail-close').click();document.querySelector('[data-shop-remove]').click();document.querySelector('[data-remove-index]').click()");
    const removal=await evalJs(`(()=>{const c=document.querySelector('.shop-remove-confirm');return {enabled:!c.disabled,text:c.textContent,selected:document.querySelectorAll('.shop-remove-list .is-selected').length,extra:document.querySelectorAll('.mwg-card-preview').length,details:document.querySelectorAll('.shop-remove-list .card-preview-trigger').length}})()`);assert.equal(removal.enabled,true);assert.equal(removal.selected,1);assert.equal(removal.extra,0);assert.equal(removal.details,2);assert.match(removal.text,/75/);
    const removalDetail=await evalJs(`(()=>{document.querySelector('.shop-remove-list .card-preview-trigger').click();return {selected:document.querySelectorAll('.shop-remove-list .is-selected').length,preview:document.querySelectorAll('.mwg-card-preview').length,enabled:!document.querySelector('.shop-remove-confirm').disabled}})()`);assert.deepEqual(removalDetail,{selected:1,preview:1,enabled:true});await evalJs("document.querySelector('.mwg-card-preview > button').click()");
    await shot('shop-removal-'+width);await evalJs("document.querySelector('.shop-remove-confirm').click()");assert.equal(await evalJs('window.removed'),'remove-exact');
    const boundary=await evalJs('actBoundaryFixture()');assert.equal(boundary.rewards,false);assert.match(boundary.text,/第 2 幕/);assert.match(boundary.text,/继续准备本幕馈赠/);
    evidence.push({boundary,width,rules,stable,pov,escape,history,position,shop,removal,removalDetail,piles});
  }
  fs.writeFileSync(resolve(out,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{ws?.terminate();edge.kill();}
