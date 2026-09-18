import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import ts from 'typescript';
import { createRequire } from 'node:module';
import webpack from 'webpack';
import WebSocket from 'ws';

// Private snapshots are opt-in only. The default fixture is deterministic and
// generated from the same public run-state constructors as the application.
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { createRunState, generateRunChoices, validateRunState } = require('../src/game-core/runState.ts');
const snapshotPath = process.argv[2] ? resolve(process.argv[2]) : null;
const syntheticRun = generateRunChoices({ ...createRunState({ seed: 20260918, routeMode: 'map' }), act: 2, choices: [] });
assert.equal(validateRunState(syntheticRun).ok, true, 'synthetic Act 2 state must be valid');
const observed = snapshotPath ? fs.readFileSync(snapshotPath, 'utf8') : JSON.stringify({
  game_mode_lock: { schemaVersion: 1, mode: 'tower' }, run: syntheticRun, reward: {},
});
const snapshot = JSON.parse(observed);
assert.equal(snapshot.run.act, 2);assert.equal(snapshot.run.floor, 0);assert.equal(snapshot.run.opening.phase, 'pending');
fs.mkdirSync(resolve('tmp'), { recursive: true });
const dir = fs.mkdtempSync(resolve('tmp/act2-dom-regression-'));
const source = fs.readFileSync('src/common/index.ts', 'utf8');
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
const extract = name => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);return node.getText(ast);
};
const functions = ['renderRunData','renderTowerMap','renderTowerNodeContent','teardownTowerMap'].map(extract).join('\n');
const legacy = extract('renderRunData').replace('function renderRunData(', 'function legacyRenderRunData(')
  .replace('  if (run && isLockedTowerMapRun(stat, run)) ensureTowerRunDom();', '')
  .replace(/  \/\/ A same-message act transition[\s\S]*?(?=  const section =)/, '');
const screenSource = fs.readFileSync('src/common/towerScreenPresentation.ts', 'utf8');
const screenAst = ts.createSourceFile('screen.ts', screenSource, ts.ScriptTarget.Latest, true);
const legacyScreen = screenAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'renderTowerScreen').getText(screenAst)
  .replace('export function renderTowerScreen(', 'function legacyRenderTowerScreen(')
  .replace('  if (isLockedTowerMapRun(stat, stat?.run)) ensureTowerRunDom();', '');
fs.writeFileSync(join(dir, 'entry.ts'), `
import {readRunState} from '../../src/runtime/runStateAdapter';
import {isLockedTowerMapRun} from '../../src/common/towerMapMode';
import {hasSelectableRewards} from '../../src/common/rewardTransactions';
import {renderTowerNodePanel} from '../../src/common/towerNodePanel';
import {currentTowerScreen,ensureTowerRunDom,renderTowerScreen} from '../../src/common/towerScreenPresentation';
const fixtureStat=${observed};
const pristine=JSON.stringify(fixtureStat);
let __STAT__=fixtureStat,__RUN_ERROR='',__PENDING_OPENING_WAKE_KEY='',__TOWER_MAP_APP=null,__IS_SENDING_ACTION=false;
let publication=null,extension={ready:true,message:''},wakeCount=0,recoveryCount=0,retryCount=0;
Object.assign(globalThis,{MagicGirlWorld:{scheduleTowerGeneration:async()=>{wakeCount++},getTowerInitialPublicationStatus:()=>publication,resumeTowerInitialCommit:async()=>{recoveryCount++}}});
const isCurrentMessageLatest=()=>true,selectedGameMode=()=> 'tower',renderTowerStartPanel=()=>{};
const towerExtensionReadiness=()=>extension;
const currentInitialContentReadiness=()=>{throw Error('must not apply Act 1 gate to Act 2')};
const loadGameData=async()=>{renderRunData(fixtureStat);renderTowerScreen(fixtureStat,false,()=>{})};
const showRunError=(error:any)=>{throw error};
const retryTowerOpening=()=>{retryCount++};
// No transactions/model calls are supplied. Non-opening callback bodies are not invoked.
${functions}
${legacy}
const dismissed=new Set(),revealKey=()=>'',BACKDROP_KEY='fixture-unused',sceneKey=()=>'',escapeHtml=String;
${legacyScreen}
const fixtureMarkup=()=>'<section id="mwg-story-panel"><h2>启程剧情</h2></section><details id="mwg-route-fold" hidden><section id="run-section"><strong id="run-current"></strong><div id="run-actions"></div><div id="run-error"></div><div id="tower-node-panel-root" hidden></div><div id="tower-map-root"></div></section></details><div id="choice-container" hidden></div><details id="mwg-status-fold"></details>';
const visible=(el:HTMLElement|null)=>!!el&&!!el.getClientRects().length&&!el.closest('[hidden]');
const check=(condition:any,message:string)=>{if(!condition)throw Error(message)};
(window as any).runCases=async()=>{
  check(!!readRunState(fixtureStat),'observed run must parse');check(!hasSelectableRewards(fixtureStat),'observed rewards are exhausted');
  for (const mode of ['story', 'legacy-window']) {
    document.body.innerHTML=fixtureMarkup();
    const outside=JSON.parse(JSON.stringify(fixtureStat));
    if(mode==='story') outside.game_mode_lock.mode='story';
    else outside.run.routeMode='legacy-window';
    renderTowerScreen(outside,false,()=>{});
    check(!document.getElementById('tower-run-feedback'),mode+' must not create tower controller feedback');
    check(document.getElementById('run-current')!.closest('#mwg-route-fold'),mode+' must not relocate legacy controls');
  }
  // Reproduce lost legacy controls after fold removal. Preserve the modern roots
  // exactly as story presentation does before removing the old fold.
  document.body.innerHTML=fixtureMarkup();
  document.body.append(document.getElementById('tower-node-panel-root')!,document.getElementById('tower-map-root')!);
  document.getElementById('mwg-route-fold')!.remove();
  legacyRenderRunData(fixtureStat);await Promise.resolve();
  const baselineEmpty=!document.getElementById('tower-node-panel-root')!.childElementCount;
  check(baselineEmpty,'legacy early return must reproduce missing Act 2 panel');
  legacyRenderTowerScreen(fixtureStat,false,()=>{});
  const baselineLoadingOnly=!!document.getElementById('tower-room-loading');
  check(baselineLoadingOnly&&wakeCount===0,'legacy missing controls show only loading and bypass the wake');
  const results=[];
  for(const mode of ['missing-controls','missing-all-roots','hidden-fold']){
    document.body.innerHTML=fixtureMarkup();
    if(mode==='missing-controls')for(const id of ['run-current','run-actions','run-error'])document.getElementById(id)!.remove();
    if(mode==='missing-all-roots')document.getElementById('mwg-route-fold')!.remove();
    __PENDING_OPENING_WAKE_KEY='';wakeCount=0;
    for(let pass=0;pass<3;pass++){
      renderRunData(fixtureStat);renderTowerScreen(fixtureStat,false,()=>{});await Promise.resolve();
      const panel=document.getElementById('tower-node-panel-root')!;
      check(visible(panel),'opening panel visible after '+mode+' pass '+pass);
      check(panel.textContent!.includes('第 2 幕开幕馈赠'),'actual opening renderer reached');
      check(!document.getElementById('tower-room-loading'),'real controls replace generic loading');
      const retry=Array.from(panel.querySelectorAll('button')).find(b=>b.textContent!.includes('继续准备本幕馈赠'))!;
      check(!!retry&&!retry.disabled,'pending opening exposes actionable retry');
    }
    check(wakeCount===1,'one idempotent wake across repeated renders');
    document.getElementById('tower-node-panel-root')!.querySelector('button')!.click();
    results.push({mode,passes:3,wakeCount,panel:document.getElementById('tower-node-panel-root')!.dataset.panel});
  }
  // Publication errors clear the opening panel, but must not strand the existing
  // recovery action under a hidden/deleted legacy route fold.
  publication={ready:false,busy:false,message:'fixture publication requires recovery'};
  renderRunData(fixtureStat);renderTowerScreen(fixtureStat,false,()=>{});
  const error=document.getElementById('run-error')!;
  const recovery=document.getElementById('run-actions')!.querySelector('button')!;
  check(visible(error)&&error.textContent===publication.message,'publication error remains visible');
  check(visible(recovery)&&!recovery.disabled,'publication recovery is actionable');
  check(!document.getElementById('tower-room-loading'),'do not mask publication error with loading');
  recovery.click();await Promise.resolve();await Promise.resolve();
  check(recoveryCount===1,'recovery callback invoked once (offline stub only)');
  publication=null;extension={ready:false,message:'fixture extension not ready'};
  renderRunData(fixtureStat);renderTowerScreen(fixtureStat,false,()=>{});
  check(visible(document.getElementById('run-error')),'extension error is not hidden in route fold');
  extension={ready:true,message:''};renderRunData(fixtureStat);renderTowerScreen(fixtureStat,false,()=>{});
  check(visible(document.getElementById('tower-node-panel-root')),'opening recovers after error clears');
  check(JSON.stringify(fixtureStat)===pristine,'observed snapshot is never mutated');
  return {baselineEmpty,baselineLoadingOnly,results,retryCount,recoveryCount,snapshotUnchanged:true,nonTowerIsolation:true};
};
`);
await new Promise((resolveBuild,reject)=>{
 const compiler=webpack({mode:'development',devtool:false,entry:join(dir,'entry.ts'),output:{path:dir,filename:'app.js'},resolve:{extensions:['.ts','.js']},module:{rules:[{test:/\.ts$/,exclude:/node_modules/,use:{loader:'ts-loader',options:{transpileOnly:true}}}]},performance:{hints:false}});
 compiler.run((err,stats)=>compiler.close(closeErr=>err||closeErr||stats.hasErrors()?reject(err||closeErr||Error(stats.toString({all:false,errors:true}))):resolveBuild()));
});
fs.writeFileSync(join(dir,'index.html'),'<!doctype html><meta charset="utf-8"><style>[hidden]{display:none!important}body{background:#172136;color:white;font:16px system-ui}button{padding:12px}</style><body><script src="app.js"></script>');
const child=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(dir,'profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let port;for(let i=0;i<100;i++){try{port=Number(fs.readFileSync(join(dir,'profile/DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break}catch{}await wait(100)}
 assert.ok(port);const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});let id=0;const pending=new Map();
 ws.on('message',raw=>{const m=JSON.parse(raw),p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)});
 const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await call('Network.enable');await call('Network.setBlockedURLs',{urls:['http://*','https://*']});
 await call('Page.navigate',{url:pathToFileURL(join(dir,'index.html')).href});
 for(let i=0;i<100;i++){if(await evaluate('typeof runCases==="function"'))break;await wait(100)}
 const evidence=await evaluate('runCases()');if(snapshotPath) assert.equal(fs.readFileSync(snapshotPath,'utf8'),observed);
 evidence.fixtureSource=snapshotPath?'explicit-snapshot':'synthetic-seed-20260918';
 fs.writeFileSync(join(dir,'evidence.json'),JSON.stringify(evidence,null,2));fs.writeFileSync(join(dir,'act2.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 console.log(JSON.stringify({evidence:join(dir,'evidence.json'),...evidence},null,2));
}finally{ws?.close();child.kill()}
