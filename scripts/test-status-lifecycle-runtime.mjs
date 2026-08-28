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

assert.equal(await runtime.apply('player', 'missing', 1), null);
const applied = await runtime.apply('player', 'bleed', 1);
assert.equal(applied.stacks, 1);
assert.equal(store.getPlayer().statusEffects[0].id, 'bleed');
assert.equal(executions[0][2].triggerType, 'apply');
assert.equal(executions[0][0].steps[0].target, 'self');
assert.equal(dispatches[0].trigger, 'gain_debuff');

await runtime.processTurnEnd('player');
assert.equal(executions[1][2].triggerType, 'tick');
assert.equal(executions[1][0].steps[0].target, 'self');
assert.deepEqual(store.getPlayer().statusEffects, []);
assert.ok(events.some(event => event.type === 'status_removed' && event.reason === 'decay'));
assert.ok(dispatches.some(dispatch => dispatch.trigger === 'lose_debuff'));

console.log('Modern status lifecycle apply, tick, decay, and ownership dispatch passed.');
