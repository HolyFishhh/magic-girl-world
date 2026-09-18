import fs from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { compile } from 'sass';
import WebSocket from 'ws';

// Unique workspace-local fixture/profile. Never reuse/delete any user profile.
fs.mkdirSync(resolve('tmp'), { recursive: true });
const dir = fs.mkdtempSync(resolve('tmp/tower-room-navigation-'));
const wrap = (file, imports = '') => {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return `(()=>{const exports={};const require=id=>{if(id==='../common/userNavigationScroll')return scrollModule;if(id==='../fish/shared/html')return {escapeHtml:s=>String(s)};if(id==='./towerMapMode')return {isLockedTowerMapRun:(stat,run)=>stat?.game_mode_lock?.schemaVersion===1&&stat.game_mode_lock.mode==='tower'&&run?.schemaVersion===3&&run.routeMode==='map'&&!!run.map};throw Error('Unexpected fixture import: '+id)};${imports}\n${code}\nreturn exports;})()`;
};
const index = fs.readFileSync('src/common/index.ts', 'utf8');
const focusBody = index.match(/function applyPendingUserFocus\(\): void \{[\s\S]*?\n\}/)?.[0];
assert.ok(focusBody, 'exercise the actual post-render heading-focus function');
assert.match(index, /await runActionHost\.activateTowerRunNode\(node.id\);\s*requestUserFocus\('@room'\)/);
assert.match(index, /await runActionHost\.leaveShop\(\);\s*requestUserFocus\('#tower-map-root'\)/);
assert.doesNotMatch(focusBody, /button:not/, 'page focus must not select the first old reward/action button');
const focusScript = ts.transpileModule(focusBody, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const style = compile('src/common/index.scss', { logger: { warn() {}, debug() {} } }).css;
fs.writeFileSync(join(dir, 'child.html'), `<!doctype html><meta charset="utf-8"><style>${style}
html,body{margin:0}body{display:block}#fixture-tail{height:2200px}</style>
<section id="mwg-story-panel"><h2>当前剧情</h2><p>火光照亮石阶。</p></section>
<div id="tower-node-panel-root"><h2>营火行动</h2><p>选择休息或训练。</p><button>恢复生命</button></div>
<div id="choice-container" hidden><button>旧奖励（不得聚焦）</button></div>
<div id="tower-map-root"><h2>路线图</h2><button>下一地点</button></div>
<details id="mwg-status-fold"><summary>底部状态</summary></details><div id="fixture-tail"></div>
<script>window.addEventListener("error",event=>window.fixtureError=event.message);</script><script>
const presentation=${wrap('src/common/towerScreenPresentation.ts')};
const scrollModule=${wrap('src/common/userNavigationScroll.ts')};
const {requestNavigationFocus,applyNavigationFocus}=${wrap('src/runtime/navigationFocus.ts')};
let __PENDING_USER_FOCUS=null;const highlightFocusedSurface=()=>{};
${focusScript}
let passiveFocusEvents=0;document.getElementById('tower-map-root').addEventListener('mwg-focus-current-node',()=>passiveFocusEvents++);
const stat={game_mode_lock:{schemaVersion:1,mode:'tower'},run:{schemaVersion:3,routeMode:'map',map:{},seed:1,phase:'in_node',currentNode:{kind:'rest'},opening:{phase:'consumed'},visitedNodeIds:[]}};
let __STAT__=stat;const readRunState=s=>s.run;const isBattleRunNode=k=>['battle','elite','boss'].includes(k);const hasSelectableRewards=()=>false;
const render=()=>presentation.renderTowerScreen(stat,false,render);
window.fixture={render,stat,flush:applyPendingUserFocus,focus:selector=>{__PENDING_USER_FOCUS=selector;applyPendingUserFocus()},events:()=>passiveFocusEvents};
render();
</script>`);
fs.writeFileSync(join(dir, 'host.html'), `<!doctype html><meta charset="utf-8"><style>body{margin:0}#chat{height:700px;overflow:auto;overflow-anchor:none}iframe{display:block;width:100%;height:4000px;border:0}.space{height:1300px}</style><div id="chat"><div class="space"></div><iframe src="child.html"></iframe><div class="space"></div></div>`);
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--allow-file-access-from-files',
  '--remote-debugging-port=0',`--user-data-dir=${join(dir, 'profile')}`,'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  let port;
  for (let i=0;i<100;i++) {try {port=Number(fs.readFileSync(join(dir,'profile/DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}await wait(100);}
  assert.ok(port,'isolated Edge starts');
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});
  let id=0;const pending=new Map();
  ws.on('message',raw=>{const m=JSON.parse(raw);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)});
  const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  await call('Network.enable');
  await call('Network.setBlockedURLs',{urls:['http://*','https://*']});
  const evidence=[];
  for(const width of [1000,390]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:pathToFileURL(join(dir,'host.html')).href});
    for(let i=0;i<50;i++){if(await evaluate(`!!document.querySelector('iframe')?.contentWindow?.fixture`))break;await wait(100);}
    const fixtureError=await evaluate(`document.querySelector('iframe').contentWindow.fixtureError || null`);
    assert.equal(fixtureError,null);

    const before=await evaluate(`(()=>{const d=document.querySelector('iframe').contentDocument;return {room:d.getElementById('tower-room-page').offsetHeight,story:d.getElementById('mwg-story-panel').offsetHeight}})()`);
    assert.ok(before.room<400,`compact campfire should not reserve 620px: ${JSON.stringify(before)}`);
    await evaluate(`document.querySelector('iframe').contentWindow.fixture.focus('@room')`);await wait(700);
    const focused=await evaluate(`(()=>{const f=document.querySelector('iframe'),d=f.contentDocument,r=d.activeElement.getBoundingClientRect();return {tag:d.activeElement.tagName,text:d.activeElement.textContent,top:r.top+f.getBoundingClientRect().top,bottom:r.bottom+f.getBoundingClientRect().top,scroll:document.getElementById('chat').scrollTop}})()`);
    assert.equal(focused.tag,'SECTION');assert.ok(focused.text.includes('营火行动'));assert.ok(focused.top>=-1&&focused.bottom<=701,JSON.stringify(focused));assert.ok(focused.scroll>0,'host chat scrolls although child viewport is 4000px tall');
    fs.writeFileSync(join(dir,`campfire-${width}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    const passive=await evaluate(`(()=>{const f=document.querySelector('iframe'),w=f.contentWindow,d=f.contentDocument;document.getElementById('chat').scrollTop+=120;const before=document.getElementById('chat').scrollTop;w.fixture.stat.run.phase='awaiting_choice';w.fixture.render();w.fixture.render();w.fixture.flush();return {before,after:document.getElementById('chat').scrollTop,events:w.fixture.events(),focus:d.activeElement.tagName}})()`);
    assert.equal(passive.events,0,'passive screen transitions must not dispatch focus');assert.equal(passive.before,passive.after);assert.ok(['SECTION','BODY'].includes(passive.focus),'hiding the old room may naturally release DOM focus');
    const eventRoom=await evaluate(`(()=>{const w=document.querySelector('iframe').contentWindow,d=w.document;w.fixture.stat.run.currentNode.kind='event';d.getElementById('tower-node-panel-root').innerHTML='<h2>未知事件</h2><p>调查之后，脚步声逐渐远去。</p><button>继续调查</button>';w.fixture.stat.run_event_reveal={node_id:'event-1',choice_id:'look'};w.fixture.render();return {room:d.getElementById('tower-room-page').offsetHeight,story:d.getElementById('mwg-story-panel').offsetHeight,back:!!d.getElementById('tower-room-return')}})()`);
    assert.ok(eventRoom.room<400);assert.equal(eventRoom.story,before.story);assert.ok(eventRoom.back);
    await evaluate(`document.querySelector('iframe').contentWindow.fixture.focus('@room')`);await wait(700);
    fs.writeFileSync(join(dir,`event-${width}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    const asyncBattle=await evaluate(`(()=>{const w=document.querySelector('iframe').contentWindow,d=w.document;w.fixture.stat.run.phase='in_node';w.fixture.stat.run.currentNode.kind='battle';w.fixture.focus('@room');w.fixture.flush();const stage=d.createElement('section');stage.id='battle-stage';stage.textContent='战斗舞台';stage.style.height='240px';d.body.append(stage);w.fixture.flush();const focused=d.activeElement.id;document.getElementById('chat').scrollTop=0;w.fixture.flush();return {focused,scroll:document.getElementById('chat').scrollTop}})()`);
    assert.equal(asyncBattle.focused,'battle-stage');assert.equal(asyncBattle.scroll,0,'consumed intent must not steal scroll on passive update');
    const explicit=await evaluate(`(()=>{const w=document.querySelector('iframe').contentWindow;w.fixture.stat.run.phase='awaiting_choice';w.fixture.stat.run.currentNode.kind='event';let count=0;w.document.addEventListener('mwg-user-navigate',()=>count++);w.document.getElementById('tower-room-return').click();return {count,screen:w.document.body.dataset.towerScreen}})()`);
    assert.equal(explicit.count,1);assert.equal(explicit.screen,'map');
    evidence.push({width,before,focused,passive,eventRoom,explicit});
    fs.writeFileSync(join(dir,`navigation-${width}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  fs.writeFileSync(join(dir,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({evidence:join(dir,'evidence.json'),results:evidence},null,2));
} finally { ws?.close();edge.kill(); }
