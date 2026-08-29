import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const program = { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] };
const ability = { id: 'steady', trigger: 'turn_end', effectProgram: program };
assert.deepEqual(core.resolveAbilityTriggerPlan(ability, 'turn_end'), {
  source: ability,
  trigger: 'turn_end',
  program,
});
assert.equal(core.resolveAbilityTriggerPlan(ability, 'on_turn_end'), null);
assert.equal(core.resolveAbilityTriggerPlan(ability, 'passive'), null);

const abilityRuns = [];
const abilityRuntime = new core.AbilityTriggerRuntime({
  readAbilities: () => [ability],
  execute: async (target, plan, context) => abilityRuns.push([target, plan.source.id, plan.trigger, context]),
});
await abilityRuntime.run('player', 'turn_end', { turn: 2 });
assert.deepEqual(abilityRuns, [['player', 'steady', 'turn_end', { turn: 2 }]]);

const defeatedByEnemy = {
  left: [{ id: 'split_left', trigger: 'defeated', effectProgram: program }],
  right: [
    { id: 'armor_right', trigger: 'take_damage', effectProgram: program },
    { id: 'split_right', trigger: 'defeated', effectProgram: program },
  ],
};
const enemyRuns = [];
const enemyRuntime = new core.AbilityTriggerRuntime({
  readAbilities: (_target, context) => defeatedByEnemy[context.enemyId] || [],
  execute: async (_target, plan, context) => enemyRuns.push(`${context.enemyId}:${plan.source.id}`),
});
await enemyRuntime.run('enemy', 'defeated', { enemyId: 'left' });
await enemyRuntime.run('enemy', 'defeated', { enemyId: 'right' });
assert.deepEqual(enemyRuns, ['left:split_left', 'right:split_right']);
assert.ok(core.ABILITY_TRIGGER_SET.has('defeated'));

const relic = { id: 'guard_stone', name: 'Guard Stone', trigger: 'take_damage', effectProgram: program };
assert.deepEqual(core.resolveRelicTriggerPlan(relic, 'take_damage'), {
  source: relic,
  trigger: 'take_damage',
  program,
});
assert.equal(core.resolveRelicTriggerPlan(relic, 'on_take_damage'), null);

const relicRuns = [];
const relicRuntime = new core.RelicTriggerRuntime({
  readRelics: () => [relic],
  execute: async (plan, context) => relicRuns.push([plan.source.id, plan.trigger, context]),
});
await relicRuntime.run('take_damage', { damage: 4 });
assert.deepEqual(relicRuns, [['guard_stone', 'take_damage', { damage: 4 }]]);

console.log('Typed ability and relic trigger plans passed.');
