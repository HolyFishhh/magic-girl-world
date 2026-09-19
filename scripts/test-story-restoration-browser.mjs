import fs from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import webpack from 'webpack';
import {compile} from 'sass';
import WebSocket from 'ws';
const out=resolve('tmp/story-restoration-browser');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(resolve(out,'loader.cjs'), "const ts=require('typescript');module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText}");
fs.writeFileSync(resolve(out,'entry.ts'), `
import {renderStoryPanel} from '../../src/runtime/storyPanel';
import {renderCharacterStatus} from '../../src/shared/characterStatus';
let variables:any={stat_data:{game_mode:'story',game_mode_lock:{schemaVersion:1,mode:'story'},status:{profession:{name:'星火旅者',ability:'操纵星火'},time:'清晨',location:'钟楼',clothing:{upper_body:'银色披风'},inventory:['旧钥匙'],permanent_status:['魔法契约'],temporary_status:['疲惫']},npcs:{guide:{name:'引路人',affection:42,affection_level:'信赖',relationship:'同行的伙伴',appearance:'银发'.repeat(80)}},factions:{player_alignment:'中立',invasion:1,relations:[]},battle:{core:{hp:60,max_hp:80,lust:0,max_lust:100},cards:[]}}};
Object.assign(window,{getVariables:()=>variables,replaceVariables:()=>{throw Error('read only')},updateVariablesWith:()=>{throw Error('read only')},insertOrAssignVariables:()=>{},getCurrentMessageId:()=>0,getLastMessageId:()=>0,getChatMessages:()=>[{message:'清晨，你来到钟楼。'}]});
const render=()=>{renderStoryPanel('common');const fold=document.querySelector<HTMLDetailsElement>('#mwg-status-fold')!;fold.open=true;renderCharacterStatus(variables.stat_data);};
const tower=()=>{Object.assign(variables.stat_data,{game_mode:'tower',game_mode_lock:{schemaVersion:1,mode:'tower'},run:{seed:7,phase:'awaiting_choice',act:1,floor:2,opening:{phase:'consumed'},visitedNodeIds:['battle'],nodeContent:{battle:{kind:'battle',content:{narrative:'魔偶挡住去路。'}}}},tower_battle_stories:[{seed:7,nodeId:'battle',phase:'pending',summary:'斩击造成6点伤害，胜利',narrative:''}]});render();};
const complete=()=>{variables.stat_data.tower_battle_stories[0].phase='ready';variables.stat_data.tower_battle_stories[0].narrative='魔偶倒下，星火照亮前路。'.repeat(40);render();};
const next=()=>{variables.stat_data.run.phase='in_node';variables.stat_data.run_node={node_id:'next',narrative:'你走进新的房间。'};render();};
(window as any).fixture={render,tower,complete,next,variables:()=>variables,restore:()=>{variables=JSON.parse(JSON.stringify(variables));render();}};render();
`);
const css=compile('src/common/index.scss',{style:'expanded'}).css;
fs.writeFileSync(resolve(out,'index.html'),`<!doctype html><html><meta charset="utf-8"><style>${css}</style><body><div id="tower-player-panel"></div><div id="tower-node-panel-root"></div><div id="tower-map-root">路线图</div><div id="choice-container"></div><script src="bundle.js"></script></body></html>`);
await new Promise((done,fail)=>{const compiler=webpack({mode:'development',devtool:false,entry:resolve(out,'entry.ts'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.ts','.js'],alias:{'@':resolve('src')}},module:{rules:[{test:/\.ts$/,use:resolve(out,'loader.cjs')}]}});compiler.run((e,s)=>compiler.close(()=>e||s.hasErrors()?fail(e||s.toString({all:false,errors:true})):done()));});
const port=18179;
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve(out,'profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;try{
 let pages;for(let i=0;i<100;i++){try{pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(pages.length)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(pages?.length);
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});
 let id=0;const pending=new Map();ws.on('message',raw=>{const x=JSON.parse(raw);if(x.id){const p=pending.get(x.id);pending.delete(x.id);x.error?p.j(x.error):p.r(x.result);}});
 const call=(method,params={})=>new Promise((r,j)=>{const n=++id;pending.set(n,{r,j});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const x=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(x.exceptionDetails)throw Error(JSON.stringify(x.exceptionDetails));return x.result.value;};
 const shot=async name=>fs.writeFileSync(resolve(out,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 await call('Page.enable');await call('Runtime.enable');
 for(const width of [390,1000]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'file:///'+resolve(out,'index.html').replaceAll('\\','/')});
  for(let i=0;i<100;i++){if(await evaluate('Boolean(window.fixture)'))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await evaluate('Boolean(window.fixture)'),true);
  const story=await evaluate("document.querySelector('.character-story-facts').textContent");for(const text of ['银色披风','旧钥匙','42','信赖','魔法契约','疲惫'])assert.ok(story.includes(text),text);
  await evaluate("document.querySelector('.character-story-facts details').open=true");
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'story content wraps on narrow screen');await shot('story-'+width);
  await evaluate('fixture.restore()');assert.equal(await evaluate("document.querySelector('.character-story-facts').textContent.includes('42')"),true);
  await evaluate('fixture.tower()');assert.equal(await evaluate("Boolean(document.querySelector('.character-story-facts'))"),false,'tower hides story simulation');
  assert.match(await evaluate("document.querySelector('.post-battle-story-status').textContent"),/正在生成/);
  await evaluate('fixture.complete()');assert.equal(await evaluate("document.querySelector('#mwg-story-panel h2').textContent"),'战后剧情');
  assert.equal(await evaluate("document.querySelector('.story-prose').textContent.length"),'魔偶倒下，星火照亮前路。'.repeat(40).length,'full prose not truncated');
  assert.equal(await evaluate("document.querySelector('#mwg-story-panel').compareDocumentPosition(document.querySelector('#tower-map-root')) & Node.DOCUMENT_POSITION_FOLLOWING"),4,'story above map');
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await shot('post-battle-'+width);
  await evaluate('fixture.next()');assert.equal(await evaluate("document.querySelector('.story-prose').textContent"),'你走进新的房间。');assert.match(await evaluate("document.querySelector('.story-reading-pane details').textContent"),/魔偶倒下/,'old prose remains in history');
 }
 console.log('PASS isolated current-source browser: 390/1000px story facts, restore, mode isolation, post-battle pending/full prose/history; '+out);
}finally{ws?.close();edge.kill();}
