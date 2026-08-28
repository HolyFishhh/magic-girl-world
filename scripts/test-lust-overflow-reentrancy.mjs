import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));

function createExecutorFixture(target) {
  const executor = Object.create(UnifiedEffectExecutor.prototype);
  const state = { playerLust: 100, enemyLust: 100 };
  const effect = { name: '递归压力测试', effectProgram: [{ type: 'gain_lust', target: 'opponent', amount: 5 }] };
  const events = [];
  executor.activeLustOverflows = new Set();
  executor.gameStateManager = {
    getEnemy: () => ({ lustEffect: effect }),
    getGameState: () => ({ battle: { player_lust_effect: effect } }),
    updatePlayer: patch => {
      state.playerLust = patch.currentLust;
      events.push(['reset', 'player', patch.currentLust]);
    },
    updateEnemy: patch => {
      state.enemyLust = patch.currentLust;
      events.push(['reset', 'enemy', patch.currentLust]);
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
    await executor.handleLustOverflow(target);
  };
  return { executor, state, events, executions: () => executions };
}

for (const target of ['player', 'enemy']) {
  const fixture = createExecutorFixture(target);
  await fixture.executor.handleLustOverflow(target);
  assert.equal(fixture.executions(), 1, `${target} lust overflow recursively executed its own effect`);
  assert.equal(fixture.state[target === 'player' ? 'playerLust' : 'enemyLust'], 0);
  assert.equal(fixture.executor.activeLustOverflows.size, 0, `${target} overflow lock leaked after success`);
  assert.equal(fixture.events.filter(event => event[0] === 'log').length, 1);
  assert.equal(fixture.events.filter(event => event[0] === 'show').length, 1);
}

const failure = createExecutorFixture('player');
failure.executor.executeEffectProgram = async () => {
  throw new Error('effect failed');
};
await assert.rejects(() => failure.executor.handleLustOverflow('player'), /effect failed/);
assert.equal(failure.state.playerLust, 0, 'failed lust effect must still reset lust');
assert.equal(failure.executor.activeLustOverflows.size, 0, 'failed lust effect must release its lock');

console.log('Production lust overflow executes once, resets in finally, and never leaks its reentrancy lock.');
