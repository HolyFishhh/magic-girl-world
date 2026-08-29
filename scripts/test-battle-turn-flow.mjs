import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ts from 'typescript';

const path = resolve('src/game-core/battleTurnFlow.ts');
const source = await readFile(path, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const flow = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

assert.deepEqual(flow.BATTLE_TURN_FLOW_STEPS, [
  'player_cards_end',
  'player_relics_end',
  'player_abilities_end',
  'player_summons_action',
  'player_orbs_end',
  'player_statuses_end',
  'player_threshold_execute',
  'scheduled_turn_end',
  'advance_turn',
  'enemy_block_reset',
  'enemy_resources_reset',
  'enemy_summons_reset',
  'enemy_abilities_start',
  'enemy_action',
  'enemy_summons_action',
  'enemy_next_intent',
  'enemy_abilities_end',
  'enemy_orbs_end',
  'enemy_statuses_end',
  'enemy_threshold_execute',
  'temporary_modifiers_clear',
  'player_begin',
  'player_summons_reset',
  'scheduled_turn_start',
  'player_block_reset',
  'player_energy_reset',
  'scheduled_before_draw',
  'player_draw',
  'scheduled_after_draw',
  'player_abilities_start',
  'player_relics_start',
]);
assert.equal(new Set(flow.BATTLE_TURN_FLOW_STEPS).size, flow.BATTLE_TURN_FLOW_STEPS.length);

const executed = [];
const completed = await flow.runBattleTurnFlow({
  isTerminal: () => false,
  execute: step => executed.push(step),
});
assert.deepEqual(executed, flow.BATTLE_TURN_FLOW_STEPS);
assert.deepEqual(completed, { completed: true, executedSteps: flow.BATTLE_TURN_FLOW_STEPS });

let terminal = false;
const stopped = await flow.runBattleTurnFlow({
  isTerminal: () => terminal,
  execute: step => {
    if (step === 'enemy_action') terminal = true;
  },
});
assert.equal(stopped.completed, false);
assert.equal(stopped.stoppedAfter, 'enemy_action');
assert.deepEqual(
  stopped.executedSteps,
  flow.BATTLE_TURN_FLOW_STEPS.slice(0, flow.BATTLE_TURN_FLOW_STEPS.indexOf('enemy_action') + 1),
);

let touched = false;
assert.deepEqual(
  await flow.runBattleTurnFlow({
    isTerminal: () => true,
    execute: () => {
      touched = true;
    },
  }),
  { completed: false, executedSteps: [] },
);
assert.equal(touched, false);

{
  const extraTurns = { player: 1, enemy: 0 };
  const steps = [];
  let enemyBegins = 0;
  const result = await flow.runBattleTurnFlow({
    isTerminal: () => false,
    beginEnemyTurn: () => { enemyBegins += 1; },
    consumeExtraTurn: actor => {
      if (extraTurns[actor] <= 0) return false;
      extraTurns[actor] -= 1;
      return true;
    },
    execute: step => steps.push(step),
  });
  assert.equal(result.completed, true);
  assert.equal(enemyBegins, 0);
  assert.deepEqual(steps, [
    ...flow.BATTLE_TURN_FLOW_STEPS.slice(0, flow.BATTLE_TURN_FLOW_STEPS.indexOf('enemy_block_reset')),
    ...flow.BATTLE_TURN_FLOW_STEPS.slice(flow.BATTLE_TURN_FLOW_STEPS.indexOf('temporary_modifiers_clear')),
  ]);
}

{
  const extraTurns = { player: 0, enemy: 2 };
  const steps = [];
  let enemyBegins = 0;
  await flow.runBattleTurnFlow({
    isTerminal: () => false,
    beginEnemyTurn: () => { enemyBegins += 1; },
    consumeExtraTurn: actor => {
      if (extraTurns[actor] <= 0) return false;
      extraTurns[actor] -= 1;
      return true;
    },
    execute: step => steps.push(step),
  });
  assert.equal(enemyBegins, 1);
  const enemyStart = flow.BATTLE_TURN_FLOW_STEPS.indexOf('enemy_block_reset');
  const playerStart = flow.BATTLE_TURN_FLOW_STEPS.indexOf('temporary_modifiers_clear');
  const enemySteps = flow.BATTLE_TURN_FLOW_STEPS.slice(enemyStart, playerStart);
  assert.deepEqual(steps, [
    ...flow.BATTLE_TURN_FLOW_STEPS.slice(0, enemyStart),
    ...enemySteps,
    ...enemySteps,
    ...enemySteps,
    ...flow.BATTLE_TURN_FLOW_STEPS.slice(playerStart),
  ]);
}

assert.deepEqual(flow.BATTLE_START_FLOW_STEPS, [
  'player_stance_battle_start',
  'enemy_stance_battle_start',
  'player_abilities_battle_start',
  'enemy_abilities_battle_start',
  'player_abilities_gain_initial',
  'enemy_abilities_gain_initial',
  'player_relics_ability_gain_initial',
  'player_relics_battle_start',
]);
const startExecuted = [];
assert.equal(
  (
    await flow.runBattleStartFlow({
      isTerminal: () => false,
      execute: step => startExecuted.push(step),
    })
  ).completed,
  true,
);
assert.deepEqual(startExecuted, flow.BATTLE_START_FLOW_STEPS);

assert.equal(
  flow.resolveEnemyTurnAction({
    hasEnemy: false,
    stunned: false,
    currentTurn: 2,
    hasPreparedAction: true,
    actionCount: 1,
  }),
  'none',
);
assert.equal(
  flow.resolveEnemyTurnAction({
    hasEnemy: true,
    stunned: true,
    currentTurn: 2,
    hasPreparedAction: true,
    actionCount: 1,
  }),
  'stunned',
);
assert.equal(
  flow.resolveEnemyTurnAction({
    hasEnemy: true,
    stunned: false,
    currentTurn: 2,
    hasPreparedAction: true,
    actionCount: 1,
  }),
  'execute_prepared',
);
assert.equal(
  flow.resolveEnemyTurnAction({
    hasEnemy: true,
    stunned: false,
    currentTurn: 1,
    hasPreparedAction: true,
    actionCount: 1,
  }),
  'select_and_execute',
);
assert.equal(
  flow.resolveEnemyTurnAction({
    hasEnemy: true,
    stunned: false,
    currentTurn: 2,
    hasPreparedAction: false,
    actionCount: 0,
  }),
  'execute_default',
);

assert.deepEqual(flow.DEFAULT_ENEMY_ATTACK_DAMAGE, { min: 5, max: 12 });
assert.equal(flow.rollDefaultEnemyAttackDamage(() => 0), 5);
assert.equal(flow.rollDefaultEnemyAttackDamage(() => 0.5), 9);
assert.equal(flow.rollDefaultEnemyAttackDamage(() => 0.999999), 12);
for (const invalid of [-0.01, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(() => flow.rollDefaultEnemyAttackDamage(() => invalid), /\[0, 1\)/);
}

console.log('Portable battle-start and complete turn flows own ordering, branching, and terminal short-circuiting.');
