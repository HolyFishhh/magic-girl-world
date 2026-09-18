import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import WebSocket from 'ws';
const port=18169;
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--allow-file-access-from-files',
  `--remote-debugging-port=${port}`,`--user-data-dir=${resolve('tmp/story-scroll-profile-v470')}`,'about:blank',
],{windowsHide:true,stdio:'ignore'});
let socket;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  let targets;for(let i=0;i<100;i++){try{targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(targets.length)break;}catch{}await wait(100);}
  assert.ok(targets?.length);socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  let id=0;const pending=new Map();socket.on('message',raw=>{const m=JSON.parse(raw);if(!m.id)return;const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result);});
  const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await call('Page.enable');
  const navigate=async legacy=>{await call('Page.navigate',{url:`file:///${resolve('tmp/story-scroll-v470/host.html').replaceAll('\\','/')}${legacy?'?legacy':''}`});await wait(1000);};
  const align=()=>evaluate(`(()=>{const f=document.querySelector('iframe'),chat=document.getElementById('chat'),board=f.contentDocument.querySelector('.card-game-container');chat.scrollTop+=f.getBoundingClientRect().top+board.getBoundingClientRect().top-60;return chat.scrollTop;})()`);
  const measure=()=>evaluate(`(()=>{const f=document.querySelector('iframe'),d=f.contentDocument,board=d.querySelector('.card-game-container');return {top:f.getBoundingClientRect().top+board.getBoundingClientRect().top,scroll:document.getElementById('chat').scrollTop,storyHeight:d.getElementById('mwg-story-panel').offsetHeight,frameHeight:f.offsetHeight,storyBefore:board.previousElementSibling?.id==='mwg-story-panel',statusAfter:board.nextElementSibling?.id==='mwg-status-fold',focus:d.activeElement.tagName};})()`);
  await call('Emulation.setDeviceMetricsOverride',{width:1000,height:900,deviceScaleFactor:1,mobile:false});
  await navigate(true);await align();const legacyBefore=await measure();
  await evaluate(`document.querySelector('iframe').contentWindow.fixture.update(40)`);await wait(250);const legacyAfter=await measure();
  assert.ok(legacyAfter.top-legacyBefore.top>500,'old story-above-board arrangement must reproduce displaced combat');
  const evidence={legacy:{before:legacyBefore,after:legacyAfter},widths:[]};
  for(const width of [1000,390]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await navigate(false);await align();const before=await measure();const checkpoints=[];
    for(const [delay,lines]of [[5000,40],[5000,65],[10000,100]]){
      await wait(delay);await evaluate(`document.querySelector('iframe').contentWindow.fixture.update(${lines})`);await wait(120);
      const after=await measure();assert.ok(Math.abs(after.top-before.top)<2,JSON.stringify({width,before,after}));assert.equal(after.scroll,before.scroll);assert.equal(after.storyBefore,true);assert.equal(after.statusAfter,true);checkpoints.push(after);
    }
    await evaluate(`document.querySelector('iframe').contentWindow.fixture.archive();document.querySelector('iframe').contentDocument.querySelector('#mwg-story-panel details').open=true`);await wait(150);
    const archived=await measure();assert.ok(Math.abs(archived.top-before.top)<2,'archive remains inside story slot');assert.equal(archived.scroll,before.scroll);
    await evaluate(`document.querySelector('iframe').contentDocument.querySelector('#mwg-status-fold').open=true;document.querySelector('iframe').contentWindow.fixture.render();document.querySelector('iframe').contentDocument.querySelector('.character-help-button').click()`);
    const help=await evaluate(`(()=>{const d=document.querySelector('#mwg-rules-dialog'),r=d.getBoundingClientRect();return {open:d.open,top:r.top,bottom:r.bottom,height:innerHeight};})()`);
    assert.equal(help.open,true);assert.ok(help.top>=0 && help.bottom<=help.height,'help opens in the host viewport');
    await evaluate(`document.querySelector('#mwg-rules-dialog button').click()`);await wait(50);
    await evaluate(`document.getElementById('chat').scrollTop+=180`);const manuallyScrolled=await measure();
    await evaluate(`document.querySelector('iframe').contentWindow.fixture.update(120)`);await wait(180);
    const latest=await measure();assert.ok(Math.abs(latest.top-manuallyScrolled.top)<2);assert.equal(latest.scroll,manuallyScrolled.scroll);
    evidence.widths.push({width,before,checkpoints,manual:latest});
    fs.writeFileSync(`tmp/story-scroll-fixed-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  fs.writeFileSync('tmp/story-scroll-v470-evidence.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
}finally{socket?.close();edge.kill();}
