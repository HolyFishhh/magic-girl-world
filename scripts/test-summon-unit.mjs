import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const program = { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 3 }] };
const guardian = {
  id: 'guardian',
  name: '守卫单位',
  emoji: '🛡️',
  maxHp: 8,
  block: 2,
  actionProgram: program,
  actionsPerActivation: 2,
  actionPriority: 1,
  speed: 3,
  intercept: { mode: 'unblocked_attack', priority: 2, maxPerTurn: 1 },
};
const striker = {
  id: 'striker',
  name: '攻击单位',
  emoji: '⚔️',
  maxHp: 5,
  actionProgram: program,
  actionsPerActivation: 1,
  actionPriority: 2,
  speed: 1,
};

const multiActionSummon = {
  id: 'multi_actor',
  name: '多行动单位',
  emoji: '🌀',
  maxHp: 6,
  actions: [
    { id: 'first_move', name: '第一行动', emoji: '1️⃣', weight: 1, effectProgram: program },
    { id: 'second_move', name: '第二行动', emoji: '2️⃣', weight: 3, fixed: true, effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] } },
  ],
  abilities: [{
    id: 'turn_guard', name: '回合守护', trigger: 'turn_start',
    effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] },
  }],
  resources: { charge: { id: 'charge', name: 'Charge', emoji: 'C', current: 1, max: 5, refresh: 'retain' } },
  actionsPerActivation: 1,
};

let state = core.createSummonCollectionState();
let spawned = core.spawnSummonUnits(state, 'player', guardian, 1, 2, 'reject', 1);
state = spawned.state;
assert.equal(spawned.spawned[0].instanceId, 'guardian__summon__1');
spawned = core.spawnSummonUnits(state, 'player', striker, 2, 2, 'replace_oldest', 1);
state = spawned.state;
assert.equal(state.living.length, 2);
assert.equal(spawned.replaced.length, 1);
assert.equal(state.defeated[0].templateId, 'guardian');

const selected = core.resolveSummonTargets(state, { owner: 'self', pick: 'random_n', count: 2 }, 'player', () => 0);
assert.deepEqual(selected.map(unit => unit.instanceId), state.living.map(unit => unit.instanceId));
assert.equal(core.resolveSummonTargets(state, { owner: 'opponent', pick: 'all' }, 'player').length, 0);
assert.equal(core.resolveSummonTargets(state, { owner: 'self', pick: 'left' }, 'player')[0].createdSequence, state.living[0].createdSequence);
assert.equal(core.resolveSummonTargets(state, { owner: 'self', pick: 'right' }, 'player')[0].createdSequence, state.living.at(-1).createdSequence);
assert.deepEqual(core.resolveSummonTargets(state, { owner: 'self', pick: 'choose' }, 'player'), [], 'portable core never guesses a manual summon target');

const queue = core.buildSummonActionQueue(state, 'player');
assert.deepEqual(queue.map(entry => entry.summonId), state.living.map(unit => unit.instanceId));

state = core.spawnSummonUnits(core.createSummonCollectionState(), 'player', guardian, 1, 3, 'reject', 1).state;
let interception = core.interceptUnblockedAttack(state, 'player', 11);
assert.equal(interception.interceptedDamage, 10, 'summon block and HP absorb unblocked attack damage');
assert.equal(interception.remainingDamage, 1);
assert.equal(interception.hits[0].defeated, true);
assert.equal(interception.state.living.length, 0);
assert.equal(interception.state.defeated.length, 1);

state = core.spawnSummonUnits(core.createSummonCollectionState(), 'player', guardian, 1, 3, 'reject', 1).state;
let damaged = core.damageSummonUnits(state, [state.living[0].instanceId], 5);
assert.equal(damaged.hits[0].blocked, 2);
assert.equal(damaged.hits[0].hpLost, 3);
let healed = core.healSummonUnits(damaged.state, [damaged.state.living[0].instanceId], 2);
assert.equal(healed.changed[0].nextHp, 7);
state = core.modifySummonUnits(healed.state, [healed.state.living[0].instanceId], 'actions_per_activation', '+', 1);
assert.equal(state.living[0].actionsPerActivation, 3);
state = core.applySummonStatus(state, [state.living[0].instanceId], {
  id: 'focus', name: '专注', emoji: '🎯', description: '状态', type: 'buff',
}, 2);
assert.equal(state.living[0].statusEffects[0].stacks, 2);
state = core.removeSummonStatus(state, [state.living[0].instanceId], 'focus');
assert.equal(state.living[0].statusEffects.length, 0);

assert.throws(
  () => core.modifySummonUnits(state, [state.living[0].instanceId], 'block', '/', 0),
  /divide by zero/,
);
assert.deepEqual(core.validateSummonDefinition({ ...guardian, id: 'bad-id', maxHp: 0 }).sort(), ['id', 'maxHp']);
assert.deepEqual(core.validateSummonDefinition(multiActionSummon), []);
const multiState = core.spawnSummonUnits(core.createSummonCollectionState(), 'player', multiActionSummon, 1).state;
assert.equal(core.buildSummonActionQueue(multiState, 'player').length, 1, 'multi-action summons enter the normal action queue');
assert.equal(core.resolveSummonAction(multiState.living[0], () => 0).id, 'first_move');
assert.equal(core.resolveSummonAction(multiState.living[0], () => 0.99).id, 'second_move');
let transformedMulti = core.modifySummonEffectPrograms(
  multiState, [multiState.living[0].instanceId], 'block', 'add', 2,
);
assert.equal(transformedMulti.living[0].actions[1].effectProgram.steps[0].amount, 2, 'fixed summon actions ignore effect amplification');
assert.equal(transformedMulti.living[0].abilities[0].effectProgram.steps[0].amount, 3, 'ordinary summon abilities receive effect amplification');
transformedMulti = core.applySummonStatus(transformedMulti, [transformedMulti.living[0].instanceId], {
  id: 'copy_focus', name: 'Copy Focus', emoji: 'F', description: 'copy state', type: 'buff',
}, 2);
transformedMulti = core.updateSummonResources(
  transformedMulti, [transformedMulti.living[0].instanceId], 'charge', 2, 'gain',
).state;
const copiedMulti = core.copySummonUnits(
  transformedMulti, [transformedMulti.living[0].instanceId], 'player', 3, 'replace_oldest', 2,
);
assert.equal(copiedMulti.copied.length, 1);
assert.notEqual(copiedMulti.copied[0].instanceId, transformedMulti.living[0].instanceId);
assert.equal(copiedMulti.copied[0].statusEffects[0].stacks, 2, 'copies retain current summon statuses');
assert.equal(copiedMulti.copied[0].resources.charge.current, 3, 'copies retain current summon resources');
assert.equal(copiedMulti.copied[0].abilities[0].effectProgram.steps[0].amount, 3, 'copies retain transformed summon programs');
const capped = core.spawnSummonUnits(core.createSummonCollectionState(), 'player', striker, 12).state;
assert.equal(capped.living.length, 3, 'the default owner-local summon capacity is three');
assert.equal(capped.defeated.length, 9, 'summons beyond current capacity replace living units instead of being rejected');
assert.deepEqual(
  capped.defeated.map(unit => unit.createdSequence),
  [1, 2, 3, 4, 5, 6, 7, 8, 9],
  'overflow replacement removes the oldest living summon first',
);
assert.deepEqual(
  capped.living.map(unit => unit.createdSequence),
  [10, 11, 12],
  'new summons still enter after the oldest units are defeated',
);

const hpLess = {
  id: 'orb_like', name: 'Orb-like summon', emoji: 'O', hasHp: false,
  actions: [{ id: 'pulse', name: 'Pulse', fixed: true, effectProgram: program }],
};
state = core.spawnSummonUnits(core.createSummonCollectionState(), 'player', hpLess, 1).state;
const hpLessId = state.living[0].instanceId;
assert.equal(core.isSummonAlive(state.living[0]), true);
assert.equal(core.damageSummonUnits(state, [hpLessId], 999).hits.length, 0, 'HP-less summons cannot take damage');
assert.equal(core.healSummonUnits(state, [hpLessId], 999).changed.length, 0, 'HP-less summons cannot be healed');
assert.equal(core.interceptUnblockedAttack(state, 'player', 7).interceptedDamage, 0, 'HP-less summons never intercept attacks');

const companion = {
  ...guardian,
  id: 'companion',
  slot: 'pet',
  onExisting: 'reinforce',
  onDefeated: 'revive_reset',
  retainCorpse: true,
  capabilities: { selectable: false, acceptsStatus: false, acts: true, intercepts: true },
};
state = core.spawnSummonUnits(core.createSummonCollectionState(), 'player', companion, 1, 3, 'reject', 1).state;
const companionId = state.living[0].instanceId;
state = core.spawnSummonUnits(state, 'player', companion, 1, 3, 'reject', 1).state;
assert.equal(state.living.length, 1, 'a configured companion slot reinforces instead of adding another unit');
assert.equal(state.living[0].maxHp, 16);
assert.equal(core.resolveSummonTargets(state, { owner: 'self', pick: 'all' }, 'player').length, 0);
assert.equal(core.resolveSummonTargets(state, { owner: 'self', pick: 'all', slot: 'pet', includeUntargetable: true }, 'player').length, 1);
state = core.damageSummonUnits(state, [companionId], 99).state;
assert.equal(state.defeated.length, 1);
state = core.spawnSummonUnits(state, 'player', companion, 1, 3, 'reject', 2).state;
assert.equal(state.living[0].instanceId, companionId, 'revive_reset preserves the configured corpse identity');
assert.equal(state.living[0].maxHp, 8);
state = core.applySummonStatus(state, [companionId], {
  id: 'blocked_status', name: 'Blocked', emoji: 'X', description: '', type: 'debuff',
}, 1);
assert.equal(state.living[0].statusEffects.length, 0, 'capability policy rejects ordinary status application');

console.log('Summon units cover identity, dynamic capacity, life modes, weighted actions, fixed effects, copy, selection, interception, damage, healing, statuses, and modifiers.');

const effect = amount => ({ spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount }] });
const definitions = new Map([
  ['focus', {
    id: 'focus', name: 'Focus', emoji: 'F', description: 'focus', type: 'buff', stun: false,
    maxStacks: 3, stacks_change: -1,
    triggers: { apply: [effect(1)], stack: [effect(1)], tick: [effect(2)], remove: [effect(3)] },
  }],
  ['unstable', {
    id: 'unstable', name: 'Unstable', emoji: 'U', description: 'unstable', type: 'debuff', stun: false,
    stacks_change: 'keep', triggers: { tick: [effect(9)] },
  }],
]);

let lifecycleState = core.spawnSummonUnits(core.createSummonCollectionState(), 'player', guardian, 2, 4, 'reject', 1).state;
const [firstHolder, secondHolder] = lifecycleState.living;
const snapshots = new Map();
let transactionSequence = 0;
const lifecycleEvents = [];
const executedContexts = [];
let failUnstableTick = false;
const lifecycle = new core.SummonStatusLifecycleRuntime({
  state: {
    readSummons: () => structuredClone(lifecycleState),
    writeSummons: next => { lifecycleState = structuredClone(next); },
    getSummonById: id => {
      const found = [...lifecycleState.living, ...lifecycleState.defeated].find(unit => unit.instanceId === id);
      return found ? structuredClone(found) : null;
    },
  },
  definitions: {
    get: id => definitions.get(id),
    getTriggerEffects: (id, trigger) => definitions.get(id)?.triggers[trigger] || [],
  },
  transactions: {
    beginTransaction: scope => {
      const token = `${scope}_${++transactionSequence}`;
      snapshots.set(token, structuredClone(lifecycleState));
      return token;
    },
    commitTransaction: token => { snapshots.delete(token); },
    rollbackTransaction: token => {
      lifecycleState = snapshots.get(token);
      snapshots.delete(token);
    },
  },
  execute: async (program, owner, context) => {
    executedContexts.push(structuredClone(context));
    const amount = program.steps[0].amount;
    lifecycleState = core.modifySummonUnits(
      lifecycleState,
      [context.summonStatusContext.summonId],
      'block',
      '+',
      amount,
    );
    assert.equal(owner, 'player');
    assert.equal(context.summonContext.instanceId, context.summonStatusContext.summonId);
    if (context.statusContext.id === 'unstable' && context.triggerType === 'tick' && failUnstableTick)
      throw new Error('expected unstable tick failure');
  },
  present: event => lifecycleEvents.push(event),
});

await lifecycle.apply([firstHolder.instanceId], 'focus', 1);
await lifecycle.apply([firstHolder.instanceId], 'focus', 9);
assert.equal(lifecycleState.living[0].statusEffects[0].stacks, 3, 'summon stacks honor the registered cap');
assert.equal(lifecycleState.living[0].block, 4, 'apply and stack triggers both resolve on the exact holder');
assert.equal(lifecycleState.living[1].block, 2, 'ordinary self never expands to every allied summon');
assert.deepEqual(executedContexts.slice(0, 2).map(context => context.triggerType), ['apply', 'stack']);

await lifecycle.processTurnEnd('player');
assert.equal(lifecycleState.living[0].block, 6, 'tick resolves on its summon holder');
assert.equal(lifecycleState.living[0].statusEffects[0].stacks, 2, 'turn-end decay follows the registered stack rule');
assert.equal(lifecycleState.living[1].block, 2);

await lifecycle.remove([firstHolder.instanceId], 'focus');
assert.equal(lifecycleState.living[0].statusEffects.length, 0);
assert.equal(lifecycleState.living[0].block, 9, 'remove trigger keeps the removed status holder identity');

await lifecycle.apply([firstHolder.instanceId], 'unstable', 1);
const beforeFailedTick = structuredClone(lifecycleState);
failUnstableTick = true;
await lifecycle.processTurnEnd('player');
assert.deepEqual(lifecycleState, beforeFailedTick, 'a failed summon tick rolls its mutations back and continues');
assert.equal(
  lifecycleEvents.filter(event => event.type === 'trigger_failed' && event.status.id === 'unstable').length,
  1,
  'failed isolated triggers emit a lifecycle event',
);

await lifecycle.apply([firstHolder.instanceId], 'missing_status', 1);
assert.equal(lifecycleEvents.at(-1).type, 'missing_definition');

console.log('Summon status lifecycle covers apply, stack caps, holder-local self, tick, decay, remove, and rollback.');
