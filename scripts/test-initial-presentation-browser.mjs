import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import webpack from 'webpack';
import { compile } from 'sass';
import WebSocket from 'ws';

const dir = path.resolve('tmp/initial-presentation-fix');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(dir + '/loader.cjs', "const ts=require('typescript');module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText");
fs.writeFileSync(dir + '/entry.ts', `
import { renderStoryPanel } from '../../src/runtime/storyPanel';
import { renderTowerScreen } from '../../src/common/towerScreenPresentation';
import { renderCharacterStatus } from '../../src/shared/characterStatus';
import { createRunState } from '../../src/game-core/runState';
const stat:any = {game_mode:'tower',game_mode_lock:{schemaVersion:1,mode:'tower'},battle:{cards:[],core:{hp:60,max_hp:60}},status:{}};
const variables:any = {stat_data:stat};
Object.assign(window,{getVariables:()=>variables,replaceVariables:()=>{throw Error('read-only fixture');},updateVariablesWith:()=>{throw Error('read-only fixture');},insertOrAssignVariables:()=>{throw Error('read-only fixture');},getCurrentMessageId:()=>0,getLastMessageId:()=>0,getChatMessages:()=>[{message:'[爬塔模式开场]'}]});
document.getElementById('run-section').style.display='';
document.getElementById('tower-start-panel').style.display='';
const render=()=>{renderStoryPanel('common');renderTowerScreen(stat,false,()=>{});};
const setup=()=>{delete stat.run;delete stat.completed_expedition;stat.game_mode='tower';stat.game_mode_lock.mode='tower';render();};
const ready=()=>{stat.run=createRunState({seed:18});stat.run.opening={phase:'ready',requestId:'fixture',basedOnRevision:0,attempts:1,content:{title:'启程',narrative:'高塔的大门开启。',choices:[]}};stat.battle.cards=[{id:'strike',name:'星火',type:'Attack',rarity:'Common',cost:1,quantity:6,effects:{damage:6}}];render();};
const later=()=>{ready();stat.run.act=2;stat.run.opening={phase:'pending'};render();};
const terminal=()=>{ready();stat.run.phase='won';render();};
const archived=()=>{terminal();stat.completed_expedition={run:stat.run};delete stat.run;render();};
const story=()=>{setup();stat.game_mode='story';stat.game_mode_lock.mode='story';renderStoryPanel('common');};
const tick=()=>{renderStoryPanel('common');renderCharacterStatus(stat);};
Object.assign(window,{fixture:{setup,ready,later,terminal,archived,story,render,tick,stat}});setup();
`);
const html = fs.readFileSync('src/common/index.html', 'utf8')
  .replace('</head>', `<style>${compile('src/common/index.scss', { quietDeps: true, logger: { warn() {}, debug() {} } }).css}</style></head>`)
  .replace('</body>', '<script src="app.js"></script></body>');
fs.writeFileSync(dir + '/index.html', html);
await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry: dir + '/entry.ts',
  output: { path: dir, filename: 'app.js' }, resolve: { extensions: ['.ts', '.js'] },
  module: { rules: [{ test: /\.ts$/, use: dir + '/loader.cjs' }] },
}).run((error, stats) => error || stats.hasErrors() ? reject(error || stats.toString({ all: false, errors: true })) : resolve()));

const port = 18219;
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${dir}/browser-profile`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break; } catch {}
    await pause(100);
  }
  assert.ok(targets?.length, 'isolated browser started');
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let id = 0; const pending = new Map();
  socket.on('message', raw => { const message = JSON.parse(raw); if (!message.id) return; const p = pending.get(message.id); pending.delete(message.id); message.error ? p?.reject(message.error) : p?.resolve(message.result); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails)); return response.result.value; };
  await call('Page.enable');
  await call('Page.navigate', { url: 'file:///' + (dir + '/index.html').replaceAll('\\', '/') });
  for (let i = 0; i < 100 && !await evaluate('!!window.fixture'); i++) await pause(100);
  assert.equal(await evaluate('!!window.fixture'), true, 'production renderers loaded');
  const evidence = [];
  for (const width of [390, 1000]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const [phase, hidden] of [['setup', true], ['ready', false], ['setup', true], ['later', false], ['terminal', false], ['archived', false], ['story', false]]) {
      await evaluate(`fixture.${phase}(); for(let i=0;i<5;i++)fixture.tick();`);
      const result = await evaluate(`(()=>{const nodes=['mwg-story-panel','mwg-status-fold'].map(id=>{const e=document.getElementById(id);return {id,hidden:e.hidden,display:getComputedStyle(e).display,height:e.getBoundingClientRect().height};});return {nodes,form:document.getElementById('tower-start-panel').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      for (const node of result.nodes) {
        assert.equal(node.hidden, hidden, JSON.stringify({ width, phase, node }));
        assert.equal(node.height === 0, hidden, 'actual CSS visibility survives passive rerenders');
      }
      if (phase === 'setup') assert.ok(result.form > 0, 'start/retry controls remain visible');
      evidence.push({ width, phase, ...result });
      if (['setup', 'ready'].includes(phase)) fs.writeFileSync(`${dir}/${phase}-${width}.png`, Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
  }
  fs.writeFileSync(dir + '/evidence.json', JSON.stringify(evidence, null, 2));
  console.log('PASS initial presentation: real common markup/CSS and renderers at 390/1000; setup/retry stays hidden, ready/later acts/terminal/archive/story stay visible through repeated polling.');
} finally { socket?.close(); edge.kill(); }
