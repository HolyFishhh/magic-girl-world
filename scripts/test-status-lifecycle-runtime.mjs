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

assert.equal(await runtime.apply('player', 'missing', 1), null);
const applied = await runtime.apply('player', 'bleed', 1);
assert.equal(applied.stacks, 1);
assert.equal(store.getPlayer().statusEffects[0].id, 'bleed');
assert.equal(executions[0][2].triggerType, 'apply');
assert.equal(executions[0][0].steps[0].target, 'self');
assert.equal(dispatches[0].trigger, 'gain_debuff');

await runtime.processActionTiming('player', 'before_action');
assert.equal(executions[1][2].triggerType, 'tick');
assert.equal(executions[1][0].steps[0].target, 'self');
await runtime.processTurnEnd('player');
assert.deepEqual(store.getPlayer().statusEffects, []);
assert.ok(events.some(event => event.type === 'status_removed' && event.reason === 'decay'));
assert.ok(dispatches.some(dispatch => dispatch.trigger === 'lose_debuff'));

await runtime.apply('player', 'attack_trace', 2);
const eventStatusIds = store.getPlayer().statusEffects.map(status => status.id);
await runtime.processEvent(
  'player',
  'attack_played',
  { cardId: 'cut', actorId: 'player', damageKind: 'attack' },
  eventStatusIds,
);
const eventExecution = executions.at(-1);
assert.equal(eventExecution[2].triggerType, 'attack_played');
assert.equal(eventExecution[2].statusContext.stacks, 2);
assert.equal(eventExecution[2].cardId, 'cut', 'battle-event context reaches the status effect formula runtime');
assert.equal(eventExecution[2].damageKind, 'attack', 'the concrete event damage kind survives the status lifecycle boundary');

await runtime.apply('player', 'attack_trace', 1);
await runtime.processEvent(
  'player',
  'attack_played',
  {},
  [],
);
assert.equal(
  executions.filter(([, , context]) => context.triggerType === 'attack_played').length,
  1,
  'a status acquired after an event snapshot cannot retroactively observe that event',
);

await runtime.apply('player', 'future_guard', 2);
await runtime.processTurnEnd('player');
assert.equal(store.getPlayer().statusEffects.find(s=>s.id==='future_guard').stacks,1,
  'the application turn already consumes one decay');
const futureExecutions=()=>executions.filter(([, ,context])=>context.statusContext.id==='future_guard');
await runtime.processEvent('player','turn_start',{},store.getPlayer().statusEffects.map(s=>s.id));
assert.equal(futureExecutions().length,1);
await runtime.processTurnEnd('player');
assert.ok(!store.getPlayer().statusEffects.some(s=>s.id==='future_guard'));
await runtime.processEvent('player','turn_start',{},store.getPlayer().statusEffects.map(s=>s.id));
assert.equal(futureExecutions().length,1,'two initial layers yield only one later turn-start, not two');
console.log('Modern status lifecycle apply, tick, decay, ownership dispatch and actual future-turn count passed.');
