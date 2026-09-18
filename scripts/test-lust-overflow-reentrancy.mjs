import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));

function createExecutorFixture(target, enemyIds = ['enemy-a']) {
  const executor = Object.create(UnifiedEffectExecutor.prototype);
  const state = {
    playerLust: 100,
    enemies: new Map(enemyIds.map(id => [id, { id, currentLust: 100, lustEffect: null }])),
    activeEnemyId: enemyIds[0],
  };
  const effect = { name: '递归压力测试', effectProgram: [{ type: 'gain_lust', target: 'opponent', amount: 5 }] };
  for (const enemy of state.enemies.values()) enemy.lustEffect = effect;
  const events = [];
  executor.activeLustOverflows = new Set();
  executor.executionContext = { sourceIsPlayer: target === 'enemy' };
  executor.currentResolvedEnemyId = null;
  executor.gameStateManager = {
    getEnemy: () => state.enemies.get(state.activeEnemyId) || null,
    getEnemyById: id => state.enemies.get(id) || null,
    getGameState: () => ({ activeEnemyId: state.activeEnemyId, battle: { player_lust_effect: effect } }),
    updatePlayer: patch => {
      state.playerLust = patch.currentLust;
      events.push(['reset', 'player', patch.currentLust]);
    },
    updateEnemyById: (id, patch) => {
      const enemy = state.enemies.get(id);
      if (enemy) enemy.currentLust = patch.currentLust;
      events.push(['reset', id, patch.currentLust]);
    },
  };
  executor.presentation = {
    logLustOverflow: owner => events.push(['log', owner]),
    showLustOverflow: owner => events.push(['show', owner]),
  };
  let executions = 0;
  executor.executeEffectProgram = async () => {
    executions += 1;
    events.push(['execute', target]);
    await executor.handleLustOverflow(target, target === 'enemy'
      ? { targetEnemyId: state.activeEnemyId }
      : { sourceEnemyId: state.activeEnemyId });
  };
  return { executor, state, events, executions: () => executions };
}

for (const target of ['player', 'enemy']) {
  const fixture = createExecutorFixture(target);
  await fixture.executor.handleLustOverflow(target, target === 'enemy'
    ? { targetEnemyId: 'enemy-a' }
    : { sourceEnemyId: 'enemy-a' });
  assert.equal(fixture.executions(), 1, `${target} lust overflow recursively executed its own effect`);
  assert.equal(target === 'player'
    ? fixture.state.playerLust
    : fixture.state.enemies.get('enemy-a').currentLust, 0);
  assert.equal(fixture.executor.activeLustOverflows.size, 0, `${target} overflow lock leaked after success`);
  assert.equal(fixture.events.filter(event => event[0] === 'log').length, 1);
  assert.equal(fixture.events.filter(event => event[0] === 'show').length, 1);
}

const failure = createExecutorFixture('player');
failure.executor.executeEffectProgram = async () => {
  throw new Error('effect failed');
};
await assert.rejects(() => failure.executor.handleLustOverflow('player', { sourceEnemyId: 'enemy-a' }), /effect failed/);
assert.equal(failure.state.playerLust, 0, 'failed lust effect must still reset lust');
assert.equal(failure.executor.activeLustOverflows.size, 0, 'failed lust effect must release its lock');

// One enemy overflowing during another enemy's payoff is a distinct event,
// while recursively re-entering that same concrete enemy remains suppressed.
{
  const fixture = createExecutorFixture('enemy', ['enemy-a', 'enemy-b']);
  const executions = [];
  fixture.executor.executeEffectProgram = async (_program, _sourceIsPlayer, context) => {
    const id = context.boundEnemyTargetId;
    executions.push(id);
    await fixture.executor.handleLustOverflow('enemy', { targetEnemyId: id });
    if (id === 'enemy-a') {
      await fixture.executor.handleLustOverflow('enemy', { targetEnemyId: 'enemy-b' });
    }
  };
  await fixture.executor.handleLustOverflow('enemy', { targetEnemyId: 'enemy-a' });
  assert.deepEqual(executions, ['enemy-a', 'enemy-b']);
  assert.equal(fixture.state.enemies.get('enemy-a').currentLust, 0);
  assert.equal(fixture.state.enemies.get('enemy-b').currentLust, 0);
  assert.equal(fixture.executor.activeLustOverflows.size, 0);
}

console.log('Production lust overflow is target-bound, permits distinct enemy overflows, suppresses self recursion, and releases every lock.');

// Distinct programs expose accidental owner inversion; an unrelated active enemy
// must not steal the triggering enemy's program or the overflowing target.
for (const target of ['player', 'enemy']) {
  const fixture = createExecutorFixture(target, ['enemy-a', 'enemy-b']);
  const playerProgram = [{ type: 'damage', target: 'opponent', amount: 50 }];
  const enemyProgram = [{ type: 'damage', target: 'opponent', amount: 30 }];
  fixture.state.enemies.get('enemy-b').lustEffect = { name: '敌方兑现', effectProgram: enemyProgram };
  fixture.executor.gameStateManager.getGameState = () => ({
    activeEnemyId: 'enemy-a', battle: { player_lust_effect: { name: '我方兑现', effectProgram: playerProgram } },
  });
  const calls = [];
  fixture.executor.executeEffectProgram = async (program, sourceIsPlayer, context) => {
    calls.push({ program, sourceIsPlayer, context });
  };
  await fixture.executor.handleLustOverflow(target, target === 'player'
    ? { sourceEnemyId: 'enemy-b' } : { targetEnemyId: 'enemy-b' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].program, target === 'enemy' ? playerProgram : enemyProgram);
  assert.equal(calls[0].sourceIsPlayer, target === 'enemy');
  assert.equal(target === 'enemy' ? calls[0].context.boundEnemyTargetId : calls[0].context.battleContext.enemyId, 'enemy-b');
  assert.equal(fixture.state.enemies.get('enemy-a').currentLust, 100);
}
console.log('Overflow selects the attacking side program and preserves source/target identity for both sides.');
