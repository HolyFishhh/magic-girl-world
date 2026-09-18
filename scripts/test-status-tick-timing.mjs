import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { normalizeMvuBattleContent } = require(resolve('src/runtime/mvuBattleContentNormalizer.ts'));
const { DynamicStatusManager } = require(resolve('src/fish/combat/dynamicStatusManager.ts'));
const { withAiContentDefinitions } = require(resolve('src/game-core/aiContentJsonSchema.ts'));

const beforeDefinition = {
  id: 'burn_before', name: '前燃', emoji: '🔥', type: 'debuff', stacks_change: -1,
  triggers: { tick: { damage: 'stacks' }, turn_start: { block: 1 } },
};
const afterDefinition = {
  id: 'burn_after', name: '后燃', emoji: '🕯️', type: 'debuff', tick_timing: 'after_action', stacks_change: -1,
  triggers: { tick: { damage: 'stacks' }, turn_end: { block: 1 } },
};
assert.equal(core.validateCompactStatusDefinition(beforeDefinition).ok, true);
assert.equal(core.validateCompactStatusDefinition(afterDefinition).ok, true);
assert.equal(core.validateCompactStatusDefinition({ ...beforeDefinition, tick_timing: 'turn_end' }).ok, false);
assert.equal(core.normalizeRuntimeStatusDefinition(beforeDefinition).tick_timing, 'before_action', 'omitted timing is persisted into the executable runtime default');
assert.equal(core.normalizeRuntimeStatusDefinition(afterDefinition).tick_timing, 'after_action');
const publicStatusSchema = withAiContentDefinitions({ $ref: '#/$defs/mwgStatusDefinition' });
assert.deepEqual(
  publicStatusSchema.$defs.mwgStatusDefinition.properties.tick_timing,
  { enum: ['before_action', 'after_action'] },
  'the public JSON schema exposes the same bounded tick_timing field as runtime validation',
);
assert.match(core.describeCompactStatus(beforeDefinition), /持有者行动前/);
assert.match(core.describeCompactStatus(afterDefinition), /回合结束后减少1层/);
assert.match(core.describeCompactStatus(afterDefinition), /持有者行动后/);
assert.match(core.statusTickTimingDisplayTag(afterDefinition).text, /行动后/);

const stored = normalizeMvuBattleContent({ statuses: [structuredClone(afterDefinition)] });
const restored = structuredClone(stored.statuses[0]);
assert.equal(restored.tick_timing, 'after_action', 'normalization/save projection retains the timing field');
assert.equal(core.normalizeRuntimeStatusDefinition(restored).tick_timing, 'after_action', 'restored content compiles with the same timing');
const legacySaved = normalizeMvuBattleContent({ statuses: [structuredClone(beforeDefinition)] });
DynamicStatusManager.getInstance().replaceDefinitions(structuredClone(legacySaved.statuses));
assert.equal(
  DynamicStatusManager.getInstance().getStatusDefinition('burn_before')?.tick_timing,
  'before_action',
  'an old saved definition without tick_timing restores into the executable before_action default',
);

const registry = new core.StatusDefinitionRegistry();
registry.replace([beforeDefinition, afterDefinition]);
const store = new core.BattleStateStore(core.createEmptyBattleState());
let token = 0;
const calls = [];
const lifecycle = new core.StatusLifecycleRuntime({
  state: store,
  definitions: registry,
  transactions: {
    beginTransaction: () => `tick-${++token}`,
    commitTransaction: () => {}, rollbackTransaction: () => {},
  },
  execute: async (_program, target, context) => calls.push(`${target}:${context.statusContext.id}:${context.triggerType}`),
  dispatch: async () => {},
});
await lifecycle.apply('player', 'burn_before', 2);
await lifecycle.apply('player', 'burn_after', 2);
calls.length = 0;
await lifecycle.processActionTiming('player', 'before_action');
assert.deepEqual(calls, ['player:burn_before:tick'], 'before tick does not execute after-timed tick or turn_start');
await lifecycle.processActionTiming('player', 'after_action');
assert.deepEqual(calls, ['player:burn_before:tick', 'player:burn_after:tick'], 'after tick resolves only at the after boundary');
await lifecycle.processTurnEnd('player');
assert.deepEqual(store.getPlayer().statusEffects.map(status => [status.id, status.stacks]), [['burn_before', 1], ['burn_after', 1]], 'both timing modes decay exactly once at turn end');
assert.equal(calls.some(call => call.includes('turn_start') || call.includes('turn_end')), false, 'action timing never fabricates event triggers');

// A lethal tick must stay bound to the queue entry's stable enemy id. Removing
// enemy_a makes the legacy active alias point at enemy_b; its remaining poison
// must not execute until enemy_b reaches its own action boundary.
const lethalDefinition = {
  id: 'lethal_tick', name: '致命毒', emoji: '☠️', type: 'debuff',
  triggers: { tick: { damage: 99 } },
};
const followupDefinition = {
  id: 'followup_tick', name: '余毒', emoji: '🧪', type: 'debuff',
  triggers: { tick: { damage: 1 } },
};
const enemyRegistry = new core.StatusDefinitionRegistry();
enemyRegistry.replace([lethalDefinition, followupDefinition]);
const enemyStore = new core.BattleStateStore(core.createEmptyBattleState());
enemyStore.setEnemies([
  { id: 'enemy_a', name: '甲', currentHp: 1, maxHp: 1, statusEffects: [{ id: 'lethal_tick', name: '致命毒', type: 'debuff', stacks: 1 }, { id: 'followup_tick', name: '余毒', type: 'debuff', stacks: 1 }] },
  { id: 'enemy_b', name: '乙', currentHp: 10, maxHp: 10, statusEffects: [{ id: 'followup_tick', name: '余毒', type: 'debuff', stacks: 1 }] },
], 'enemy_a');
const enemyCalls = [];
const enemyLifecycle = new core.StatusLifecycleRuntime({
  state: enemyStore,
  definitions: enemyRegistry,
  transactions: { beginTransaction: () => 'enemy-tick', commitTransaction: () => {}, rollbackTransaction: () => {} },
  execute: async (_program, target, context) => {
    enemyCalls.push(`${target}:${context.enemyId}:${context.statusContext.id}`);
    if (context.enemyId === 'enemy_a' && context.statusContext.id === 'lethal_tick') {
      enemyStore.updateEnemyById('enemy_a', { currentHp: 0 });
      enemyStore.removeDefeatedEnemies(['enemy_a']);
    }
  },
  dispatch: async () => {},
});
await enemyLifecycle.processActionTiming('enemy', 'before_action', 'enemy_a');
assert.deepEqual(enemyCalls, ['enemy:enemy_a:lethal_tick'], 'enemy_a death cannot transfer a remaining tick to enemy_b');
assert.equal(enemyStore.getEnemy()?.id, 'enemy_b', 'test simulates the production active-alias handoff after death');
await enemyLifecycle.processActionTiming('enemy', 'before_action', 'enemy_b');
assert.deepEqual(enemyCalls, ['enemy:enemy_a:lethal_tick', 'enemy:enemy_b:followup_tick'], 'enemy_b ticks only at its own later action boundary');

const managerSource = await readFile(resolve('src/fish/combat/battleManager.ts'), 'utf8');
const queueEntry = managerSource.slice(managerSource.indexOf('private async executeEnemyQueueEntry'), managerSource.indexOf('// 敌人行动执行'));
assert.match(queueEntry, /setActiveEnemy\(entry\.enemyId\)[\s\S]*processStatusEffectsAtActionTiming\('enemy', 'before_action', entry\.enemyId\)[\s\S]*getEnemyById\(entry\.enemyId\)[\s\S]*executeEnemyAction\(entry\)[\s\S]*processStatusEffectsAtActionTiming\('enemy', 'after_action', entry\.enemyId\)/, 'each enemy identity is rebound and ticked around its own action');
assert.match(managerSource, /processStatusEffectsAtActionTiming\('player', 'before_action'\)/);
assert.match(managerSource, /processStatusEffectsAtActionTiming\('player', 'after_action'\)/);
const summonSource = await readFile(resolve('src/fish/combat/unifiedEffectExecutor.ts'), 'utf8');
assert.match(summonSource, /processSummonStatusEffectsAtActionTiming\(unit\.instanceId, 'before_action'\)/);
assert.match(summonSource, /processSummonStatusEffectsAtActionTiming\(current\.instanceId, 'after_action'\)/);
console.log('Status tick timing validates, compiles, survives projection/restore, executes at holder action boundaries, and decays once per turn.');
