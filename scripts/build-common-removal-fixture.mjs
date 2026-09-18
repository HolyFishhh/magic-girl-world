import fs from 'node:fs';
import path from 'node:path';
import webpack from 'webpack';
import { compile } from 'sass';

const fixture = path.resolve('tmp/common-removal-v461');
fs.mkdirSync(fixture, { recursive: true });
fs.writeFileSync(path.join(fixture, 'loader.cjs'), "const ts=require('typescript');module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText");
const common = fs.readFileSync('src/common/index.ts', 'utf8');
const take = name => {
  const found = common.match(new RegExp(`function ${name}\\([\\s\\S]*?(?=\\n(?:/\\*\\*)?function )`));
  if (!found) throw new Error(`Unable to extract ${name}`);
  return found[0];
};
const helpers = ['towerRarity', 'renderCollectionCard', 'renderTowerPlayerSummary'].map(take).join('\n');
const entry = `
import { PendingCardRemoval } from '../../src/common/pendingCardRemoval';
import { choosePendingCardRemoval } from '../../src/common/nonCombatSelection';
import { executeUnifiedRunTransactionInStat } from '../../src/common/runTransactions';
import { createRunState } from '../../src/game-core/runState';
import { renderTowerScreen } from '../../src/common/towerScreenPresentation';
import { mountTowerApp } from '../../src/tower/towerApp';
import {renderTowerNodePanel} from '../../src/common/towerNodePanel';
import {hasSelectableRewards} from '../../src/common/rewardTransactions';
import {renderShopMarket} from '../../src/common/shopMarket';
import { renderStoryPanel } from '../../src/runtime/storyPanel';
import { migratePersistentRunDeck } from '../../src/game-core/cardProgression';
import { renderCardFace } from '../../src/shared/cardFace';
import { renderSupportDetails } from '../../src/shared/supportPresentation';
import { renderRulePills } from '../../src/shared/rulePills';
const CARD_RARITY_LABELS:any={Common:'普通',Uncommon:'罕见',Rare:'稀有',Epic:'史诗',Legendary:'传说',Corrupt:'腐化'};
const MAX_TOWER_ITEM_SLOTS=3; let __STAT__:any;
const escapeHtml=(v:any)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const normalizeOptionsList=(v:any)=>Array.isArray(v)?v:(v&&typeof v==='object'?Object.values(v):[]);
const readStatusProfession=(s:any)=>s.profession||{};
const towerItemSlotsUsed=(v:any)=>normalizeOptionsList(v).reduce((n:any,x:any)=>n+Math.max(1,Number(x.count)||1),0);
const translateCardType=(v:any)=>({Attack:'攻击',Skill:'技能',Power:'能力',Curse:'诅咒'}[v]||v);
const contentCardCostLabel=(c:any)=>typeof c.cost==='object'?'复合费用':String(c.cost??'—');
const contentRulesHtml=(v:any)=>renderRulePills([String(v.rules||v.description||'暂无可显示的结构化规则')]);
const renderCollectionSupport=(v:any,kind:string,extra='')=>renderSupportDetails(v,{kind,rulesHtml:contentRulesHtml(v),extraHtml:extra});
const isCurrentMessageLatest=()=>true;
${helpers}
document.getElementById('common-loading-status')!.style.display='none';
document.getElementById('run-section')!.style.display='';
const playerPanel=document.getElementById('tower-player-panel')!;
const statusFold=document.createElement('details'); statusFold.id='mwg-status-fold'; statusFold.className='mwg-section-fold is-tower-mode'; statusFold.open=true;
const legacyFold=document.createElement('details'); legacyFold.id='mwg-adventure-fold';
const summary=document.createElement('summary'); summary.textContent='角色状态'; statusFold.append(summary); playerPanel.parentElement!.insertBefore(legacyFold,playerPanel); legacyFold.append(statusFold); statusFold.append(playerPanel);
const story=document.createElement('section'); story.id='mwg-story-panel'; story.innerHTML='<p>隔离地点内容</p>'; document.body.append(story);
const map=document.getElementById('tower-map-root')!; map.innerHTML='<p>隔离路线地图</p>';
const card=(id:string,name:string,description:string,emoji='🃏')=>({id,runInstanceId:id,name,emoji,type:'Skill',rarity:'Common',cost:1,description,rules:'获得6点格挡。回合结束时保留。'.repeat(id==='keep-long'?14:1),effects:{block:6}});
let stat:any={run:createRunState({seed:461}),run_transaction_revision:0,status:{profession:{name:'星辉巡游者',ability:'以极长的能力文本验证概览信息在窄屏内完整换行，且不会压住后续区域。'}},battle:{core:{emoji:'✨',hp:57,max_hp:80,lust:18,max_lust:100,max_energy:3,card_removal_count:1,resources:[{id:'starlight',name:'星辉',emoji:'✦',current:7,max:12,description:'可用于支付带有星辉费用的卡牌与能力。'}]},cards:[card('remove-exact','待移除的精确实例','这张卡会被实际事务按 runInstanceId 移除。'),card('keep-long','长文本保留卡','极长规则说明：'+ '星尘回响会在每次施放后记录本次效果，并在下一个回合开始时根据此前记录的每一种资源分别获得对应层数的防护与抽牌。'.repeat(4))],artifacts:[{id:'relic',name:'曙光棱镜',emoji:'🔮',description:'每场战斗开始时获得1点星辉。'}],items:[{id:'tea',name:'月桂药剂',emoji:'🧪',count:1,description:'战斗中使用：回复10点生命。'}],player_abilities:[{id:'ability',name:'星轨预演',emoji:'🌙',description:'每回合开始时检视下一张卡。'}],player_status_effects:[{id:'status',name:'星屑护幕',emoji:'🛡️',description:'本场获得的格挡不会在回合开始时清空。'}],statuses:[{id:'library',name:'月相共鸣',emoji:'🌗',description:'使用三张不同类型卡后获得1点能量。'}],player_lust_effect:{name:'心潮星语',description:'欲望满时抽2张牌。'}}};
(window as any).MagicGirlDesignAssistant={getDashboard:()=>({snapshot:{deckProfile:{archetypes:[{label:'吸血续航'}],totalScore:248.6}}})};
(window as any).MagicGirlWorldMvuMonitor={openSettings:(section:string)=>(window as any).__settingsSection=section};
Object.assign(window,{getVariables:()=>({stat_data:{...stat,game_mode:'tower'}}),replaceVariables:()=>{},updateVariablesWith:()=>{},insertOrAssignVariables:()=>{},getCurrentMessageId:()=>0,getLastMessageId:()=>0,getChatMessages:()=>[{message:'隔离地点剧情'}]});
const render=()=>{__STAT__=stat;renderTowerPlayerSummary(stat,true);renderStoryPanel('common');}; render();
const queue=new PendingCardRemoval();
const ports:any={active:()=>true,read:()=>stat,choose:choosePendingCardRemoval,commit:async(id:string,revision:number)=>{try{executeUnifiedRunTransactionInStat(stat,{kind:'allowance_remove_card',runInstanceId:id,expectedRevision:revision});}catch(error){(window as any).__fixtureCommitError=String(error);throw error;}},changed:async()=>render()};
document.getElementById('tower-player-resolve-removals')!.addEventListener('click',()=>void queue.offer(ports,true));
const screen=(kind:'map'|'room'|'battle')=>{stat.run={...createRunState({seed:461}),opening:{phase:'consumed'},phase:kind==='map'?'awaiting_choice':'resolving',act:1,floor:1,visitedNodeIds:[kind],currentNode:{kind:kind==='battle'?'battle':'event'}};mountTowerApp({root:map,snapshot:stat.run,title:'冒险路线'});renderTowerScreen(stat,kind==='battle',()=>{});};
(window as any).actBoundaryFixture=()=>{
 stat.run.act=2;stat.run.floor=0;stat.run.phase='awaiting_choice';stat.run.currentNode=null;stat.run.opening={phase:'pending',requestId:null,basedOnRevision:0,attempts:1};stat.reward={card:[stat.battle.cards[0]],artifact:[],item:[],limits:{cards:0,artifacts:0,items:0},gold:132,gold_claimed:true};
 const panel=document.getElementById('tower-node-panel-root')!;
 renderTowerNodePanel({root:panel,stat,run:stat.run,isLatest:true,busy:false,callbacks:{onRetryOpening:()=>{(window as any).openingRetry=true;}}});renderTowerScreen(stat,hasSelectableRewards(stat),()=>{});
 return {rewards:hasSelectableRewards(stat),text:panel.textContent};
};
(window as any).shopFixture=()=>{
 const root=document.getElementById('choice-card')!;document.getElementById('choice-container')!.classList.add('is-shop-market');document.getElementById('choice-container')!.style.display='block';
 document.body.append(document.getElementById('choice-container')!);stat.run.gold=300;stat.reward={card:[stat.battle.cards[0]],artifact:[],item:[],limits:{cards:1,artifacts:0,items:0}};
 renderShopMarket({root,stat,run:stat.run,enabled:true,renderCard:renderCollectionCard,renderSupport:renderCollectionSupport,purchase:async()=>{},removeCard:async id=>{(window as any).removed=id;},leave:async()=>{}});
};
(window as any).routeFocusFixture=()=>{
 const run:any=createRunState({seed:461});const node=run.map.acts[0].nodes.find((n:any)=>n.floor===7);run.currentNode=node;run.visitedNodeIds=[node.id];run.floor=7;run.phase='in_node';run.opening={phase:'consumed'};stat.run=run;
 const app=mountTowerApp({root:map,snapshot:run});renderTowerScreen(stat,false,()=>{});
 (window as any).returnRoute=()=>{run.phase='awaiting_choice';renderTowerScreen(stat,false,()=>{});};
 (window as any).updateRoute=()=>{app.update(run);renderTowerScreen(stat,false,()=>{});};
 return node.id;
};
(window as any).fixture={stat:()=>stat,render,setRemovals:(n:number)=>{stat.battle.core.card_removal_count=n;render()},offer:()=>queue.offer(ports,true),screen}; screen('map');
`;
fs.writeFileSync(path.join(fixture,'empty-style.cjs'), 'module.exports=()=>""');
fs.writeFileSync(path.join(fixture, 'entry.ts'), entry);
let html = fs.readFileSync('src/common/index.html', 'utf8');
html = html.replace('</head>', `<style>${compile('src/common/shopMarket.scss',{silenceDeprecations:['import','global-builtin','color-functions']}).css}${compile('src/tower/index.scss',{silenceDeprecations:['import','global-builtin','color-functions']}).css}${compile('src/common/index.scss',{silenceDeprecations:['import','global-builtin','color-functions']}).css}</style></head>`)
  .replace('</body>', '<script src="app.js"></script></body>');
fs.writeFileSync(path.join(fixture, 'index.html'), html);
await new Promise((resolve, reject) => webpack({ mode:'development', devtool:false, entry:path.join(fixture,'entry.ts'), output:{path:fixture,filename:'app.js'}, resolve:{extensions:['.ts','.js'],alias:{'@':path.resolve('src')}}, module:{rules:[{test:/\.scss$/,use:path.join(fixture,'empty-style.cjs')},{test:/\.ts$/,use:path.join(fixture,'loader.cjs')}]} }).run((error, stats) => error || stats.hasErrors() ? reject(error || stats.toString({all:false,errors:true})) : resolve()));
console.log(fixture);
