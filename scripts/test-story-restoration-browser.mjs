import fs from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import webpack from 'webpack';
import {compile} from 'sass';
import WebSocket from 'ws';
import ts from 'typescript';
// Extract unchanged production renderers: exercise real story data/controls without
// starting the writable common-view lifecycle or a live Tavern connection.
const commonSource=fs.readFileSync('src/common/index.ts','utf8');
const ast=ts.createSourceFile('common.ts',commonSource,ts.ScriptTarget.Latest,true);
const rendererNames=['escapeHtml','renderStatusData','renderNPCData','renderFactionData','renderAlignmentGrid','toggleStatusDetail','renderStoryBattleSupport','renderCollectionSupport','contentRulesHtml','contentDescriptionStatusDefinitions','contentDescriptionStatusNames','contentDescriptionResourceDefinitions','contentDescriptionResourceNames','contentDescriptionEnemyNames','normalizeOptionsList'];
const renderers=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&rendererNames.includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
assert.equal(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&rendererNames.includes(n.name?.text)).length,rendererNames.length);
const out=resolve('tmp/story-restoration-browser');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(resolve(out,'loader.cjs'), "const ts=require('typescript');module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText}");
fs.writeFileSync(resolve(out,'entry.ts'), `
import {renderStoryPanel} from '../../src/runtime/storyPanel';
import {readStatusLocation,readStatusProfession} from '../../src/common/statusAdapter';
import {flattenMvuArray} from '../../src/runtime/mvuArrays';
import {normalizeOptionalMvuNamedEffect} from '../../src/runtime/contentPackAdapter';
import {normalizeMvuList} from '../../src/common/rewardTransactions';
import {renderSupportDetails} from '../../src/shared/supportPresentation';
import {renderStancePanel} from '../../src/shared/stancePresentation';
import {renderRulePills} from '../../src/shared/rulePills';
import {presentCompactContent} from '../../src/game-core/contentPresentation';
import {describeCompactStatus} from '../../src/game-core';
import {collectCardDisplayNames} from '../../src/game-core/cardDisplayNames';
import {collectSummonDisplayNames} from '../../src/game-core/summonDisplayNames';
import {collectStanceDefinitions,collectStanceNames} from '../../src/game-core/stanceIdentityDisplay';
let __STAT__:any;
${renderers}
import {renderCharacterStatus} from '../../src/shared/characterStatus';
let variables:any={stat_data:{game_mode:'story',game_mode_lock:{schemaVersion:1,mode:'story'},status:{profession:{name:'星火旅者',ability:'操纵星火'},time:'清晨',location:'钟楼',clothing:{upper_body:'银色披风'},inventory:['旧钥匙'],permanent_status:[{name:'魔法契约',description:'契约详情应可展开'}],temporary_status:['疲惫']},npcs:{guide:{name:'引路人',affection:42,affection_level:'信赖',relationship:'同行的伙伴',appearance:'银发'.repeat(80)}},factions:{player_alignment:'中立',invasion:1,relations:[{name:'守望者',reputation:12,status:'友善',note:'钟楼的同盟'}]},battle:{core:{hp:60,max_hp:80,lust:0,max_lust:100,resources:[{id:'starlight',name:'星辉',emoji:'🌟',current:2,start:1,max:6}],stance:{id:'guarded',name:'守势',description:'降低受到的伤害。',passiveEffects:[{op:'gain_block',target:'self',amount:2}]},summon_growth:[{summonTemplateId:'spirit',stat:'damage',operator:'add',value:2}]},statuses:[{id:'heated',name:'灼热',description:'每回合造成伤害。'}],player_abilities:[{id:'star_guard',name:'星辉庇佑',trigger:{on:'turn_start',effects:{block:3}}}],player_status_effects:[{id:'heated',stacks:2}],player_lust_effect:{name:'意志反击',effects:{damage:7,to:'opponent'}},cards:[{id:'call_spirit',name:'呼唤灵契',type:'Skill',rarity:'Common',cost:1,effects:{spawn_summon:{id:'spirit',name:'灵契'}}}]}}};
Object.assign(window,{getVariables:()=>variables,replaceVariables:()=>{throw Error('read only')},updateVariablesWith:()=>{throw Error('read only')},insertOrAssignVariables:()=>{},getCurrentMessageId:()=>0,getLastMessageId:()=>0,getChatMessages:()=>[{message:'清晨，你来到钟楼。'}]});
const render=()=>{__STAT__=variables.stat_data;renderStoryBattleSupport(__STAT__.battle);renderStatusData(variables.stat_data);renderNPCData(variables.stat_data);renderFactionData(variables.stat_data);renderStoryPanel('common');const fold=document.querySelector<HTMLDetailsElement>('#mwg-status-fold');if(fold){fold.open=true;renderCharacterStatus(variables.stat_data);}};
const tower=()=>{delete variables.stat_data.run_node;delete variables.mwg_tower_initial_commit;Object.assign(variables.stat_data,{game_mode:'tower',game_mode_lock:{schemaVersion:1,mode:'tower'},run:{seed:7,phase:'awaiting_choice',act:1,floor:2,opening:{phase:'consumed'},visitedNodeIds:['battle'],nodeContent:{battle:{kind:'battle',content:{narrative:'魔偶挡住去路。'}}}},tower_battle_stories:[{seed:7,nodeId:'battle',phase:'pending',summary:'斩击造成6点伤害，胜利',narrative:''}]});render();};
const complete=()=>{variables.stat_data.tower_battle_stories[0].phase='ready';variables.stat_data.tower_battle_stories[0].narrative='魔偶倒下，星火照亮前路。'.repeat(40);render();};
const next=()=>{variables.stat_data.run.phase='in_node';variables.stat_data.run_node={node_id:'next',narrative:'你走进新的房间。'};render();};
(window as any).fixture={render,tower,complete,next,combat:()=>{renderStoryPanel('fish');const fold=renderCharacterStatus(variables.stat_data);document.body.append(fold);fold.open=true;renderCharacterStatus(variables.stat_data);},variables:()=>variables,restore:()=>{variables=JSON.parse(JSON.stringify(variables));render();}};render();
`);
const css=compile('src/common/index.scss',{style:'expanded'}).css;
const commonHtml=fs.readFileSync('src/common/index.html','utf8').replace('</head>',`<style>${css}</style></head>`).replace('</body>','<script src="bundle.js"></script></body>');
fs.writeFileSync(resolve(out,'index.html'),commonHtml);
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
  assert.equal(await evaluate("Boolean(document.querySelector('#mwg-status-fold'))"),false,'story keeps original panels instead of a tower replacement');
  assert.equal(await evaluate("document.querySelector('.mwg-statusbar').classList.contains('is-tower-mode')"),false,'story status never receives the tower presentation class');
  assert.equal(await evaluate("getComputedStyle(document.getElementById('tower-player-panel')).display==='none'"),true,'story status never exposes the tower player panel');
  assert.equal(await evaluate("getComputedStyle(document.getElementById('run-section')).display==='none'"),true,'story status never exposes tower route controls');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.statusbar-panels')).display==='none'"),false);
  assert.equal(await evaluate("document.querySelector('.statusbar-header').hidden"),false);
  assert.equal(await evaluate("Boolean(document.querySelector('#tower-screen-host'))"),false,'story must not reparent actions/rewards into a tower host');
  assert.equal(await evaluate("Boolean(document.querySelector('#mwg-story-panel'))"),false,'ordinary story prose stays in the Tavern message and is never rendered again');
  await evaluate("document.querySelectorAll('.status-panel').forEach(p=>p.open=true);document.getElementById('common-loading-status').remove()");
  for(const text of ['银色披风','旧钥匙','42','信赖','魔法契约','疲惫','守望者','钟楼的同盟'])assert.ok((await evaluate("document.querySelector('.statusbar-panels').textContent")).includes(text),text);
  for(const [id,words] of [['story-player-resources',['星辉','🌟','当前 2','上限 6']],['story-player-abilities',['星辉庇佑','3']],['story-player-statuses',['灼热','2']],['story-player-lust-effect',['意志反击','7']],['story-player-stance',['守势','格挡']],['story-player-summon-growth',['灵契','伤害','增加','2']]]){
    const text=await evaluate(`document.getElementById('${id}').textContent`);for(const word of words)assert.ok(text.includes(word),id+': '+word);
  }
  await evaluate("document.querySelector('[data-status-detail-id]').click()");
  assert.equal(await evaluate("document.getElementById('permanent-status-0').style.display"),'block','original story status detail remains interactive');
  assert.equal(await evaluate("[...document.querySelectorAll('.statusbar-header *, .statusbar-panels *')].filter(e=>e.getClientRects().length && e.getBoundingClientRect().right>document.documentElement.clientWidth+1).length"),0,'visible content is not clipped by an overflow-hidden ancestor');
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'original panels wrap on narrow screen');await shot('story-'+width);
  await evaluate("Object.assign(fixture.variables().stat_data,{run_node:{narrative:'不能展示的旧塔节点'},completed_expedition:{run:{act:3,visitedNodeIds:[]}}});fixture.variables().mwg_tower_initial_commit={narrative:'不能展示的旧塔开局'};fixture.render()");
  assert.equal(await evaluate("Boolean(document.querySelector('#mwg-story-panel'))"),false,'tower caches cannot create a story wrapper in story mode');
  const before=await evaluate('JSON.stringify(fixture.variables())');
  await evaluate('fixture.restore()');assert.equal(await evaluate('JSON.stringify(fixture.variables())'),before,'render and save restore are read only');
  // Battle keeps the original story status structure below the latest combat UI.
  await evaluate('fixture.combat()');
  assert.equal(await evaluate("Boolean(document.querySelector('#mwg-story-panel'))"),false,'story battle renders the battle page without a duplicate prose panel');
  assert.equal(await evaluate("document.querySelector('#mwg-status-fold > summary').textContent"),'剧情状态栏');
  assert.equal(await evaluate("document.querySelector('#mwg-status-fold').classList.contains('mwg-story-status')"),true);
  assert.equal(await evaluate("document.querySelector('#mwg-status-fold').classList.contains('mwg-tower-status')"),false);
  assert.equal(await evaluate("Boolean(document.querySelector('#mwg-status-fold #status-build-details, #mwg-status-fold .tower-player-card-grid'))"),false,'story combat never renders tower build analysis or tower deck structure');
  assert.equal(await evaluate("Boolean(document.querySelector('#mwg-status-fold .story-player-card-grid'))"),true);
  const battleStatus=await evaluate("document.querySelector('#mwg-status-fold').textContent");for(const text of ['我方欲望效果','意志反击','守势','召唤成长','灵契'])assert.ok(battleStatus.includes(text),text);
  const story=await evaluate("document.querySelector('.character-story-facts').textContent");for(const text of ['银色披风','旧钥匙','42','信赖','魔法契约','疲惫'])assert.ok(story.includes(text),text);
  await evaluate("document.querySelector('#mwg-status-fold').scrollIntoView({block:'start'})");await shot('story-battle-status-'+width);
  await evaluate("fixture.variables().stat_data.battle.player_lust_effect={name:'',description:'',$meta:{extensible:true}};fixture.combat()");
  assert.equal(await evaluate("document.querySelector('.character-desire').textContent.includes('欲望满溢')"),false,'empty optional desire scaffold is not invented in the story status');
  assert.match(await evaluate("document.querySelector('.character-desire').textContent"),/暂无/);
  await evaluate("fixture.variables().stat_data.battle.player_lust_effect={name:'意志反击',effects:{damage:7,to:'opponent'}};fixture.combat()");
  await evaluate('fixture.render()');
  assert.equal(await evaluate("Boolean(document.querySelector('#mwg-status-fold'))"),false);
  await evaluate("const map=document.createElement('div');map.id='tower-map-root';document.body.append(map)");
  await evaluate('fixture.tower()');assert.equal(await evaluate("Boolean(document.querySelector('.character-story-facts'))"),false,'tower hides story simulation');
  assert.match(await evaluate("document.querySelector('.post-battle-story-status').textContent"),/正在生成/);
  await evaluate('fixture.complete()');assert.equal(await evaluate("document.querySelector('#mwg-story-panel h2').textContent"),'战后剧情');
  assert.equal(await evaluate("document.querySelector('.story-prose').textContent.length"),'魔偶倒下，星火照亮前路。'.repeat(40).length,'full prose not truncated');
  const collapsedStory=await evaluate(`(()=>{const root=document.getElementById('mwg-story-panel'),reading=root.querySelector('.story-reading-pane'),button=root.querySelector('.story-panel-toggle');return {height:root.offsetHeight,reading:reading.clientHeight,scroll:reading.scrollHeight,label:button.textContent,expanded:button.getAttribute('aria-expanded')}})()`);
  assert.equal(collapsedStory.label,'展开全部');assert.equal(collapsedStory.expanded,'false');
  await evaluate("document.querySelector('.story-panel-toggle').click()");
  const expandedStory=await evaluate(`(()=>{const root=document.getElementById('mwg-story-panel'),reading=root.querySelector('.story-reading-pane'),button=root.querySelector('.story-panel-toggle');return {height:root.offsetHeight,overflow:getComputedStyle(reading).overflowY,label:button.textContent,expanded:button.getAttribute('aria-expanded')}})()`);
  assert.equal(expandedStory.label,'收起');assert.equal(expandedStory.expanded,'true');assert.equal(expandedStory.overflow,'visible');if(width===390)assert.ok(expandedStory.height>collapsedStory.height);
  await shot('post-battle-expanded-'+width);
  await evaluate("document.querySelector('.story-panel-toggle').click()");assert.equal(await evaluate("document.querySelector('.story-panel-toggle').textContent"),'展开全部');
  assert.equal(await evaluate("document.querySelector('#mwg-story-panel').compareDocumentPosition(document.querySelector('#tower-map-root')) & Node.DOCUMENT_POSITION_FOLLOWING"),4,'story above map');
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await shot('post-battle-'+width);
  await evaluate('fixture.next()');assert.equal(await evaluate("document.querySelector('.story-prose').textContent"),'你走进新的房间。');assert.match(await evaluate("document.querySelector('.story-reading-pane details').textContent"),/魔偶倒下/,'old prose remains in history');
 }
 console.log('PASS isolated current-source browser: 390/1000px story facts, restore, mode isolation, post-battle pending/full prose/history; '+out);
}finally{ws?.close();edge.kill();}
