import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require('../src/game-core/index.ts');
const { executeStatusAction } = require('../src/game-core/statusAction.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
const { TavernEffectCommandHost } = require('../src/fish/core/effectCommandHost.ts');
const { TavernEffectChoicePresenter } = require('../src/fish/ui/effectChoicePresenter.ts');
const { withAiContentDefinitions } = require('../src/game-core/aiContentJsonSchema.ts');
const { presentCompactContent } = require('../src/game-core/contentPresentation.ts');
const { effectProgramToDisplayTags } = require('../src/game-core/effectDisplay.ts');
globalThis.getVariables = () => { throw Error('must not read player saves'); };
globalThis.replaceVariables = globalThis.getVariables;
const definition = { id:'dark_ritual', name:'黑暗仪式', emoji:'🕯', type:'buff', tags:['ritual'], maxStacks:3,
  stacks_change:'keep', triggers:{hold:{modify:'damage',add:'stacks',to:'self'}} };
const registry = new core.StatusDefinitionRegistry();
registry.replace([definition, {...definition,id:'moon',name:'月之誓',tags:['moon']},
  {id:'ward',name:'隔绝',emoji:'🛡',type:'buff',defense:{negate_debuff:true}},
  {id:'poisoned',name:'侵蚀',emoji:'☠',type:'debuff',stacks_change:-1,triggers:{tick:{damage:1}}}]);
assert.deepEqual(registry.get('dark_ritual').tags,['ritual']);
const store = new core.BattleStateStore(core.createEmptyBattleState());
store.setEnemy({id:'foe',name:'敌',currentHp:50,maxHp:50,currentLust:0,maxLust:100,energy:0,maxEnergy:0,block:0,
  statusEffects:[],actions:[],intent:{type:'attack',value:1},nextAction:null,emoji:'👹',dialogue:''});
const events=[];
const runtime = new core.StatusLifecycleRuntime({ state:store,
  definitions:{get:id=>registry.get(id),getTriggerEffects:(id,event)=>registry.getTriggerEffects(id,event)},
  transactions:{beginTransaction:()=>{store.createSnapshot('nested');return 'nested'},commitTransaction:id=>store.deleteSnapshot(id),rollbackTransaction:id=>store.restoreSnapshot(id)},
  execute:async()=>{},dispatch:async()=>{},present:event=>events.push(event),
});
const executor=Object.create(UnifiedEffectExecutor.prototype);
executor.gameStateManager=store;
executor.dynamicStatusManager={getStatusDefinition:id=>registry.get(id)};
executor.activeSummonHolder=()=>null;executor.hasSummonSelfBinding=()=>false;
executor.triggerHost={applyStatus:(...args)=>runtime.apply(...args),removeStatusStacks:(...args)=>runtime.removeStacks(...args)};
const state={self:{hp:50,maxHp:50,lust:0,maxLust:100,energy:3,maxEnergy:3,block:0},opponent:{hp:50,maxHp:50,lust:0,maxLust:100,energy:0,maxEnergy:0,block:0},currentTurn:1,cardsPlayedThisTurn:0};
const host=new TavernEffectCommandHost({readState:()=>state,isTerminal:()=>false,presentCommand:()=>{},
  executeStatusAction:(spec,sourceIsPlayer)=>executor.executeStatusAction(spec,sourceIsPlayer)});
const ajv=new Ajv2020({strict:false});
const compact=ajv.compile(JSON.parse(readFileSync('schemas/mwg-card-effects-v1.schema.json','utf8')));
const ast=new Ajv2020({strict:false}).compile(JSON.parse(readFileSync('schemas/mwg-effect-v1.schema.json','utf8')));
const publicCard=new Ajv2020({strict:false}).compile(withAiContentDefinitions({$ref:'#/$defs/mwgCard'}));
const effect={status_action:{mode:'transfer',from:'opponent',to:'self',pick:'first',filter:{type:'buff',tags:['ritual']},count:1}};
const card={id:'steal',name:'夺取仪式',type:'Skill',rarity:'Rare',cost:1,quantity:1,effects:effect};
assert.equal(publicCard(card),true,JSON.stringify(publicCard.errors));
const compiled=core.compileCompactEffectList(effect);
assert.equal(compiled.ok,true,JSON.stringify(compiled));
assert.equal(ast(compiled.value),true,JSON.stringify(ast.errors));
assert.match(presentCompactContent(card,'card').rulesText,/转移给自身/);
assert.match(effectProgramToDisplayTags(compiled.value).map(t=>t.text).join(' '),/标签 ritual/);
assert.equal(core.validateContentPackContract(core.createContentPack({cards:[card],statuses:[definition]})).ok,true);
const bad={status_action:{...effect.status_action,to:'opponent'}};
assert.equal(core.compileCompactEffectList(bad).ok,false);
assert.equal(publicCard({...card,effects:bad}),false);
await runtime.apply('player','dark_ritual',2);
await runtime.apply('enemy','dark_ritual',3);
store.updateStatusEffect('player','dark_ritual',{duration:1});store.updateStatusEffect('enemy','dark_ritual',{duration:4});
await host.executeProgram(JSON.parse(JSON.stringify(compiled.value)),true);
assert.equal(store.getPlayer().statusEffects[0].stacks,3);
assert.equal(store.getPlayer().statusEffects[0].duration,4);
assert.equal(store.getEnemy().statusEffects[0].stacks,2,'only accepted layer transferred');
assert.equal(store.getPlayer().statusEffects[0].name,'黑暗仪式','never replace narrative status with strength');
await runtime.apply('player','ward',1);await runtime.apply('enemy','poisoned',2);
await host.executeProgram(core.compileCompactEffectList({status_action:{mode:'transfer',from:'opponent',to:'self',filter:{type:'debuff'},pick:'first'}}).value,true);
assert.equal(store.getEnemy().statusEffects.find(s=>s.id==='poisoned').stacks,2);
assert.ok(!store.getPlayer().statusEffects.some(s=>s.id==='poisoned'));
assert.ok(!store.getPlayer().statusEffects.some(s=>s.id==='ward'),'artifact consumes itself without deleting source');
await host.executeProgram(core.compileCompactEffectList({status_action:{mode:'copy',from:'opponent',to:'self',pick:'first',filter:{type:'debuff'},stacks:1}}).value,true);
assert.equal(store.getPlayer().statusEffects.find(s=>s.id==='poisoned').stacks,1);
assert.equal(store.getEnemy().statusEffects.find(s=>s.id==='poisoned').stacks,2);
const saved=JSON.parse(JSON.stringify(store.getGameState()));
const restored=new core.BattleStateStore(saved);
assert.deepEqual(restored.getPlayer().statusEffects,JSON.parse(JSON.stringify(store.getPlayer().statusEffects)));
await runtime.apply('player','moon',1);
const before=structuredClone(store.getPlayer().statusEffects);
const priorPresenter=TavernEffectChoicePresenter.getInstance;
try {
  TavernEffectChoicePresenter.getInstance=()=>({choose:async()=>null});
  await assert.rejects(()=>host.executeProgram(core.compileCompactEffectList({status_action:{mode:'remove',from:'self',filter:{type:'buff'}}}).value,true),/取消/);
  assert.deepEqual(store.getPlayer().statusEffects,before);
  TavernEffectChoicePresenter.getInstance=()=>({choose:async()=> 'moon'});
  await host.executeProgram(core.compileCompactEffectList({status_action:{mode:'remove',from:'self',filter:{type:'buff'}}}).value,true);
  assert.ok(!store.getPlayer().statusEffects.some(s=>s.id==='moon'));
assert.ok(store.getPlayer().statusEffects.some(s=>s.id==='dark_ritual'));
  const savedPlay={phase:'player_turn',hasOpponent:true,hand:[{id:'payment-test',type:'Skill',cost:1}],energy:3,cardsPlayedThisTurn:0};
  let playState=structuredClone(savedPlay);
  TavernEffectChoicePresenter.getInstance=()=>({choose:async()=>null});
  await runtime.apply('player','moon',1);
  await assert.rejects(()=>core.playBattleSessionCard('payment-test',{
    gate:new core.BattleSessionActionGate(),readCardPlayState:()=>playState,isTerminal:()=>false,
    beginTransaction:()=>{store.createSnapshot('card');return structuredClone(playState)},
    commitTransaction:()=>assert.fail('cancel must not commit'),
    rollbackTransaction:prior=>{playState=prior;store.restoreSnapshot('card');store.deleteSnapshot('card')},
    beginCardTransit:()=>{},endCardTransit:()=>{},applyCardPlayCommit:committed=>{playState={...playState,...committed}},
    executeCardEffect:()=>host.executeProgram(core.compileCompactEffectList({status_action:{mode:'remove',from:'self',filter:{type:'buff'}}}).value,true),
    movePlayedCard:()=>{},triggerPostCardPlay:()=>{},
  }),/取消/);
  assert.deepEqual(playState,savedPlay,'status choice cancellation restores resource payment and hand');
} finally {TavernEffectChoicePresenter.getInstance=priorPresenter;}
const summon=store.spawnSummons('player',{id:'familiar',name:'使魔',emoji:'🐈',maxHp:10,attack:1},1).spawned[0];
const summonRuntime=new core.SummonStatusLifecycleRuntime({state:store,
  definitions:{get:id=>registry.get(id),getTriggerEffects:(id,event)=>registry.getTriggerEffects(id,event)},
  transactions:{beginTransaction:()=>{store.createSnapshot('summon');return 'summon'},commitTransaction:id=>store.deleteSnapshot(id),rollbackTransaction:id=>store.restoreSnapshot(id)},execute:async()=>{},
});
executor.activeSummonHolder=target=>target==='player'?store.getSummonById(summon.instanceId):null;
executor.hasSummonSelfBinding=target=>target==='player';
executor.triggerHost.applyStatusToSummons=(...args)=>summonRuntime.apply(...args);
executor.triggerHost.removeSummonStatusStacks=(...args)=>summonRuntime.removeStacks(...args);
await host.executeProgram(core.compileCompactEffectList({status_action:{mode:'transfer',from:'opponent',to:'self',pick:'first',filter:{ids:['dark_ritual']}}}).value,true);
assert.equal(store.getSummonById(summon.instanceId).statusEffects.find(s=>s.id==='dark_ritual').stacks,2);
assert.ok(!store.getEnemy().statusEffects.some(s=>s.id==='dark_ritual'));
assert.equal(store.getPlayer().statusEffects.find(s=>s.id==='dark_ritual').stacks,3,'summon self never aliases its owner');
// A rejected stale or malformed response cannot debit any source.
const selected=[{id:'a',name:'甲',type:'buff',stacks:2},{id:'b',name:'乙',type:'buff',stacks:1}];
await assert.rejects(()=>executeStatusAction({mode:'remove',from:'self'}, {read:()=>selected,tags:()=>[],random:()=>0,choose:async()=>['not_present'],remove:async()=>assert.fail(),apply:async()=>assert.fail()},true),/无效/);
console.log('PASS status action: public/AST schemas, compilation, host/lifecycle transfer, cap/defense, narrative identity, duration, partial cleanse, cancellation and save parity');
require('tsconfig-paths/register');
const {extractTowerInitialRepairSlotTargets:plan,parseTowerInitialSlotRepairResponse:parse,mergeTowerInitialSlotRepair:merge}=require('../src/sillytavern-extension/controller.ts');
const repairSource={player:{statuses:[{id:'siphon',name:'夺取',emoji:'✨',type:'buff',tags:['ritual'],description:'夺取仪式',triggers:{turn_start:[{block:'wrong'},effect]}}]}};
const targets=plan(repairSource,'battle.statuses[0]：状态定义不合法（具体原因：triggers.turn_start[0].block: 不支持的公式变量 wrong）');
assert.equal(targets.length,1);
const slots=Object.fromEntries(targets[0].slots.map(s=>[s.token,{action:s.action,value:s.kind==='description'?'夺取仪式':effect}]));
const reply={spec:'mwg.tower-initial-slot-repair/v1',roots:{[targets[0].token]:{slots}},support_statuses:[],support_resources:[]};
const repaired=merge(repairSource,targets,parse(reply,targets));
assert.deepEqual(repaired.player.statuses[0].tags,['ritual']);
assert.deepEqual(repaired.player.statuses[0].triggers.turn_start,[effect,effect]);
assert.deepEqual(repairSource.player.statuses[0].triggers.turn_start[0],{block:'wrong'});
console.log('PASS bounded status repair accepts new operation and preserves filters, tags and locked siblings');
