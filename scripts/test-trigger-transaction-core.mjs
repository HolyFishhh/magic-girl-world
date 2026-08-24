import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { BattleSessionActionGate, TriggerTransactionRollbackError, runTriggerTransaction } = require(
  resolve('src/game-core/index.ts'),
);

function harness(initial = 0) {
  let state = initial;
  let sequence = 0;
  const snapshots = new Map();
  const events = [];
  return {
    events,
    read: () => state,
    set: value => {
      state = value;
    },
    ports: {
      beginTransaction(scope) {
        const token = `${scope}_${++sequence}`;
        snapshots.set(token, state);
        events.push(`begin:${scope}`);
        return token;
      },
      commitTransaction(token) {
        assert.equal(snapshots.delete(token), true);
        events.push('commit');
      },
      rollbackTransaction(token) {
        assert.ok(snapshots.has(token));
        state = snapshots.get(token);
        snapshots.delete(token);
        events.push('rollback');
      },
    },
  };
}

{
  const tx = harness(10);
  const result = await runTriggerTransaction('status_tick', tx.ports, () => {
    tx.set(12);
    return 'ok';
  });
  assert.deepEqual(result, { status: 'completed', value: 'ok' });
  assert.equal(tx.read(), 12);
  assert.deepEqual(tx.events, ['begin:status_tick', 'commit']);
}

{
  const tx = harness(10);
  const result = await runTriggerTransaction(
    'relic_turn_start',
    tx.ports,
    () => {
      tx.set(1);
      throw new Error('bad relic');
    },
    'recover-and-continue',
  );
  assert.equal(result.status, 'rolled_back');
  assert.equal(tx.read(), 10);
  assert.deepEqual(tx.events, ['begin:relic_turn_start', 'rollback']);
}

{
  const tx = harness(10);
  await assert.rejects(
    runTriggerTransaction('ability_on_hit', tx.ports, () => {
      tx.set(0);
      throw new Error('bad ability');
    }),
    /bad ability/,
  );
  assert.equal(tx.read(), 10);
}

{
  const tx = harness(10);
  const gate = new BattleSessionActionGate();
  assert.equal(gate.tryEnter('end_turn'), true);
  const result = await runTriggerTransaction('status_tick', tx.ports, () => {
    tx.set(11);
  });
  assert.equal(result.status, 'completed');
  assert.equal(tx.read(), 11);
  assert.equal(gate.active(), 'end_turn', 'nested triggers must not enter or release the player-action gate');
  gate.leave('end_turn');
}

{
  const tx = harness(10);
  const brokenPorts = {
    ...tx.ports,
    rollbackTransaction() {
      throw new Error('rollback unavailable');
    },
  };
  await assert.rejects(
    runTriggerTransaction('card_discard', brokenPorts, () => {
      throw new Error('effect failed');
    }),
    error => error instanceof TriggerTransactionRollbackError && error.scope === 'card_discard',
  );
}

console.log(
  'Nested trigger transactions commit, roll back, propagate, and report rollback failures without a UI action gate.',
);
