import fs from 'node:fs';import path from 'node:path';import webpack from 'webpack';import {compile} from 'sass';
const dir=path.resolve('tmp/ui-v461-play');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/loader.cjs',"const ts=require('typescript');module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText}");
fs.writeFileSync(dir+'/entry.ts',`import $ from 'jquery';(window as any).$=$;
import {showBattleDialogue} from '../../src/fish/ui/battleDialogue';
(window as any).speak=showBattleDialogue;
import {CardPlayMode} from '../../src/fish/ui/cardPlayMode';
import {BattleUI} from '../../src/fish/ui/battleUI';
import {AnimationManager} from '../../src/fish/ui/animationManager';
import {stageHealthBar} from '../../src/fish/ui/stageUnitDisplay';
import {GameStateManager} from '../../src/fish/core/gameStateManager';
import {TavernCardInteractionPresenter} from '../../src/fish/ui/cardInteractionPresenter';
import {DynamicStatusManager} from '../../src/fish/combat/dynamicStatusManager';
const ui:any=BattleUI, anim:any=AnimationManager.getInstance();
(window as any).fullUI=ui;(window as any).fullAnim=anim;
const state:any=GameStateManager.getInstance().getGameState();
const program=(steps:any[])=>({spec:'mwg.effect/v1',steps});
DynamicStatusManager.getInstance().registry.replace([{id:'growth',name:'成长',emoji:'🌱',type:'buff',triggers:{tick:{heal:1,to:'self'}}}]);
const enemies:any[]=[{id:'first',name:'火焰',emoji:'🔥',currentHp:12,maxHp:34,block:5,statusEffects:[{id:'growth',stacks:2}],abilities:[],nextAction:{name:'增强',effectProgram:program([{op:'apply_status',target:'self',status:'growth',stacks:1}])}},{id:'second',name:'齿轮',emoji:'⚙️',currentHp:24,maxHp:24,block:0,statusEffects:[],abilities:[],nextAction:{name:'攻击',effectProgram:program([{op:'damage',target:'opponent',amount:6}])}}];
enemies.forEach((e,i)=>{e.stageSlot=i+1;e.actions=[e.nextAction];}); enemies.push(...Array.from({length:2},(_,i)=>({...enemies[1],id:'extra'+i,name:'增援'+i,stageSlot:i+3})));
state.enemies=enemies;state.enemy=enemies[0];state.player={...state.player,currentHp:70,maxHp:70,block:7,statusEffects:[],abilities:[]};
GameStateManager.getInstance().replaceState(state);
$('#stage-player-health').html(stageHealthBar(70,70,'玩家',7));
anim.syncStageHealthBar('player',70,70,undefined,7);
ui.updateEnemyStageParty(enemies,'first');
$('.enemy-card .hp-fill').css('width',String(12/34*100)+'%');$('#enemy-hp').text('12/34');
$('.player-card .hp-fill').css('width','100%');$('#player-hp').text('70/70');
const units=Array.from({length:4},(_,i)=>({instanceId:'unit_'+i,templateId:'robot',summonerId:'player',owner:'player',name:'机器人'+i,emoji:'🤖',currentHp:19,maxHp:38,hasHp:true,block:i===0?4:0,statusEffects:i===0?[{id:'growth',stacks:2}]:[],abilities:[],actionsPerActivation:1,plannedActionIds:['guard'],actions:[{id:'guard',name:'护盾',effectProgram:program([{op:'gain_block',target:'self',amount:5}])}]}));
document.getElementById('three').onclick=()=>ui.updateSummonDisplays({living:units.slice(0,3)});
document.getElementById('four').onclick=()=>ui.updateSummonDisplays({living:units});
ui.updateSummonDisplays({living:units.slice(0,1)});
ui.updateHandCardsDisplay(Array.from({length:5},(_,i)=>({id:'hand'+i,name:'测试卡牌'+i,type:'Skill',cost:1,rarity:'Common',emoji:'🛡️',effectProgram:program([{op:'gain_block',target:'self',amount:6}])})));

const result=document.getElementById('result');
(window as any).fixture={
  reserve(){GameStateManager.getInstance().setEnemies([...enemies,...Array.from({length:3},(_,i)=>({...enemies[1],id:'reserve'+i,name:'后备'+i,stageSlot:undefined}))]);ui.updateEnemyStageParty(GameStateManager.getInstance().getEnemies(),'first');},
  select(){const list=Array.from({length:4},(_,i)=>({id:'choice'+i,name:'完整长规则卡牌'+i,type:'Skill',cost:1,rarity:'Common',emoji:'🛡️',effectProgram:program(Array.from({length:10},()=>({op:'gain_block',target:'self',amount:6})))}));void TavernCardInteractionPresenter.getInstance().selectCards(list as any,{title:'选择两张卡',minimum:2,maximum:2,allowCancel:true}).then(x=>result.dataset.selection=JSON.stringify(x));},
  die(){const p=anim.animateEnemyDefeat('first');result.dataset.immediate=String(!!document.querySelector('.enemy-departing'));void p.then(()=>result.dataset.died='true');}
};

document.getElementById('sequence').onclick=async()=>{const trace:any[]=[];for(const [index,kind] of ['skill','attack','attack'].entries()){const start=performance.now();const pending=anim.playCombatAction(index===0?'player':'enemy',kind,index===0?'🛡️':'⚔️','序列'+index,index===0?'self':'opponent');await anim.waitForActionPresentation();trace.push({index,elapsed:Math.round(performance.now()-start),remaining:document.querySelectorAll('.stage-action-token').length});await pending;}result.textContent=JSON.stringify(trace);};
document.getElementById('hit').onclick=()=>{const first=enemies[0];first.currentHp=Math.max(0,first.currentHp-7);anim.updateHealthBarWithAnimation('enemy',first.currentHp,first.maxHp,'first',first.block);ui.updateEnemyStageParty(enemies,'first');const loss=document.querySelector('[data-enemy-id="first"] .stage-health-loss') as HTMLElement|null;result.dataset.lossAfterRefresh=String(!!loss&&Number(loss.style.opacity)>0);result.textContent='火焰受击后已走真实敌方舞台刷新，残影继续收缩';};
document.getElementById('break').onclick=()=>{const first=enemies[0];if(first.block<=0){first.block=5;ui.updateEnemyStageParty(enemies,'first');}first.block=0;anim.showShieldBreak('enemy','first');result.textContent='火焰护甲破碎';};
document.getElementById('summon-hit').onclick=()=>{const unit=units[0];unit.currentHp=Math.max(0,unit.currentHp-6);anim.updateSummonHealthBar('player',unit.instanceId,unit.currentHp,unit.maxHp,unit.block);ui.updateSummonDisplays({living:units.slice(0,1)});const loss=document.querySelector('[data-summon-id="unit_0"] .stage-health-loss') as HTMLElement|null;result.dataset.summonLossAfterRefresh=String(!!loss&&Number(loss.style.opacity)>0);result.textContent='机器人受击后已走真实召唤舞台刷新，残影继续收缩';};
document.getElementById('kill').onclick=async()=>{const stage=document.getElementById('battle-stage').getBoundingClientRect(),first=document.querySelector('[data-enemy-id="first"] .stage-emoji').getBoundingClientRect();result.dataset.anchor=String(first.left-stage.left+first.width/2);anim.lastActionStartedAt=Date.now();anim.showDamageNumber('enemy',12,'damage','first');enemies[0].currentHp=0;state.enemy=enemies[1];ui.updateEnemyStageParty(enemies,'second');const started=Date.now();result.textContent='死亡动画中';await anim.animateEnemyDefeat('first');result.dataset.duration=String(Date.now()-started);state.enemies=[enemies[1]];ui.updateEnemyStageParty(state.enemies,'second');result.textContent='动画后移除';};
new MutationObserver(()=>{const pop=document.querySelector('.physics-damage');if(pop)result.dataset.effectLeft=(pop as HTMLElement).style.left;}).observe(document.getElementById('battle-stage'),{childList:true});`);
fs.appendFileSync(dir+'/entry.ts',"\nconst mode:any=CardPlayMode.getInstance();mode.init();\n(window as any).playFixture={};\nconst handCard=()=>window.$('#hand-cards>.mwg-card').first();\ndocument.getElementById('play-slow').onclick=()=>{const c=handCard();c.addClass('clickable');const info:any=(window as any).playFixture;info.started=performance.now();info.ready=null;info.removed=null;const el=c.get(0);new MutationObserver(()=>{if(!el.isConnected&&info.removed===null)info.removed=performance.now()-info.started}).observe(document.body,{childList:true,subtree:true});c.on('mwg:play-card',async()=>{await TavernCardInteractionPresenter.getInstance().animateCardPlay(String(c.attr('data-card-id')));info.ready=performance.now()-info.started;const r=el.getBoundingClientRect(),stage=document.getElementById('battle-stage').getBoundingClientRect();info.arrivalError=Math.hypot(r.left+r.width/2-(stage.left+stage.width/2),r.top+r.height/2-(stage.top+stage.height*.46));});mode.requestPlay(c);};\n");
const original=fs.readFileSync('src/fish/index.html','utf8');
const controls='<div id="fixture-controls">'+['play-slow','three','four','sequence','hit','break','summon-hit','kill'].map(id=>'<button id="'+id+'">'+id+'</button>').join('')+'<p id="result"></p></div>';
fs.writeFileSync(dir+'/index.html',original.replace('</head>','<style>'+compile('src/fish/index.scss',{silenceDeprecations:['import','global-builtin','color-functions']}).css+'</style></head>').replace('<body>','<body>'+controls).replace('</body>','<script src="app.js"></script></body>'));
await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry:dir+'/entry.ts',output:{path:dir,filename:'app.js'},resolve:{extensions:['.ts','.js'],alias:{'@':path.resolve('src')}},plugins:[new webpack.ProvidePlugin({$:'jquery',jQuery:'jquery'})],module:{rules:[{test:/\.ts$/,use:dir+'/loader.cjs'}]}}).run((e,s)=>e||s.hasErrors()?reject(e||s.toString({all:false,errors:true})):resolve()));console.log(dir);
