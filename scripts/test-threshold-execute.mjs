import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));

const doom = core.normalizeRuntimeStatusDefinition({
  id: 'threshold_mark', name: '阈值印记', emoji: '⌛', type: 'debuff', description: '达到阈值时结算。',
  stacks_change: 'keep',
  triggers: { threshold_execute: { execute: 'stacks', threshold_mode: 'hp', to: 'self' } },
});
assert.ok(doom, 'a registered status may declare a generic threshold-execute phase');
assert.equal(doom.triggers.threshold_execute[0].steps[0].op, 'execute');
assert.equal(core.normalizeRuntimeStatusDefinition({
  id: 'invalid_threshold', name: '错误阈值', emoji: 'X', type: 'debuff', description: '错误。',
  triggers: { threshold_execute: { damage: 3, to: 'self' } },
}), null, 'threshold-execute programs reject ordinary damage and remain execution-only');

const makeEnemy = (id, hp, statuses) => ({
  id, name: id, emoji: 'E', maxHp: 10, currentHp: hp, maxLust: 100, currentLust: 0,
  energy: 0, maxEnergy: 0, block: 0, statusEffects: statuses, abilities: [], actions: [],
  intent: { type: 'special', description: '', emoji: '' }, nextAction: null, dialogue: '',
});
const makeExecutor = (enemies, programsByStatus) => {
  const store = new core.BattleStateStore(core.createEmptyBattleState());
  store.setEnemies(enemies, enemies[0].id);
  const executor = Object.create(UnifiedEffectExecutor.prototype);
  executor.gameStateManager = store;
  executor.dynamicStatusManager = {
    getStatusTriggerEffects: id => programsByStatus[id] || [],
  };
  const executed = [];
  executor.executeEffectProgram = async (_program, _sourceIsPlayer, context) => {
    const enemyId = context.battleContext.enemyId;
    executed.push([enemyId, context.statusContext.id, context.statusContext.stacks]);
    const enemy = store.getEnemyById(enemyId);
    if (enemy && enemy.currentHp <= context.statusContext.stacks) {
      store.updateEnemyById(enemyId, { currentHp: 0 });
      store.removeDefeatedEnemies();
      if (store.getEnemies({ livingOnly: true }).length === 0) store.setBattleOutcome('victory');
    }
  };
  return { store, executor, executed };
};
const thresholdProgram = doom.triggers.threshold_execute[0];

{
  const { store, executor, executed } = makeExecutor([
    makeEnemy('first', 2, [{ id: 'threshold_mark', name: '阈值印记', type: 'debuff', stacks: 2 }]),
    makeEnemy('second', 3, [{ id: 'threshold_mark', name: '阈值印记', type: 'debuff', stacks: 3 }]),
  ], { threshold_mark: [thresholdProgram] });
  await executor.processThresholdExecutes('enemy');
  assert.deepEqual(executed.map(entry => entry[0]), ['first', 'second']);
  assert.equal(store.isGameOver(), true, 'the side-wide snapshot resolves every eligible living entity');
}

{
  const { executor, executed } = makeExecutor([
    makeEnemy('last_enemy', 1, [
      { id: 'threshold_mark', name: '阈值印记', type: 'debuff', stacks: 1 },
      { id: 'second_threshold', name: '第二阈值', type: 'debuff', stacks: 9 },
    ]),
  ], { threshold_mark: [thresholdProgram], second_threshold: [thresholdProgram] });
  await executor.processThresholdExecutes('enemy');
  assert.deepEqual(
    executed.map(entry => entry[1]),
    ['threshold_mark'],
    'defeating the final enemy short-circuits later entries from the same phase snapshot',
  );
}

console.log('Threshold execute statuses snapshot the side, batch eligible entities, and stop after a terminal defeat.');
