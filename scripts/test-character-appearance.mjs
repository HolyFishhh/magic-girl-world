import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const store = new core.BattleStateStore(core.createEmptyBattleState());
const registry = new core.StatusDefinitionRegistry();
registry.replace([
  { id: 'future_guard', name: '未来护壁', emoji: '🛡️', type: 'buff', stacks_change: -1,
    triggers: { turn_start: { block: 5 } } },
  {
    id: 'bleed',
    name: '流血',
    emoji: '🩸',
    type: 'debuff',
    stacks_change: -1,
    maxStacks: 3,
    triggers: {
      apply: { damage: 1 },
      tick: { damage: 'stacks' },
    },
  },
  {
    id: 'attack_trace',
    name: '攻击轨迹',
    emoji: '↗️',
    type: 'buff',
    stacks_change: 'keep',
    triggers: { attack_played: { energy: 'stacks' } },
  },
]);

const executions = [];
const dispatches = [];
const events = [];
let token = 0;
const runtime = new core.StatusLifecycleRuntime({
  state: store,
  definitions: {
    get: id => registry.get(id),
    getTriggerEffects: (id, trigger) => registry.getTriggerEffects(id, trigger),
  },
  transactions: {
    beginTransaction: scope => {
      const name = `${scope}:${++token}`;
      store.createSnapshot(name);
      return name;
    },
    commitTransaction: name => store.deleteSnapshot(name),
    rollbackTransaction: name => {
      store.restoreSnapshot(name);
      store.deleteSnapshot(name);
    },
  },
  execute: async (program, target, context) => executions.push([program, target, context]),
  dispatch: async values => dispatches.push(...values),
  present: event => events.push(event),
});


const {resolveCharacterEmoji}=require('../src/game-core/characterAppearance.ts');
const {statusAppearanceDisplayTags}=require('../src/game-core/effectDisplay.ts');
const {describeCompactStatus}=require('../src/game-core/contentDescription.ts');
const {validateCompactStatusDefinition}=require('../src/game-core/statusDefinitionValidation.ts');
const form={id:'form',name:'恶魔形态',emoji:'✨',type:'buff',character_emoji:'😈',stacks_change:-1,maxStacks:2,triggers:{hold:{modify:'damage',multiply:1.5}}};
registry.replace([form,{...form,id:'second',character_emoji:'🐉'}]);
assert.equal(validateCompactStatusDefinition(form).ok,true);
assert.equal(validateCompactStatusDefinition({...form,character_emoji:''}).ok,false);
assert.equal(validateCompactStatusDefinition({...form,character_emoji:'a'.repeat(33)}).ok,false);
const lookup=id=>registry.get(id), portrait=()=>resolveCharacterEmoji(store.getPlayer(),lookup);
const baseEmoji=portrait();
await runtime.apply('player','form',2);assert.equal(portrait(),'😈');
await runtime.apply('player','second',1);assert.equal(portrait(),'🐉');
await runtime.apply('player','form',1);assert.equal(portrait(),'🐉','restacking does not reorder acquisition');
const saved=JSON.parse(JSON.stringify({player:store.getPlayer(),definition:form}));
assert.equal(resolveCharacterEmoji(saved.player,lookup),'🐉');
assert.equal(registry.get('form').character_emoji,'😈');
await runtime.processTurnEnd('player');assert.equal(portrait(),'😈');
await runtime.processTurnEnd('player');assert.equal(portrait(),baseEmoji);
assert.ok(describeCompactStatus(form).includes('😈'));
assert.ok(statusAppearanceDisplayTags(form)[0].text.includes('移除后恢复'));
assert.equal(resolveCharacterEmoji({emoji:'🧙',statusEffects:[{id:'form',stacks:0}]},lookup),'🧙');
assert.equal(resolveCharacterEmoji({emoji:'👹',statusEffects:[{id:'form',stacks:1}]},lookup),'😈','enemy/summon held statuses use same resolver');
console.log('PASS appearance validation/compiler/held lifecycle/priority/decay/save round trip/both description chains');
