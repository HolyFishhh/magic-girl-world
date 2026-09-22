// Real production renderers, handlers, selector and transactions; synthetic MVU
// persistence only, in a fresh browser inside a tall message iframe.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import webpack from 'webpack';
import { compile } from 'sass';
import ts from 'typescript';
import WebSocket from 'ws';

const out = fs.mkdtempSync(resolve('tmp/story-deck-ui-'));
const source = fs.readFileSync('src/common/index.ts', 'utf8');
const ast = ts.createSourceFile('common.ts', source, ts.ScriptTarget.Latest, true);
const names = ['escapeHtml','normalizeOptionsList','towerRarity','translateCardType','contentCardCostLabel',
  'contentDescriptionStatusDefinitions','contentDescriptionStatusNames','contentDescriptionResourceDefinitions',
  'contentDescriptionResourceNames','contentDescriptionEnemyNames','contentRulesHtml','renderCollectionCard',
  'renderCollectionSupport','battleItemUsageHtml','renderStoryBattleSupport','renderBattleData',
  'toggleDeleteMode','syncStoryRemovalControls','removeCard','setSendingState','clearSendingOwner',
  'selectedGameMode','offerPendingCardRemovals','schedulePendingCardRemovals'];
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(functions.length, names.length);
const rarity = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'CARD_RARITY_LABELS')).getText(ast);
fs.writeFileSync(resolve(out, 'entry.ts'), `
import {flattenMvuArray} from '../../src/runtime/mvuArrays';
import {normalizeMvuList} from '../../src/common/rewardTransactions';
import {normalizeOptionalMvuNamedEffect} from '../../src/runtime/contentPackAdapter';
import {renderCardFace} from '../../src/shared/cardFace';
import {renderRulePills} from '../../src/shared/rulePills';
import {renderSupportDetails} from '../../src/shared/supportPresentation';
import {renderStancePanel} from '../../src/shared/stancePresentation';
import {presentCompactContent} from '../../src/game-core/contentPresentation';
import {expandBuiltinStatusDefinitions} from '../../src/game-core/builtinStatusCatalog';
import {collectCardDisplayNames} from '../../src/game-core/cardDisplayNames';
import {collectSummonDisplayNames} from '../../src/game-core/summonDisplayNames';
import {collectStanceDefinitions,collectStanceNames} from '../../src/game-core/stanceIdentityDisplay';
import {migratePersistentRunDeck,describeCardCost,readGameMode} from '../../src/game-core';
import {requiredExperienceForLevel} from '../../src/common/progression';
import {BATTLE_ITEM_USAGE_LABEL} from '../../src/game-core/battleItemUsage';
import {TavernRunActionHost} from '../../src/common/runActionHost';
import {PendingCardRemoval} from '../../src/common/pendingCardRemoval';
import {choosePendingCardRemoval} from '../../src/common/nonCombatSelection';
let __STAT__:any, __BATTLE_BOOK_DATA:any, __IS_SENDING_ACTION=false, __sendingOwner:symbol|undefined;
let __commonViewInitialized=true, __commonViewSequence=1, pendingRemovalTimer:any=null, pendingRemovalAbort:any=null;
const pendingCardRemoval=new PendingCardRemoval(), __USER_MUTATION_PILLS:string[]=[];
let variables:any, latest=true, failSave=false, writes=0;
const isCurrentMessageLatest=()=>latest;
const getCurrentMessageVariables=()=>variables;
const getStatRootRef=(value:any)=>value.stat_data;
const setRunButtonsDisabled=()=>{};
const maybeOpenTowerBattle=()=>{};
const messages:string[]=[];
const toastr={success:(text:string)=>messages.push(text),error:(text:string)=>messages.push(text)};
const showRunError=(error:Error)=>messages.push(error.message);
const renderDeckArchetypeProfile=()=>{};
const runActionHost=new TavernRunActionHost({isLatest:()=>latest,initialPublicationReady:()=>true,
 updateVariablesWith:async(updater:any)=>{const draft=structuredClone(variables);await updater(draft);if(failSave)throw Error('synthetic save failure');variables=JSON.parse(JSON.stringify(draft));writes++;return variables;},
 continueWithPrompt:async()=>{throw Error('no model calls permitted');}} as any);
${rarity}
${functions.map(node => node.getText(ast)).join('\n')}
const card=(instance:string,extra={})=>({id:'shared',runInstanceId:instance,name:'银星斩',type:'Attack',cost:1,rarity:'Common',emoji:'🃏',effects:{damage:6},description:'完整剧情描述。'.repeat(35),...extra});
const reset=(mode='story',count=2)=>{latest=true;failSave=false;writes=0;messages.length=0;pendingCardRemoval.resetDismissal();
 variables={stat_data:{game_mode:mode,game_mode_lock:{schemaVersion:1,mode},run_transaction_revision:0,battle:{level:1,exp:0,core:{hp:60,max_hp:80,lust:0,max_lust:100,card_removal_count:count},cards:[card('copy-1'),card('copy-2',{name:'银星斩·强化',effects:{damage:9}}),card('long',{name:'长名称卡牌与多条独立特性测试',type:'Skill',innate:true,retain:true,ethereal:true,effects:[{block:6},{draw:2},{damage:3},{energy:1}]})],artifacts:[],items:[]}}};
 document.getElementById('battle-deck')!.classList.remove('delete-mode');render();};
function render(){__STAT__=variables.stat_data;renderBattleData(__STAT__);}
async function loadGameData(){render();}
const deck=document.getElementById('battle-deck')!.closest('section')!;
// Keep the actual story deck section and its controls, without starting the
// writable full Tavern lifecycle or replacing it with hand-built cards.
document.body.replaceChildren(deck);
document.getElementById('delete-mode-toggle')!.addEventListener('click',toggleDeleteMode);
(window as any).fixture={reset,render,stat:()=>variables.stat_data,writes:()=>writes,messages:()=>messages,
 fail:(value:boolean)=>{failSave=value},historical:()=>{latest=false;render()},bumpRevision:()=>{variables.stat_data.run_transaction_revision++},
 schedule:schedulePendingCardRemovals,offer:()=>offerPendingCardRemovals(true),
 count:(value:number)=>{variables.stat_data.battle.core.card_removal_count=value;render()},
 empty:()=>{variables.stat_data.battle.cards=[];render()},
 busy:()=>__IS_SENDING_ACTION};
reset();
`);
const css = compile('src/common/index.scss', { silenceDeprecations: ['import','global-builtin','color-functions'] }).css;
const html = fs.readFileSync('src/common/index.html','utf8').replace('</head>', `<style>${css}</style></head>`).replace('</body>','<script src="app.js"></script></body>');
fs.writeFileSync(resolve(out,'inner.html'), html);
fs.writeFileSync(resolve(out,'index.html'), '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:2400px}</style><div style="height:900px">隔离酒馆前文</div><iframe src="inner.html"></iframe><div style="height:800px"></div>');
await new Promise((done,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:resolve(out,'entry.ts'),output:{path:out,filename:'app.js'},resolve:{extensions:['.ts','.js']},module:{rules:[{test:/\.ts$/,exclude:/node_modules/,use:{loader:'ts-loader',options:{transpileOnly:true}}}]}});compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):done()));});
const server=createServer((request,response)=>{const name=(request.url||'/').slice(1)||'index.html';if(!['index.html','inner.html','app.js'].includes(name)){response.writeHead(404).end();return;}response.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');response.end(fs.readFileSync(resolve(out,name)));});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const child=spawn(process.env.MWG_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${out}/profile`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(done=>setTimeout(done,ms));let socket,serial=0;const pending=new Map();
try {
 let port;for(let i=0;i<100;i++){try{port=Number(fs.readFileSync(`${out}/profile/DevToolsActivePort`,'utf8').split('\n')[0]);if(port)break;}catch{}await pause(100);}assert.ok(port);
 const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
 await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject)});
 socket.on('message',raw=>{const value=JSON.parse(raw),p=pending.get(value.id);if(!p)return;pending.delete(value.id);clearTimeout(p.timer);value.error?p.reject(Error(JSON.stringify(value.error))):p.done(value.result);});
 const call=(method,params={})=>new Promise((done,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},15000);pending.set(id,{done,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const inside=expression=>evaluate(`(()=>{const w=document.querySelector('iframe').contentWindow,d=w.document,f=w.fixture;return (${expression})})()`);
 const screenshot=async name=>fs.writeFileSync(resolve(out,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await call('Page.enable');await call('Runtime.enable');const sizes=[];
 for(const width of [320,390,540,1200]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
  for(let i=0;i<80;i++){if(await inside('!!f'))break;await pause(100);}assert.equal(await inside('!!f'),true,'real renderer initialized');
  await evaluate('scrollTo(0,860)');
  await inside('f.schedule(),f.offer()');await pause(150);
  assert.equal(await inside('d.querySelectorAll(".non-combat-selection-overlay").length'),0,'story allowance never auto-opens the tower selector');
  assert.equal(await inside('f.writes()'),0);
  await inside('d.querySelector("#delete-mode-toggle").click()');
  const geometry=await inside(`(()=>{const card=d.querySelector('.collection-card'),button=card.querySelector('.card-delete-btn'),face=card.querySelector('.mwg-card');return {width:w.innerWidth,documentWidth:d.documentElement.scrollWidth,buttonHeight:button.getBoundingClientRect().height,buttonTop:button.getBoundingClientRect().top,cardBottom:face.getBoundingClientRect().bottom,pressed:d.querySelector('#delete-mode-toggle').getAttribute('aria-pressed')}})()`);
  assert.ok(geometry.documentWidth<=width);assert.ok(geometry.buttonTop>=geometry.cardBottom);assert.equal(geometry.pressed,'true');assert.ok(geometry.buttonHeight>=(width<=540?44:36));sizes.push(geometry);
  if(width===390||width===1200)await screenshot('inline-removal-'+width);
  await inside('f.render()');assert.equal(await inside('d.querySelectorAll(".card-delete-btn:not([hidden])").length'),3,'refresh preserves active deletion mode');
  await inside('d.querySelector(".card-preview-trigger").click()');await pause(50);
  const preview=await evaluate(`(()=>{const frame=document.querySelector('iframe'),d=frame.contentDocument,p=d.querySelector('.mwg-card-preview'),r=p.getBoundingClientRect(),offset=frame.getBoundingClientRect().top;return {top:r.top+offset,bottom:r.bottom+offset,right:r.right,left:r.left,flavor:getComputedStyle(d.querySelector('.mwg-card-preview .card-flavor-footer')).display,text:p.textContent,scroll:scrollY}})()`);
  assert.ok(preview.top>=0&&preview.bottom<=800&&preview.left>=0&&preview.right<=width,JSON.stringify(preview));assert.notEqual(preview.flavor,'none');assert.ok(preview.text.includes('完整剧情描述。'.repeat(35)));assert.equal(preview.scroll,860);
  if(width===390)await screenshot('complete-preview-390');
  await inside('d.querySelector(".mwg-card-preview > button").click()');
 }
 // Exact duplicate identity, double clicks, failure rollback, stale revisions,
 // continued deletion after refresh, depleted/empty/historical deck controls.
 await inside('f.reset(),d.querySelector("#delete-mode-toggle").click(),f.fail(true),d.querySelectorAll(".card-delete-btn")[1].click()');await pause(80);
 assert.equal(await inside('f.stat().battle.cards.length'),3);assert.equal(await inside('f.stat().battle.core.card_removal_count'),2);assert.equal(await inside('f.busy()'),false);
 await inside('f.fail(false),f.bumpRevision(),d.querySelectorAll(".card-delete-btn")[1].click()');await pause(80);assert.equal(await inside('f.writes()'),0);
 await inside('f.render(),d.querySelectorAll(".card-delete-btn")[1].click(),d.querySelectorAll(".card-delete-btn")[1].click()');await pause(80);
 assert.deepEqual(await inside('f.stat().battle.cards.map(card=>card.runInstanceId)'),['copy-1','long']);assert.equal(await inside('f.writes()'),1);assert.equal(await inside('f.stat().battle.core.card_removal_count'),1);
 assert.equal(await inside('d.querySelector("#delete-mode-toggle").getAttribute("aria-pressed")'),'true');
 await inside('d.querySelector(".card-delete-btn").click()');await pause(80);
 assert.equal(await inside('f.stat().battle.core.card_removal_count'),0);assert.equal(await inside('d.querySelector("#delete-mode-toggle").disabled'),true);assert.equal(await inside('d.querySelectorAll(".card-delete-btn:not([hidden])").length'),0);
 await inside('f.count(1),f.historical()');assert.equal(await inside('d.querySelector("#delete-mode-toggle").disabled'),true);
 await inside('f.reset(),f.empty()');assert.equal(await inside('d.querySelector("#delete-mode-toggle").disabled'),true);assert.equal(await inside('f.stat().battle.core.card_removal_count'),2);
 // Tower keeps its modal, pinned to the visible host viewport. The card list
 // scrolls independently and the footer stays accessible.
 await inside('f.reset("tower"),void f.offer()');await pause(100);
 const modal=await evaluate(`(()=>{const f=document.querySelector('iframe'),d=f.contentDocument,p=d.querySelector('.non-combat-selection-dialog'),r=p.getBoundingClientRect(),b=d.querySelector('.non-combat-selection-footer').getBoundingClientRect(),c=d.querySelector('.non-combat-selection-content');return {top:r.top+f.getBoundingClientRect().top,bottom:r.bottom+f.getBoundingClientRect().top,footerBottom:b.bottom+f.getBoundingClientRect().top,contentHeight:c.clientHeight,scroll:scrollY}})()`);
 assert.ok(modal.top>=0&&modal.bottom<=800&&modal.footerBottom<=800);assert.ok(modal.contentHeight>=200);assert.equal(modal.scroll,860);
 await inside('d.querySelector(".non-combat-selection-footer button").click()');await pause(60);assert.equal(await inside('f.writes()'),0);assert.equal(await inside('f.stat().battle.core.card_removal_count'),2);
 // Details must not select a card, and selecting its face must not open a preview.
 await inside('f.count(1),void f.offer()');await pause(80);
 await inside('d.querySelector(".non-combat-selection-option .card-preview-trigger").click()');
 assert.equal(await inside('d.querySelectorAll(".non-combat-selection-option.is-selected").length'),0);
 assert.equal(await inside('!!d.querySelector(".mwg-card-preview")'),true);
 await inside('d.querySelector(".mwg-card-preview > button").click(),d.querySelectorAll(".non-combat-selection-option .mwg-card")[1].click()');
 assert.equal(await inside('!!d.querySelector(".mwg-card-preview")'),false);
 assert.equal(await inside('d.querySelectorAll(".non-combat-selection-option.is-selected").length'),1);
 await inside('d.querySelector(".non-combat-selection-footer button:last-child").click()');await pause(80);
 assert.equal(await inside('f.writes()'),1);assert.equal(await inside('f.stat().battle.core.card_removal_count'),0);
 assert.deepEqual(await inside('f.stat().battle.cards.map(card=>card.runInstanceId)'),['copy-1','long']);
 fs.writeFileSync(resolve(out,'evidence.json'),JSON.stringify({passed:true,sizes,modal,storyNoPopup:true,exactIdentity:true,saveFailurePreserves:true,doubleClickProtected:true,fullPreview:true,playerDataWritten:false,fullTavernPlaytest:false},null,2));
 console.log('PASS story inline removal, identity/rollback/reload, mode isolation, tall-frame selectors and 320/390/540/1200 UI: '+out);
 await call('Browser.close');
} finally {socket?.close();child.kill();server.close();for(const p of pending.values())clearTimeout(p.timer);}
