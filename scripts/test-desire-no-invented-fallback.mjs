import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {GameStateManager}=require('../src/fish/core/gameStateManager.ts');
const {createBattleRequestFromMvu}=require('../src/fish/core/battleContractAdapter.ts');
const {applyDesireEffectGrowth}=require('../src/runtime/desireEffectGrowth.ts');
const battle={
 core:{emoji:'🧙',hp:80,max_hp:80,lust:0,max_lust:100},
 cards:[{id:'strike',name:'测试攻击',type:'Attack',rarity:'Common',cost:1,quantity:5,effects:{damage:8}}],
 statuses:[],artifacts:[],items:[],player_abilities:[],player_status_effects:[],
 enemy:{id:'target',name:'测试敌人',emoji:'🗿',hp:80,max_hp:80,lust:0,max_lust:100,actions:[{name:'攻击',effects:{damage:6}}]},
};
const manager=GameStateManager.getInstance();
for(const authored of [false,true,false]){
 const value=structuredClone(battle);
 if(authored)value.player_lust_effect={name:'原创兑现',effects:[{damage:50,to:'opponent'}]};
 manager.convertMVUToGameState(createBattleRequestFromMvu({stat_data:{battle:value}},value));
 const state=manager.getGameState();
 assert.equal(!!state.battle.player_lust_effect,authored);
 assert.equal(state.enemy.lustEffect,undefined);
 if(authored)assert.equal(state.battle.player_lust_effect.name,'原创兑现');
}
const owner={...battle,player_lust_effect:{name:'原效果',effects:{damage:20}}};
const growth={effect:{name:'增强',effects:[{damage:50,to:'opponent'}]}};
assert.equal(applyDesireEffectGrowth(owner,growth).player_lust_effect.effects[0].damage,50);
assert.equal(owner.player_lust_effect.effects.damage,20,'validation must not mutate source');
assert.deepEqual(applyDesireEffectGrowth(battle,growth).player_lust_effect,growth.effect);
assert.equal(battle.player_lust_effect,undefined,'AI may create a payoff, but preflight never mutates the player');
for (const damage of [1, 999999]) assert.equal(applyDesireEffectGrowth(owner,{effect:{name:'自由成长',effects:{damage}}}).player_lust_effect.effects.damage,damage);
assert.throws(()=>applyDesireEffectGrowth(owner,{effect:{name:'空',effects:[]}}));
assert.throws(()=>applyDesireEffectGrowth(owner,{effect:{name:'坏引用',effects:[{apply_status:'missing'}]}}));
const {validateTowerBattleNodeForActivation}=require('../src/runtime/towerContentActivation.ts');
const noReward={card:[],artifact:[],item:[],limits:{cards:0,artifacts:0,items:0}};
assert.doesNotThrow(()=>validateTowerBattleNodeForActivation(battle,{enemy:battle.enemy},noReward,undefined,growth));
assert.throws(()=>validateTowerBattleNodeForActivation(owner,{enemy:battle.enemy},noReward,undefined,
 {effect:{name:'坏引用',effects:[{apply_status:'missing'}]}}),/欲望成长不可执行/);
assert.doesNotThrow(()=>validateTowerBattleNodeForActivation(owner,{enemy:battle.enemy},noReward,undefined,growth));
assert.equal(owner.player_lust_effect.effects.damage,20,'preflight must not grant growth');
const status={id:'growth_focus',name:'专注',type:'buff',triggers:{hold:{modify:'damage',add:'stacks'}}};
const sharedOwner={...owner,statuses:[status]};
const repeatedStatus=Object.fromEntries(Object.entries(status).reverse());
assert.doesNotThrow(()=>applyDesireEffectGrowth(sharedOwner,{...growth,statuses:[repeatedStatus]}),
 'reordered JSON keys are the same shared definition');
assert.throws(()=>applyDesireEffectGrowth(sharedOwner,{...growth,statuses:[{...status,triggers:{hold:{modify:'damage',add:99}}}]}),
 /不能覆盖共享状态/,'a real shared mechanic change must still fail');
assert.throws(()=>validateTowerBattleNodeForActivation(owner,{enemy:battle.enemy},
 {...noReward,card:[{...battle.cards[0],effects:{unsupported_operation:1}}]},undefined,
 {effect:{name:'坏引用',effects:[{apply_status:'missing'}]}}),error=>{
 assert.match(error.message,/tower reward cards is invalid/);
 assert.match(error.message,/payload.desire_growth/);
 return true;
},'one repair sees both ordinary reward and growth failures');
const tower=require('../src/game-core/towerRequest.ts');
const scope={nodeId:'test_node',requestId:'test_request',basedOnRevision:1,kind:'battle',act:1,floor:1};
const result={spec:tower.TOWER_NODE_RESULT_SPEC,node_id:scope.nodeId,request_id:scope.requestId,
 based_on_revision:1,kind:'battle',title:'测试战斗',narrative:'测试场景',
 payload:{battle:{enemy:battle.enemy},desire_growth:growth},
 reward:{card:[0,1,2].map(i=>({...battle.cards[0],id:`reward_${i}`,quantity:1})),artifact:[],
 item:[{id:'tonic',name:'药剂',count:1,effects:{heal:5}}],limits:{cards:1,artifacts:0,items:1}},
};
assert.deepEqual(tower.parseTowerNodeResult(JSON.stringify(result),scope).payload.desire_growth,growth);
const invalid=structuredClone(result);invalid.payload.desire_growth.effect.effects=[];
assert.throws(()=>tower.parseTowerNodeResult(JSON.stringify(invalid),scope),/desire_growth/);
const messageVariables=require('../src/runtime/messageVariables.ts');
const originalRead=messageVariables.getCurrentMessageVariables;
try {
 const damaged=structuredClone(battle);delete damaged.enemy.max_hp;
 messageVariables.getCurrentMessageVariables=()=>({stat_data:{battle:damaged}});
 manager.resetGame();manager.lastLoadError=null;
 assert.equal(manager.getEnemy(),null,'old save recovery must not invent a max HP');
 assert.match(manager.getLastLoadError(),/恢复战斗内容校验失败/);
} finally {messageVariables.getCurrentMessageVariables=originalRead;}
console.log('Actual runtime load neither invents nor retains missing desire payoffs; growth validates on a detached state.');
