import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core');
const {convertMvuEnemies}=require('../src/fish/core/mvuBattleAdapter.ts');
const {GameStateManager}=require('../src/fish/core/gameStateManager.ts');
const {UnifiedEffectExecutor}=require('../src/fish/combat/unifiedEffectExecutor.ts');
const {EnemyIntentPresenter}=require('../src/fish/ui/enemyIntentPresenter.ts');
const {DynamicStatusManager}=require('../src/fish/combat/dynamicStatusManager.ts');
const compile=(effects,options)=>{const r=core.compileCompactEffectList(effects,options);assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
const passive=(id,effects)=>({id,name:id,trigger:'passive',effectProgram:compile(effects)});
const manager=GameStateManager.getInstance(),executor=UnifiedEffectExecutor.getInstance(),presenter=EnemyIntentPresenter.getInstance();
executor.presentation=new Proxy({},{get:()=>()=>undefined});
executor.completeBattleEnd=async()=>{};
const strength=core.normalizeRuntimeStatusDefinition({id:'strength',name:'强力',emoji:'🔥',type:'buff',stacks_change:'keep',triggers:{hold:{modify:'damage',add:'stacks'}}});
assert.ok(strength);
DynamicStatusManager.getInstance().getStatusDefinition=id=>id==='strength'?strength:undefined;
function setup(effects,boosted=false) {
 const state=core.createEmptyBattleState();state.player.currentHp=state.player.maxHp=500;
 state.player.block=0;state.phase='enemy_turn';manager.replaceState(state);
 const enemies=convertMvuEnemies(['front','back'].map(id=>({id,name:id,emoji:'🤖',hp:500,max_hp:500,lust:0,max_lust:100,
 actions:[{id:'strike',name:'剑刃风暴',weight:1,effects}],abilities:[],status_effects:[],action_mode:'random',action_config:{},lust_effect:{name:'失控',effects:{damage:1}}})),()=>0);
 manager.setEnemies(enemies,'front');
 if(boosted){
  manager.updateEnemyById('front',{abilities:[passive('front_power',{modify:'damage',add:80})]});
  manager.updateEnemyById('back',{abilities:[passive('back_power',{modify:'damage',multiply:2})],statusEffects:[{id:'strength',name:'强力',type:'buff',stacks:4}],modifiers:{damage_modifier:1}});
  manager.updatePlayer({abilities:[passive('vulnerable',{modify:'damage_taken',multiply:1.5})],modifiers:{damage_taken_modifier:2}});
 }
 for(const enemy of manager.getEnemies())manager.updateEnemyById(enemy.id,{nextAction:enemy.actions[0]});
 return manager.getEnemyById('back');
}
async function check(effects,boosted,expected) {
 let enemy=setup(effects,boosted);const before=JSON.stringify(manager.getGameState());
 const model=presenter.createDisplayModel(enemy);assert.equal(model.badges.find(b=>b.icon==='⚔️')?.value,expected,JSON.stringify(model));
 assert.equal(JSON.stringify(manager.getGameState()),before,'preview never mutates state, journal, active enemy or statuses');
 manager.replaceState(JSON.parse(before));enemy=manager.getEnemyById('back');
 assert.deepEqual(presenter.createDisplayModel(enemy),model,'save roundtrip preserves preview semantics');
 const amount=Number(expected.split('×')[0]),count=Number(expected.split('×')[1]||1);
 await executor.executeEffectProgram(enemy.nextAction.effectProgram,false,{battleContext:{enemyId:enemy.id,intent:enemy.nextAction}});
 const hits=manager.getGameState().eventJournal.events.filter(e=>e.kind==='damage_resolved');
 assert.equal(hits.length,count);assert.ok(hits.every(e=>e.modified===amount),JSON.stringify(hits));
 assert.equal(manager.getPlayer().currentHp,500-amount*count);
}
await check({damage:2,hits:3},false,'2×3');
await check({damage:2,hits:3},true,'15.5×3');
await check({damage:'self.hp / 250',hits:3},true,'15.5×3');
await check({damage:2,hits:3,when:'self.hp > 100'},true,'15.5×3');
const noAttack=setup({trigger:{on:'turn_start',effects:{damage:7}}});
assert.equal(presenter.createDisplayModel(noAttack).badges.some(b=>b.icon==='⚔️'),false,'future trigger is not an immediate hit');
for(const formula of ['x_value * 4']) {
 const authored={type:'Attack',cost:'X',effects:{damage:formula}};
 const rules=core.describeCompactCard(authored);
 const program=compile(authored.effects);
 const tags=core.effectProgramToDisplayTags(program).map(t=>t.text).join(' ');
 assert.doesNotMatch(rules+' '+tags,/x_value|context\./);
 assert.match(rules,/X值（本次消耗量）/);assert.match(tags,/X值（本次消耗量）/);
}
console.log('PASS intent: compiled 2×3, status/passive/direct modifiers in execution order, formula/condition, non-active enemy identity, immutable preview, save roundtrip, actual damage journal and both Chinese formula display chains.');

// A support enemy grants executable strength to a concrete ally, then to the
// whole enemy party. A selected target must not redirect the support effect.
setup({damage:2,hits:3});
await executor.executeEffectProgram(compile({apply_status:'strength',stacks:4,to:'self',targets:{mode:'by_id',id:'back'}},{enemyCollectionTarget:'self'}),false,{battleContext:{enemyId:'front'}});
assert.equal(manager.getEnemyById('back').statusEffects.find(s=>s.id==='strength')?.stacks,4);
assert.equal(manager.getEnemyById('front').statusEffects.length,0);
assert.equal(manager.getPlayer().statusEffects.length,0);
await executor.executeEffectProgram(compile({apply_status:'strength',stacks:2,to:'self',targets:{mode:'all'}},{enemyCollectionTarget:'self'}),false,{battleContext:{enemyId:'back'}});
assert.equal(manager.getEnemyById('front').statusEffects.find(s=>s.id==='strength')?.stacks,2);
assert.equal(manager.getEnemyById('back').statusEffects.find(s=>s.id==='strength')?.stacks,6);
assert.equal(manager.getPlayer().statusEffects.length,0);
manager.replaceState(JSON.parse(JSON.stringify(manager.getGameState())));
const supported=manager.getEnemyById('back');
assert.equal(presenter.createDisplayModel(supported).badges.find(b=>b.icon==='⚔️').value,'8×3');
const startHp=manager.getPlayer().currentHp;
await executor.executeEffectProgram(supported.nextAction.effectProgram,false,{battleContext:{enemyId:'back',intent:supported.nextAction}});
assert.equal(manager.getPlayer().currentHp,startHp-24);
assert.equal(manager.getGameState().activeEnemyId,'front');
console.log('PASS individual ally and whole-party buffs, player isolation, save restoration, buff-adjusted 8×3 preview and execution.');


