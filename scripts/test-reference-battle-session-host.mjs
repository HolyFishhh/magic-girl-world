import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { ReferenceBattleSessionHost } = require(resolve('src/adapters/index.ts'));

const host = new ReferenceBattleSessionHost({ hp: 10, items: [{ id: 'potion', count: 1 }] });
const detached = host.read();
detached.hp = 1;
assert.equal(host.read().hp, 10, 'adapter reads must not expose live state references');

const used = await core.runBattleSessionAtomicAction(
  'use_item',
  { ...host.transactionPorts(), canRun: () => true, isTerminal: () => false },
  () => {
    host.update(state => {
      state.hp += 2;
      state.items[0].count -= 1;
    });
    return 'potion';
  },
);
assert.deepEqual(used, { status: 'completed', value: 'potion' });
assert.deepEqual(host.read(), { hp: 12, items: [{ id: 'potion', count: 0 }] });

await assert.rejects(
  core.runBattleSessionAtomicAction(
    'use_item',
    { ...host.transactionPorts(), canRun: () => true, isTerminal: () => false },
    () => {
      host.update(state => {
        state.hp = 0;
      });
      throw new Error('host effect failed');
    },
  ),
  /host effect failed/,
);
assert.equal(host.read().hp, 12, 'failed external-host actions must restore the complete snapshot');

const nestedHost = new ReferenceBattleSessionHost({ hp: 10, triggerCount: 0 });
const nested = await core.runBattleSessionAtomicAction(
  'use_item',
  { ...nestedHost.transactionPorts(), canRun: () => true, isTerminal: () => false },
  async () => {
    nestedHost.update(state => {
      state.hp = 11;
    });
    const trigger = await core.runTriggerTransaction(
      'relic_turn_start',
      nestedHost.triggerTransactionPorts(),
      () => {
        nestedHost.update(state => {
          state.hp = 0;
          state.triggerCount += 1;
        });
        throw new Error('nested trigger failed');
      },
      'recover-and-continue',
    );
    assert.equal(trigger.status, 'rolled_back');
    assert.deepEqual(nestedHost.read(), { hp: 11, triggerCount: 0 });
    nestedHost.update(state => {
      state.hp = 12;
    });
  },
);
assert.equal(nested.status, 'completed');
assert.deepEqual(nestedHost.read(), { hp: 12, triggerCount: 0 });

const token = host.beginTransaction('play_card');
assert.throws(() => host.commitTransaction('missing'), /unknown battle transaction/);
host.rollbackTransaction(token);

console.log(
  'Reference external-host adapter provides detached state, shared gating, and atomic rollback without Tavern APIs.',
);
