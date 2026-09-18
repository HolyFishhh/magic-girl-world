import fs from 'node:fs';import path from 'node:path';import webpack from 'webpack';import {compile} from 'sass';
const dir=path.resolve('tmp/ui-v466');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/loader.cjs',"const ts=require('typescript');module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText}");
fs.writeFileSync(dir+'/entry.ts',`import $ from 'jquery';(window as any).$=$;
import {renderCardFace} from '../../src/shared/cardFace';
import {setBattleLoading,paintBattleLoading} from '../../src/fish/ui/battleLoading';
setBattleLoading(false);
(window as any).loadingFixture=async()=>{
 await paintBattleLoading();
 return {visible:!document.getElementById('battle-loading').hidden,busy:document.getElementById('battle-scene').getAttribute('aria-busy'),inert:(document.querySelector('.battle-main-grid') as HTMLElement).inert};
};
(window as any).finishLoading=()=>setBattleLoading(false);
import {renderCharacterStatus} from '../../src/shared/characterStatus';
import {renderStoryPanel} from '../../src/runtime/storyPanel';
import {renderBattleOverview} from '../../src/fish/ui/battleOverview';
import {createEmptyBattleState} from '../../src/game-core/battleState';
import {convertMvuCards,convertMvuAbilities,convertMvuRelics,convertMvuItems,convertMvuActiveStatuses} from '../../src/fish/core/mvuBattleAdapter';
import {CardPlayQueue,finishQueuedCardVisual} from '../../src/fish/ui/cardPlayQueue';
import {CardPlayMode} from '../../src/fish/ui/cardPlayMode';
import {setRuntimeFrameHeight} from '../../src/runtime/runtimeFrameResize';
import {showBattleDialogue} from '../../src/fish/ui/battleDialogue';
(window as any).speak=showBattleDialogue;
(window as any).enablePhoneCards=()=>{const mode=CardPlayMode.getInstance();mode.init();$('#hand-cards>.mwg-card').each((_,el)=>{const card=$(el);card.addClass('clickable');mode.bindCardEvents(card);});};
(window as any).resizeFrame=setRuntimeFrameHeight;
(window as any).rapid=async()=>{
 const queue=new CardPlayQueue(),trace:any[]=[],pending:Promise<void>[]=[];
 const cards=$('.enhanced-card').slice(0,3); const mode:any=CardPlayMode.getInstance();
 cards.each((i,el)=>{const card=$(el);card.addClass('clickable');card.on('mwg:play-card',()=>{
   pending.push(queue.enqueue(String(i),async()=>{trace.push('start'+i);await card.data('visualPlayReady');await new Promise(r=>setTimeout(r,280));trace.push('end'+i);await finishQueuedCardVisual(card);}));
 });mode.requestPlay(card);});
 const immediate=document.querySelectorAll('.card-cast-flight').length;
 await new Promise(r=>setTimeout(r,250));const held=document.querySelectorAll('.card-cast-flight').length;
 await Promise.all(pending);return {trace,immediate,held,remaining:document.querySelectorAll('.card-cast-flight').length};
};
(window as any).abilityRules=()=>ui.createAbilityHTML({id:'firsthit',name:'嗜血鼻息',trigger:'on_damage',eventQuery:{scope:'turn',ordinal:'first'},effectProgram:program([{op:'gain_block',target:'self',amount:3}])});
import {BattleUI} from '../../src/fish/ui/battleUI';
import {AnimationManager} from '../../src/fish/ui/animationManager';
import {compileCompactEffectList} from '../../src/game-core/compactEffectDsl';
import {stageHealthBar} from '../../src/fish/ui/stageUnitDisplay';
import {GameStateManager} from '../../src/fish/core/gameStateManager';
import {TavernCardInteractionPresenter} from '../../src/fish/ui/cardInteractionPresenter';
import {TavernBattleEffectPresenter} from '../../src/fish/ui/battleEffectPresenter';
import {UnifiedEffectExecutor} from '../../src/fish/combat/unifiedEffectExecutor';
import {EffectProgramDisplay} from '../../src/fish/ui/effectProgramDisplay';
import {DynamicStatusManager} from '../../src/fish/combat/dynamicStatusManager';
const ui:any=BattleUI, anim:any=AnimationManager.getInstance();
(window as any).fullUI=ui;(window as any).fullAnim=anim;
import {bindPileFlowAnimations,batchPileFlows} from '../../src/fish/ui/pileFlowAnimation';
import {renderGenerationEvidencePage} from '../../src/runtime/generationEvidenceView';
(window as any).renderEvidence=renderGenerationEvidencePage;
(window as any).statusLinkFixture=()=>{
 const status={id:'end_mark',name:'终末标记',type:'debuff',maxStacks:99,triggers:{tick:[{damage:4,to:'self',damage_type:'hp_loss'}]}};
 const card={id:'audit',name:'绝对审计',emoji:'👁️',type:'Attack',rarity:'Epic',cost:2,effects:[{damage:12},{apply_status:'end_mark',stacks:4}]};
 const fold=renderCharacterStatus({battle:{core:{},cards:[card],statuses:[status]}});
 document.body.append(fold);return fold.querySelector('.collection-card').textContent;
};
(window as any).pileFlowTest=async(batch=false)=>{
 const manager=GameStateManager.getInstance();const stop=bindPileFlowAnimations();
 const cards=manager.getPlayer().hand;const c=cards[0];manager.updatePlayer({exhaustPile:[c]});
 manager.recordBattleEvent({kind:'card_moved',phase:'after',turn:1,cause:{source:{kind:'card',id:c.id}},actorId:'player',cardInstanceId:c.combatInstanceId||c.id,templateId:c.id,cardType:c.type,from:'hand',to:'exhaustPile',moveReason:'exhausted'} as any);
 await new Promise(r=>setTimeout(r,80));const single=document.querySelectorAll('.pile-flow-token').length;
 const id=document.querySelector<HTMLElement>('.pile-flow-token')?.dataset.cardId;
 const canvas=document.querySelector<HTMLCanvasElement>('.pile-flow-canvas');
 const visibleParticles=canvas ? Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data).some((v,i)=>i%4===3&&v>0) : false;
 const realFace=!!document.querySelector('.pile-flow-card .mwg-card');
 const proxyEmoji=!!document.querySelector('.pile-flow-face');
 await new Promise(r=>setTimeout(r,740));
 await batchPileFlows(async()=>{for(let i=0;i<5;i++)manager.recordBattleEvent({kind:'card_drawn',phase:'after',turn:2,cause:{source:{kind:'system',id:'draw'}},actorId:'player',cardInstanceId:c.combatInstanceId||c.id,templateId:c.id,cardType:c.type,from:'drawPile',to:'hand'});});
 await new Promise(r=>setTimeout(r,80));const grouped=document.querySelectorAll('.pile-flow-token').length,text=document.querySelector('.pile-flow-token')?.textContent;
 await new Promise(r=>setTimeout(r,740));const left=document.querySelectorAll('.pile-flow-token,.pile-flow-bound').length;stop();return {single,id,grouped,text,left,visibleParticles,realFace,proxyEmoji};
};
(window as any).allCardPileFlow=async(direction='discard',cancel=false)=>{
 const manager=GameStateManager.getInstance();
 const cards=Array.from({length:5},(_,i)=>({id:'flow-'+i,combatInstanceId:'flow-'+i,name:'粒子测试'+i,emoji:'✦',type:'Skill',rarity:'Common',cost:0,effectProgram:program([{op:'gain_block',target:'self',amount:i+1}])}));
 const gs:any=manager.getGameState();gs.phase='player_turn';gs.player.hand=cards;gs.player.deck=cards;gs.player.drawPile=[];gs.player.discardPile=[];gs.player.exhaustPile=[];manager.replaceState(gs);ui.updateHandCardsDisplay(cards);
 document.querySelector('.hand-section').scrollIntoView({block:'start'});
 const stop=bindPileFlowAnimations();
 if(direction==='discard')manager.updatePlayer({discardPile:cards});
 await batchPileFlows(async()=>{for(const c of cards)manager.recordBattleEvent({kind:direction==='discard'?'card_moved':'card_drawn',phase:'after',turn:2,cause:{source:{kind:'system',id:'turn'}},actorId:'player',cardInstanceId:c.id,templateId:c.id,cardType:c.type,from:direction==='discard'?'hand':'drawPile',to:direction==='discard'?'discardPile':'hand',...(direction==='discard'?{moveReason:'turn_cleanup'}:{})} as any);});
 if(direction==='discard'){manager.updatePlayer({hand:[]});ui.updateHandCardsDisplay([]);}
 await new Promise(r=>setTimeout(r,75));
 const token=document.querySelector<HTMLElement>('.pile-flow-token');
 const result:any={ids:JSON.parse(token?.dataset.cardIds||'[]'),particles:Number(token?.dataset.particleCount||0),groups:document.querySelectorAll('.pile-flow-token').length,faces:document.querySelectorAll('.pile-flow-card').length,hidden:document.querySelectorAll('#hand-cards .pile-flow-bound').length};
 if(cancel)stop();
 await new Promise(r=>setTimeout(r,600));
 result.left=document.querySelectorAll('.pile-flow-token,.pile-flow-bound,.pile-flow-canvas').length;
 result.visible=[...document.querySelectorAll('#hand-cards .mwg-card')].filter(el=>getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).opacity==='1').length;
 stop();return result;
};
(window as any).delayedDrawFixture=async()=>{
 const manager=GameStateManager.getInstance();const gs:any=manager.getGameState();
 const card:any={id:'late-draw',combatInstanceId:'late-draw',name:'延迟抽牌',emoji:'✦',type:'Skill',rarity:'Common',cost:0,effectProgram:program([{op:'gain_block',target:'self',amount:1}])};
 gs.player.hand=[];manager.replaceState(gs);ui.updateHandCardsDisplay([]);
 const stop=bindPileFlowAnimations();manager.updatePlayer({hand:[card]});
 manager.recordBattleEvent({kind:'card_drawn',phase:'after',turn:2,cause:{source:{kind:'system',id:'draw'}},actorId:'player',cardInstanceId:card.id,templateId:card.id,cardType:card.type,from:'drawPile',to:'hand'});
 await new Promise(r=>setTimeout(r,30));ui.updateHandCardsDisplay([card]);
 const el=document.querySelector<HTMLElement>('[data-card-id="late-draw"]');
 const first=getComputedStyle(el).visibility;
 ui.updateHandCardsDisplay([card]);const rerender=getComputedStyle(el).visibility;
 await new Promise(r=>setTimeout(r,70));const during=getComputedStyle(el).visibility;
 await new Promise(r=>setTimeout(r,600));const after=getComputedStyle(el).visibility;stop();return {first,rerender,during,after};
};
(window as any).deathLayoutFixture=()=>{
 const a={...enemies[0],currentHp:12,stageSlot:0},b={...enemies[1],stageSlot:1};
 const party=document.querySelector('#stage-enemy-party');party.removeAttribute('data-slot-origin');party.removeAttribute('data-multi-layout');(party as HTMLElement).style.minHeight='';
 ui.updateEnemyRoster([a,b],a.id);
 const measure=()=>{const h=document.querySelector('.hand-section').getBoundingClientRect(),p=document.querySelector('#stage-enemy-party').getBoundingClientRect(),e=document.querySelector('#stage-enemy-party [data-enemy-id="'+b.id+'"]').getBoundingClientRect();return {hand:h.top,party:p.height,x:e.x,y:e.y,multi:document.querySelector('.battle-main-grid').classList.contains('multi-enemy-battle')};};
 const before=measure();ui.updateEnemyRoster([b],b.id);return {before,after:measure()};
};
(window as any).complexCards=()=>{
 const curse:any={id:'curse-test',name:'锈念',type:'Curse',rarity:'Legendary',cost:0,retain:true,emoji:'🦠',description:'无法打出；被弃置时失去生命。',effectProgram:program([]),discardEffectProgram:program([{op:'damage',target:'self',amount:3,damageKind:'hp_loss'}])};
 const compiled=compileCompactEffectList({damage:'5 + self.status.growth.stacks * 3',lifesteal:1});if(!compiled.ok)throw Error('compile');
 const attack:any={id:'scaled-test',name:'血纹解放',type:'Attack',rarity:'Rare',cost:1,emoji:'🩸',effectProgram:compiled.value};
 const gs:any=GameStateManager.getInstance().getGameState();gs.phase='player_turn';gs.player.energy=3;gs.player.statusEffects=[{id:'growth',stacks:8}];gs.player.hand=[curse,attack];gs.player.deck=[curse,attack];GameStateManager.getInstance().replaceState(gs);ui.updateHandCardsDisplay(gs.player.hand);
 (window as any).refreshComplex=()=>ui.updateHandCardsDisplay(gs.player.hand);
};
(window as any).enemyPov=()=>{ui.showSupportDetails($('#stage-enemy-party .stage-enemy-member').first(),{name:'淬火余温',trigger:'take_damage',effectProgram:program([{op:'apply_status',target:'self',status:'growth',stacks:1}])},'敌方被动');return $('.support-details-popover').text();};
(window as any).protectionDetails=()=>{
 const ability={id:'guardian',name:'守护者',protection:{mode:'intercept',scope:'specific',targetId:'second'}};
 ui.showSupportDetails($('[data-enemy-id="first"]'),ability,'敌方能力');
 const abilityText=$('.support-details-popover').text();$('.support-details-popover').remove();
 DynamicStatusManager.getInstance().registry.replace([{id:'guard_status',name:'共同承担',type:'buff',emoji:'🛡️',protection:{mode:'share_damage',scope:'specific',targetId:'second'}}]);
 ui.showStatusDetail('guard_status','enemy',{statusEffects:[{id:'guard_status',stacks:1}]});
 const statusText=$('.status-detail-modal').text();$('.status-detail-modal').remove();return {abilityText,statusText};
};

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
ui.updateHandCardsDisplay(Array.from({length:5},(_,i)=>({id:'hand'+i,name:'测试卡牌'+i,type:'Skill',cost:1,rarity:'Common',emoji:'🛡️',description:'以鲜血写下誓约，让微弱的光芒成为守护同伴的力量。',effectProgram:program([{op:'gain_block',target:'self',amount:6}])})));

const result=document.getElementById('result');
(window as any).fixture={
  characterStatus(stat:any,liveMode=false){
    const live:any=createEmptyBattleState(),b=stat.battle,c=b.core;live.battle=b;
    live.player={...live.player,currentHp:c.hp,maxHp:c.max_hp,currentLust:c.lust,maxLust:c.max_lust,energy:c.energy||0,maxEnergy:c.max_energy,deck:convertMvuCards(b.cards),abilities:convertMvuAbilities(b.player_abilities),relics:convertMvuRelics(b.artifacts),items:convertMvuItems(b.items),statusEffects:convertMvuActiveStatuses(b.player_status_effects),resources:Object.fromEntries((c.resources||[]).map((r:any)=>[r.id,r]))};
    Object.assign(window,{getVariables:()=>({stat_data:stat}),replaceVariables:()=>{},updateVariablesWith:()=>{},insertOrAssignVariables:()=>{},getCurrentMessageId:()=>0,getLastMessageId:()=>0,getChatMessages:()=>[{message:'旅者走入星辉长廊，前方传来敌人的脚步声。'}]});
    renderStoryPanel('fish');renderBattleOverview(stat,live);
    const panel=renderCharacterStatus(stat,liveMode?live:undefined);return panel.outerHTML;
  },
  victory(fail=false) {
    (window as any).settled=0;
    TavernBattleEffectPresenter.getInstance().showBattleEndDialog({result:'victory',mode:'tower',battleSummary:'测试战斗',onConfirm:async()=>{
      (window as any).settled++;
      await new Promise<void>(r=>(window as any).releaseVictory=r);
      if(fail)throw Error('测试结算失败');
    }});
  },
  async preview(target='first',factor=1.5) {
    const manager=GameStateManager.getInstance(),gs:any=manager.getGameState();
    const attack={id:'preview-attack',name:'试剑',type:'Attack',cost:1,rarity:'Common',effectProgram:program([{op:'damage',target:'opponent',amount:10}])};
    gs.phase='player_turn';gs.enemies=enemies.slice(0,2);gs.activeEnemyId=target;gs.enemy=gs.enemies.find(e=>e.id===target);
    gs.player={...gs.player,energy:3,statusEffects:[],hand:[attack],deck:[attack],abilities:[],relics:[]};
    gs.enemies.forEach((e:any,i:number)=>{e.currentHp=100;e.maxHp=100;e.block=0;e.statusEffects=i===0?[{id:'vulnerable_test',stacks:1}]:[];e.abilities=[];e.dialogue='守护同伴的施术者，失去同伴后会反击。';});
    DynamicStatusManager.getInstance().registry.replace([{id:'vulnerable_test',name:'易伤',emoji:'💔',type:'debuff',triggers:{hold:{modify:'damage_taken',multiply:factor}}}]);
    manager.replaceState(gs);await ui.refreshBattleUI(manager.getGameState());
    return {hand:$('#hand-cards .card-rules').text(),details:EffectProgramDisplay.getInstance().cardToTags(attack).map(x=>x.text).join('；'),active:$('.stage-enemy-member.is-active').attr('data-enemy-id'),actual:manager.getEnemy()?.id,changed:$('.card-live-damage').text()};
  },
  async previewHit(){const manager=GameStateManager.getInstance(),executor=UnifiedEffectExecutor.getInstance(),before=manager.getEnemy()!.currentHp;await executor.executeEffectProgram(program([{op:'damage',target:'opponent',amount:10}]),true,{cardContext:{id:'preview-attack',type:'Attack',name:'试剑'}});return before-manager.getEnemy()!.currentHp;},
  async groupBuff(){
    const manager=GameStateManager.getInstance();DynamicStatusManager.getInstance().registry.replace([{id:'group_guard',name:'集体防御',emoji:'🛡️',type:'buff',triggers:{}}]);
    const trace:any[]=[];const original=anim.enqueueStageEffect.bind(anim);anim.enqueueStageEffect=(...args:any[])=>{trace.push({side:args[0],id:args[5]});return original(...args);};
    try {await UnifiedEffectExecutor.getInstance().executeEffectProgram(program([{op:'apply_status',target:'self',targetSelector:{mode:'all'},status:'group_guard',stacks:1}]),false,{battleContext:{enemyId:manager.getEnemies()[0].id}});}finally{anim.enqueueStageEffect=original;}
    return {trace,holders:manager.getEnemies().filter(e=>e.statusEffects.some(s=>s.id==='group_guard')).map(e=>e.id)};
  },
  condition(stacks:number,active='first') {
    const gs:any=GameStateManager.getInstance().getGameState();
    const compiled=compileCompactEffectList({damage:16,when:'opponent.status.bleed.stacks >= 2'});
    if(!compiled.ok)throw Error(JSON.stringify(compiled));
    const card:any={id:'condition-card',name:'炼血收割',emoji:'🌑',type:'Attack',cost:1,rarity:'Uncommon',effectProgram:compiled.value};
    gs.phase='player_turn';gs.player.energy=3;gs.player.hand=[card];gs.player.deck=[card];gs.enemies=enemies;
    enemies[0].statusEffects=[{id:'bleed',stacks}];enemies[1].statusEffects=[];gs.enemy=enemies.find(e=>e.id===active);gs.activeEnemyId=active;
    GameStateManager.getInstance().replaceState(gs);ui.updateHandCardsDisplay([card]);
  },
  async impact(){
    const start=performance.now();let started=0;
    document.querySelector('#battle-stage').addEventListener('animationstart',(event:any)=>{if(event.animationName==='mwg-stage-cross')started=performance.now();});
    await anim.playCombatAction('player','attack','🔥','命中测试');
    const elapsed=performance.now()-start;const token=document.querySelector('.stage-action-token');
    anim.showDamageNumber('enemy',9,'damage','first');anim.updateHealthBarWithAnimation('enemy',3,34,'first',0,12);
    const pop=document.querySelector('.physics-damage');
    const rect=token.getBoundingClientRect(), target=document.querySelector('#stage-enemy-emoji').getBoundingClientRect();const contactDistance=Math.hypot(rect.x+rect.width/2-target.x-target.width/2,rect.y+rect.height/2-target.y-target.height/2);const evidence={contactDistance,elapsed,animationElapsed:performance.now()-started,tokenVisible:!!token,popImmediate:!!pop,hp:document.querySelector('#enemy-hp').textContent};
    await anim.waitForActionPresentation();return {...evidence,cleaned:!document.querySelector('.stage-action-token')};
  },
  formation(count:number, dead=-1) {
    const party=document.getElementById('stage-enemy-party');
    if(dead<0){GameStateManager.getInstance().resetGame();GameStateManager.getInstance().replaceState(state);}
    const rows=Array.from({length:count},(_,i)=>({...enemies[1],id:'formation_'+i,name:i===0?'后排施术者':'前排守卫'+i,stageSlot:5-count+i}));
    ui.updateEnemyStageParty(rows.filter((_,i)=>i!==dead),'formation_0');
    return rows;
  },
  flavorPreview() {
    const host=document.createElement('div');host.id='flavor-test';host.style.cssText='position:relative;display:flex;flex-wrap:wrap;gap:12px;padding:12px;background:#152135';
    const card={id:'flavor',name:'誓约',type:'Skill',emoji:'🛡️',rarity:'Uncommon',description:'这是一个很长的卡牌描述。'.repeat(12)};
    const options={costLabel:'1',rarityLabel:'罕见',typeLabel:'技能',rules:'获得6点格挡'};
    host.innerHTML=['mwg-card-choice','collection-card','mwg-card-preview'].map(cls=>'<div class="'+cls+'" style="position:static;transform:none;width:250px;max-height:none">'+renderCardFace(card,options)+'</div>').join('');document.body.append(host);
  },
  layout(count:number){ui.updateEnemyStageParty(enemies.slice(0,count),'first');},
  appearance(enabled:boolean){
    DynamicStatusManager.getInstance().registry.replace([{id:'form',name:'恶魔化',emoji:'✨',character_emoji:'😈',type:'buff',maxStacks:1,stacks_change:'keep',triggers:{turn_start:{resource:{id:'corruption_energy',amount:2}},hold:{modify:'damage',multiply:1.5}}}]);
    const p=GameStateManager.getInstance().getGameState().player;
    p.resources={corruption_energy:{id:'corruption_energy',name:'堕落能量',emoji:'💜',current:5,max:10,refresh:'retain'}};
    p.statusEffects=enabled?[{id:'form',stacks:1}]:[];
    ui.updatePlayerDisplay(p);
    if(enabled)ui.showStatusDetail('form','player',p);
  },
  reserve(){GameStateManager.getInstance().setEnemies([...enemies,...Array.from({length:3},(_,i)=>({...enemies[1],id:'reserve'+i,name:'后备'+i,stageSlot:undefined}))]);ui.updateEnemyStageParty(GameStateManager.getInstance().getEnemies(),'first');},
  select(){const list=Array.from({length:4},(_,i)=>({id:'choice'+i,name:'完整长规则卡牌'+i,type:'Skill',cost:1,rarity:'Common',emoji:'🛡️',effectProgram:program(Array.from({length:i===0?1:10},()=>({op:'gain_block',target:'self',amount:6})))}));void TavernCardInteractionPresenter.getInstance().selectCards(list as any,{title:'选择两张卡',minimum:2,maximum:2,allowCancel:true}).then(x=>result.dataset.selection=JSON.stringify(x));},
  die(){const p=anim.animateEnemyDefeat('first');result.dataset.immediate=String(!!document.querySelector('.enemy-departing'));void p.then(()=>result.dataset.died='true');}
};

document.getElementById('sequence').onclick=async()=>{const trace:any[]=[];for(const [index,kind] of ['skill','attack','attack'].entries()){const start=performance.now();const pending=anim.playCombatAction(index===0?'player':'enemy',kind,index===0?'🛡️':'⚔️','序列'+index,index===0?'self':'opponent');await anim.waitForActionPresentation();trace.push({index,elapsed:Math.round(performance.now()-start),remaining:document.querySelectorAll('.stage-action-token').length});await pending;}result.textContent=JSON.stringify(trace);};
document.getElementById('hit').onclick=()=>{const first=enemies[0];first.currentHp=Math.max(0,first.currentHp-7);anim.updateHealthBarWithAnimation('enemy',first.currentHp,first.maxHp,'first',first.block);ui.updateEnemyStageParty(enemies,'first');const loss=document.querySelector('[data-enemy-id="first"] .stage-health-loss') as HTMLElement|null;result.dataset.lossAfterRefresh=String(!!loss&&Number(loss.style.opacity)>0);result.textContent='火焰受击后已走真实敌方舞台刷新，残影继续收缩';};
document.getElementById('break').onclick=()=>{const first=enemies[0];if(first.block<=0){first.block=5;ui.updateEnemyStageParty(enemies,'first');}first.block=0;anim.showShieldBreak('enemy','first');result.textContent='火焰护甲破碎';};
document.getElementById('summon-hit').onclick=()=>{const unit=units[0];unit.currentHp=Math.max(0,unit.currentHp-6);anim.updateSummonHealthBar('player',unit.instanceId,unit.currentHp,unit.maxHp,unit.block);ui.updateSummonDisplays({living:units.slice(0,1)});const loss=document.querySelector('[data-summon-id="unit_0"] .stage-health-loss') as HTMLElement|null;result.dataset.summonLossAfterRefresh=String(!!loss&&Number(loss.style.opacity)>0);result.textContent='机器人受击后已走真实召唤舞台刷新，残影继续收缩';};
document.getElementById('kill').onclick=async()=>{const stage=document.getElementById('battle-stage').getBoundingClientRect(),first=document.querySelector('[data-enemy-id="first"] .stage-emoji').getBoundingClientRect();result.dataset.anchor=String(first.left-stage.left+first.width/2);anim.lastActionStartedAt=Date.now();anim.showDamageNumber('enemy',12,'damage','first');enemies[0].currentHp=0;state.enemy=enemies[1];ui.updateEnemyStageParty(enemies,'second');const started=Date.now();result.textContent='死亡动画中';await anim.animateEnemyDefeat('first');result.dataset.duration=String(Date.now()-started);state.enemies=[enemies[1]];ui.updateEnemyStageParty(state.enemies,'second');result.textContent='动画后移除';};
new MutationObserver(()=>{const pop=document.querySelector('.physics-damage');if(pop)result.dataset.effectLeft=(pop as HTMLElement).style.left;}).observe(document.getElementById('battle-stage'),{childList:true});`);
fs.writeFileSync(dir+'/common.css',compile('src/common/index.scss',{silenceDeprecations:['import','global-builtin','color-functions']}).css);
const original=fs.readFileSync('src/fish/index.html','utf8');
const controls='<div id="fixture-controls">'+['three','four','sequence','hit','break','summon-hit','kill'].map(id=>'<button id="'+id+'">'+id+'</button>').join('')+'<p id="result"></p></div>';
fs.writeFileSync(dir+'/index.html',original.replace('</head>','<style>'+(compile('src/fish/index.scss',{silenceDeprecations:['import','global-builtin','color-functions']}).css+compile('src/fish/styles/cardPlayQueue.scss').css)+'</style></head>').replace('<body>','<body>'+controls).replace('</body>','<script src="app.js"></script></body>'));
fs.writeFileSync(dir+'/runtime-scroll-host.html',`<!doctype html><meta charset="utf-8"><title>Runtime scroll host</title><style>html,body{margin:0;height:100%;font:16px system-ui}#chat{height:720px;overflow:auto;overflow-anchor:auto;background:#182238}#lead,#tail{height:1800px;padding:24px;box-sizing:border-box;color:#dce7ff}#frame-wrap{padding:18px;background:#e9d7e3}iframe{display:block;width:100%;border:0;background:#fff}</style><main id="chat"><section id="lead">剧情开头</section><section id="frame-wrap"><iframe id="TH-message--scroll-fixture" src="index.html"></iframe></section><section id="tail">剧情结尾</section></main><script>window.__scrollEvidence=[];const chat=document.getElementById('chat');chat.addEventListener('scroll',()=>window.__scrollEvidence.push({at:performance.now(),top:chat.scrollTop,active:document.activeElement&&document.activeElement.tagName}));</script>`);
await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry:dir+'/entry.ts',output:{path:dir,filename:'app.js'},resolve:{extensions:['.ts','.js'],alias:{'@':path.resolve('src')}},plugins:[new webpack.ProvidePlugin({$:'jquery',jQuery:'jquery'})],module:{rules:[{test:/\.ts$/,use:dir+'/loader.cjs'}]}}).run((e,s)=>e||s.hasErrors()?reject(e||s.toString({all:false,errors:true})):resolve()));console.log(dir);
