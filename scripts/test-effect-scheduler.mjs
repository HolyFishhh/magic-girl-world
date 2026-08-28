import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const source = id => ({ kind: 'card', id });
const payload = amount => ({
  type: 'effect_program',
  sourceIsPlayer: true,
  program: { spec: core.EFFECT_PROGRAM_SPEC, steps: [{ op: 'gain_block', target: 'self', amount }] },
});

let scheduler = core.createEffectSchedulerState();
for (const draft of [
  { source: source('later'), owner: 'player', createdTurn: 1, dueTurn: 2, phase: 'turn_start', priority: 5, payload: payload(2) },
  { source: source('first'), owner: 'player', createdTurn: 1, dueTurn: 2, phase: 'turn_start', priority: 0, payload: payload(3) },
  { source: source('second'), owner: 'player', createdTurn: 1, dueTurn: 2, phase: 'turn_start', priority: 0, payload: payload(4) },
]) scheduler = core.scheduleEffect(scheduler, draft).state;

const stable = core.takeDueScheduledEffects(scheduler, 2, 'turn_start');
assert.deepEqual(stable.due.map(entry => entry.source.id), ['first', 'second', 'later']);
assert.equal(stable.state.queue.length, 0);

const repeated = core.scheduleEffect(core.createEffectSchedulerState(), {
  source: source('repeat'), owner: 'player', createdTurn: 2, dueTurn: 3, phase: 'turn_end', priority: 0,
  repeatEvery: 2, remainingRepeats: 3, payload: payload(1),
}).state;
const skipped = core.takeDueScheduledEffects(repeated, 5, 'turn_end');
assert.equal(skipped.due.length, 1, 'a skipped due turn executes once at the next matching phase');
assert.equal(skipped.state.queue[0].dueTurn, 7, 'repeat cadence resumes from the observed turn');
assert.equal(skipped.state.queue[0].remainingRepeats, 2);
assert.equal(core.takeDueScheduledEffects(skipped.state, 5, 'turn_end').due.length, 0, 'an extra turn cannot repeat the same occurrence');
const second = core.takeDueScheduledEffects(skipped.state, 7, 'turn_end');
const third = core.takeDueScheduledEffects(second.state, 9, 'turn_end');
assert.equal(second.due.length, 1);
assert.equal(third.due.length, 1);
assert.equal(third.state.queue.length, 0);

const cancelBase = core.scheduleEffect(core.createEffectSchedulerState(), {
  source: source('cancel'), owner: 'enemy', createdTurn: 0, dueTurn: 4, phase: 'after_draw', priority: 0,
  payload: { type: 'remove_status', owner: 'player', statusId: 'marked' },
}).state;
const cancelled = core.cancelScheduledEffects(cancelBase, entry => entry.source.id === 'cancel');
assert.equal(cancelled.cancelled.length, 1);
assert.equal(cancelled.state.queue.length, 0);

const restored = core.createEffectSchedulerState(JSON.parse(JSON.stringify(skipped.state)).queue);
assert.equal(core.validateEffectSchedulerState(restored), true);
assert.deepEqual(restored.queue, skipped.state.queue);
assert.ok(core.scheduleEffect(restored, {
  source: source('restored'), owner: 'system', createdTurn: 5, dueTurn: 6, phase: 'before_draw', priority: 0,
  payload: { type: 'defeat_entity', entityId: 'enemy:1', reason: 'delayed_death' },
}).scheduled.id.endsWith(':2'), 'sequence allocation survives restore');

const atomicBase = core.scheduleEffect(core.createEffectSchedulerState(), {
  source: source('atomic-a'), owner: 'player', createdTurn: 0, dueTurn: 1, phase: 'turn_start', priority: 0, payload: payload(2),
}).state;
const atomicQueue = core.scheduleEffect(atomicBase, {
  source: source('atomic-b'), owner: 'player', createdTurn: 0, dueTurn: 1, phase: 'turn_start', priority: 1, payload: payload(5),
}).state;
const before = JSON.stringify(atomicQueue);
await assert.rejects(
  core.runScheduledPhaseAtomically(atomicQueue, 1, 'turn_start', { block: 0 }, (draft, effect) => {
    if (effect.source.id === 'atomic-b') throw new Error('host transaction failed');
    return { block: draft.block + 2 };
  }),
  /host transaction failed/,
);
assert.equal(JSON.stringify(atomicQueue), before, 'failed phase must not mutate scheduler or host input');
const committed = await core.runScheduledPhaseAtomically(atomicQueue, 1, 'turn_start', { block: 0 }, (draft, effect) => ({
  block: draft.block + (effect.source.id === 'atomic-a' ? 2 : 5),
}));
assert.equal(committed.value.block, 7);
assert.equal(committed.state.queue.length, 0);

assert.throws(() => core.scheduleEffect(core.createEffectSchedulerState(), {
  source: source('bad'), owner: 'system', createdTurn: 2, dueTurn: 1, phase: 'turn_start', priority: 0, payload: payload(1),
}), /must not precede/);

console.log('Effect scheduler covers phases, stable order, overdue turns, repeats, extra turns, cancellation, restore, and atomic retry.');
