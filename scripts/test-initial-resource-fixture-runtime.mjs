// Actual, unchanged model mechanisms through the real card host; no live writes.
// This is a partial success AND known semantic-defect reproduction, not gameplay acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const core=require('../src/game-core/index.ts');
const {parseStructuredRecord}=require('../src/sillytavern-extension/structuredRecord.ts');
const {compileInitialDraftToMvu}=require('../src/game-core/initialDraft.ts');
const {normalizeMvuPlayerAuthoredContent}=require('../src/runtime/mvuBattleContentNormalizer.ts');
const {createBattleRequestFromMvu}=require('../src/fish/core/battleContractAdapter.ts');
const {GameStateManager}=require('../src/fish/core/gameStateManager.ts');
const {UnifiedEffectExecutor}=require('../src/fish/combat/unifiedEffectExecutor.ts');
const {CardSystem}=require('../src/fish/combat/cardSystem.ts');
const {BattleManager}=require('../src/fish/combat/battleManager.ts');
const {TavernEffectChoicePresenter}=require('../src/fish/ui/effectChoicePresenter.ts');
const {DynamicStatusManager}=require('../src/fish/combat/dynamicStatusManager.ts');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/initial-draft-resource-stance.json',import.meta.url),'utf8'));
const raw=parseStructuredRecord(fixture.response);
const original=structuredClone(raw);
const compiled=compileInitialDraftToMvu(normalizeMvuPlayerAuthoredContent({...raw,narrative:'隔离执行，不替代真实剧情。'}));
assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
const battle={...compiled.value.player,enemy:{id:'resource_dummy',name:'隔离目标',emoji:'◇',hp:200,max_hp:200,
  lust:0,max_lust:100,actions:[{id:'wait',name:'等待',effects:{block:1}}]}};
const store=GameStateManager.getInstance(),executor=UnifiedEffectExecutor.getInstance(),cards=CardSystem.getInstance(),manager=BattleManager.getInstance();
const quiet=new Proxy({},{get:()=>async()=>undefined});
executor.presentation=quiet;cards.presentation=quiet;manager.relicTriggerHost.presentation=quiet;manager.enemyIntentPresenter=quiet;
const chooser=TavernEffectChoicePresenter.getInstance(),oldChoose=chooser.choose;
let nextChoice='enter_gale';
chooser.choose=async choice=>{assert.ok(choice.options.some(option=>option.id===nextChoice));return nextChoice;};
function hand(id){
  const p=store.getPlayer();let card=p.hand.find(c=>c.originalId===id);
  if(!card) for(const pile of [p.drawPile,p.discardPile]) {const index=pile.findIndex(c=>c.originalId===id);if(index>=0){card=pile.splice(index,1)[0];p.hand.push(card);break;}}
  assert.ok(card,`owned card ${id} must exist; no card is synthesized`);return card;
}
async function play(id){const card=hand(id);assert.equal(cards.previewCardPlay(card.id).ok,true,id);assert.equal(await cards.playCard(card.id),true,id);}
async function hit(id,damage){const hp=store.getEnemy().currentHp,block=store.getEnemy().block;await play(id);
  assert.equal(store.getEnemy().currentHp,hp-Math.max(0,damage-block),id);}
try {
  // The UI normally loads this registry from MVU separately from card conversion.
  // Supply the same compiled definitions directly in this offline host.
  const registered=DynamicStatusManager.getInstance().registry.replace(battle.statuses);
  assert.deepEqual(registered.rejected,[]);
  store.convertMVUToGameState(createBattleRequestFromMvu({stat_data:{battle}},battle));
  assert.equal(store.getPlayer().resources.pressure.current,0);
  manager.prepareInitialPlayerTurn();
  assert.equal(store.getPlayer().resources.pressure.current,0,'retain does not refill at initial baseline');
  await executor.processInitialStance('player');
  await executor.processAbilitiesByTrigger('player','battle_start');
  await manager.relicTriggerHost.triggerRelics('battle_start');
  assert.equal(store.getPlayer().resources.pressure.current,1,'owned tuning fork supplies the actual first point');
  await manager.beginInitialPlayerTurn();
  assert.equal(store.getPlayer().resources.pressure.current,1,'first turn preserves, not refills');

  const vent=hand('pressure_vent'),beforeShortage=structuredClone(store.getGameState());
  assert.equal(cards.previewCardPlay(vent.id).ok,false);
  assert.equal(await cards.playCard(vent.id),false);
  assert.deepEqual(store.getGameState(),beforeShortage,'resource shortage cannot pay energy or execute/move the card');
  await hit('tap_pressure',5);assert.equal(store.getPlayer().resources.pressure.current,2);
  await hit('pressure_vent',12);assert.equal(store.getPlayer().resources.pressure.current,0);assert.equal(store.getPlayer().energy,1);
  await play('flow_toggle');assert.equal(store.getPlayer().stance.id,'gale');assert.equal(store.getPlayer().resources.pressure.current,1);

  await manager.endPlayerTurn();
  assert.equal(store.getGameState().phase,'player_turn');assert.equal(store.getGameState().currentTurn,2);
  assert.equal(store.getPlayer().resources.pressure.current,1,'a full enemy/player turn retains the accumulated point');
  await play('calibration_loop');
  assert.equal(store.getPlayer().statusEffects.length,0,'AI omitted to: the buff is NOT applied to the player');
  assert.equal(store.getEnemy().statusEffects.find(s=>s.id==='resonance')?.stacks,2,'reproduce authored wrong recipient');
  await hit('tap_pressure',6); // base5 + gale1; the advertised resonance2 belongs to the enemy
  assert.equal(store.getPlayer().resources.pressure.current,2);
  await hit('pressure_vent',13);assert.equal(store.getPlayer().resources.pressure.current,0);

  await manager.endPlayerTurn();
  assert.equal(store.getGameState().currentTurn,3);assert.equal(store.getPlayer().resources.pressure.current,0);
  nextChoice='enter_keep';await play('flow_toggle');
  assert.equal(store.getPlayer().stance.id,'keep_wind');assert.equal(store.getPlayer().block,7);
  await hit('tap_pressure',5); // replaces gale; player still does not own resonance
  await play('duct_guard');assert.equal(store.getPlayer().resources.pressure.current,2);assert.equal(store.getPlayer().block,14);
  const incoming=core.compileCompactEffectList({damage:20});assert.equal(incoming.ok,true);
  const hpBefore=store.getPlayer().currentHp;
  await executor.executeEffectProgram(incoming.value,false,{battleContext:{enemyId:'resource_dummy',intent:{id:'incoming',name:'隔离攻击'}}});
  assert.equal(store.getPlayer().currentHp,hpBefore-7,'enemy resonance adds2, keep subtracts1, then14 block');
  store.replaceState(JSON.parse(JSON.stringify(store.getGameState())));
  assert.equal(store.getPlayer().resources.pressure.current,2);assert.equal(store.getPlayer().stance.id,'keep_wind');
  assert.equal(store.getPlayer().statusEffects.length,0);
  assert.equal(store.getEnemy().statusEffects.find(s=>s.id==='resonance')?.stacks,2);
  assert.deepEqual(raw,original,'mechanism values, references, costs and descriptions remain authored');
  // Separate authoring counterexample, not a repair of the AI card or live save.
  const explicit=core.compileCompactEffectList({apply_status:'resonance',stacks:2,to:'self'});
  assert.equal(explicit.ok,true);await executor.executeEffectProgram(explicit.value,true);
  assert.equal(store.getPlayer().statusEffects.find(s=>s.id==='resonance')?.stacks,2);
} finally {chooser.choose=oldChoose;}
console.log('PASS execution audit: real resource/stance cycle and serialized state; reproduced AI missing-target defect (buff goes to enemy). Gameplay semantic acceptance: FALSE. Separate explicit-self example works; no AI card rewrite, model call, or live write.');
