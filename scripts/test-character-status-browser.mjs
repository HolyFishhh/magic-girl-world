import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const port=18172, out=resolve('tmp/character-status-v470-evidence'); fs.mkdirSync(out,{recursive:true});
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve('tmp/character-status-browser-v470')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
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
  for(const width of [390,1000]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:'file:///'+resolve('tmp/common-removal-v461/index.html').replaceAll('\\','/')});await waitForFixture();
    const stat=await evalJs('fixture.stat()');
    const probe=()=>evalJs(`(()=>{const s=document.querySelector('#mwg-status-fold'),c=s.querySelector('.character-detail-container'),b=s.querySelector('#status-build-details'),r=s.getBoundingClientRect();return {open:s.open,visible:getComputedStyle(s).display!=='none',outside:!s.closest('#tower-screen-host'),analysis:c.contains(b),desire:c.textContent.includes('欲望效果'),text:b.textContent,headings:[...s.querySelectorAll('h3,h4')].map(e=>e.textContent),color:getComputedStyle(b).color,background:getComputedStyle(b).backgroundColor,pageOverflow:document.documentElement.scrollWidth>innerWidth,cards:s.querySelectorAll('.collection-card').length,summary:s.querySelector('summary').textContent}})()`);
    const initial=await probe();
    const contrast=(fg,bg)=>{const luminance=c=>c.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    assert.ok(contrast(initial.color,initial.background)>=4.5,'readable text contrast');assert.equal(initial.open,true);assert.equal(initial.analysis,true);assert.equal(initial.desire,true);assert.equal(initial.cards,2);assert.match(initial.text,/248.6/);assert.match(initial.text,/吸血续航/);assert.equal(initial.outside,true);assert.equal(initial.pageOverflow,false);
    assert.equal(await evalJs("document.querySelectorAll('#mwg-status-fold .mwg-mechanics-help,#status-mechanics-help details').length"),0);
    await evalJs("document.querySelector('.character-help-button').click()");
    assert.equal(await evalJs("document.querySelector('#mwg-rules-dialog').open"),true);
    await evalJs("document.querySelector('#mwg-rules-dialog button').click()");
    await pause(30);assert.equal(await evalJs("Boolean(document.querySelector('#mwg-rules-dialog'))"),false);
    await evalJs("document.querySelector('#status-build-details').click()");assert.equal(await evalJs('window.__settingsSection'),'build');
    for(const screen of ['battle','room','map']){await evalJs(`fixture.screen('${screen}');fixture.render()`);const after=await probe();assert.deepEqual(after.headings,initial.headings);assert.equal(after.visible,true);assert.equal(after.outside,true);assert.equal(after.background,initial.background);assert.equal(await evalJs("document.querySelector('#mwg-story-panel').nextElementSibling.id==='tower-screen-host' && document.querySelector('#tower-screen-host').nextElementSibling.id==='mwg-status-fold' && getComputedStyle(document.querySelector('#mwg-story-panel')).display!=='none'"),true);}
    await evalJs("document.querySelector('#mwg-status-fold').scrollIntoView();document.querySelector('#mwg-status-fold .battle-overview-detail').open=true");await shot('common-'+width);
    await evalJs("document.querySelector('#mwg-status-fold > summary').click();fixture.screen('battle');fixture.render()");assert.equal((await probe()).open,false,'manual collapse survives content refresh');
    await evalJs("document.querySelector('#mwg-status-fold > summary').click();fixture.stat().run.phase='won';fixture.render()");assert.equal((await probe()).visible,true,'terminal state preserves standalone status');
    await call('Page.navigate',{url:'file:///'+resolve('tmp/ui-v466/index.html').replaceAll('\\','/')});await pause(2200);
    await evalJs(`window.MagicGirlDesignAssistant={getDashboard:()=>({snapshot:{deckProfile:{archetypes:[{label:'吸血续航'}],totalScore:248.6}}})};fixture.characterStatus(${JSON.stringify(stat)})`);
    assert.equal(await evalJs("document.querySelector('#mwg-story-panel').nextElementSibling.classList.contains('card-game-container') && document.querySelector('.card-game-container').nextElementSibling.id==='mwg-status-fold'"),true);
    assert.equal(await evalJs("getComputedStyle(document.querySelector('.card-game-container')).position"),'relative');
    const battle=await probe();assert.deepEqual(battle.headings,initial.headings);assert.equal(battle.color,initial.color);assert.equal(battle.background,initial.background);assert.equal(battle.pageOverflow,false);
    await evalJs("document.querySelector('#mwg-status-fold').scrollIntoView();document.querySelector('#mwg-status-fold .battle-overview-detail').open=true");await shot('battle-'+width);
    const stableDetails=await evalJs(`(()=>{const detail=document.querySelector('.character-detail-container');const updated=${JSON.stringify(stat)};updated.battle.core.hp-=3;fixture.characterStatus(updated,true);return detail===document.querySelector('.character-detail-container')})()`);
    // First switch to live input may render once; subsequent vitals-only updates must reuse the details.
    const vitalsOnly=await evalJs(`(()=>{const detail=document.querySelector('.character-detail-container');const updated=${JSON.stringify(stat)};updated.battle.core.hp-=7;fixture.characterStatus(updated,true);return detail===document.querySelector('.character-detail-container')})()`);assert.equal(vitalsOnly,true);
    const before=JSON.stringify(stat);
    await evalJs(`fixture.characterStatus(${JSON.stringify(stat)},true)`);
    const live=await probe();assert.deepEqual(live.headings,initial.headings);assert.equal(live.cards,2);assert.equal(JSON.stringify(stat),before);
    assert.match(await evalJs("document.querySelector('#battle-player-overview .card-rules').textContent"),/6/);
    const sizes=await evalJs("Array.from(document.querySelectorAll('#battle-player-overview .collection-card .mwg-card')).map(e=>({width:e.getBoundingClientRect().width,overflow:e.scrollWidth>e.clientWidth+1}))");assert.ok(sizes.every(s=>!s.overflow));assert.ok(Math.abs(sizes[0].width-sizes[1].width)<1);
    evidence.push({width,initial,battle,live,sizes,contrast:contrast(initial.color,initial.background)});
  }
  fs.writeFileSync(resolve(out,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} finally {ws?.terminate();edge.kill();}
