import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const reachEvent = seed => {
  let state = core.createRunState({ seed, floorsPerAct: 8 });
  for (let guard = 0; guard < 80; guard += 1) {
    const choice = state.choices.find(entry => entry.kind === 'event');
    if (choice) return core.enterRunNode(state, choice.id);
    state = core.completeRunNode(core.enterRunNode(state, state.choices[0].id), { outcome: 'cleared' });
  }
  throw new Error('event not reached');
};

const event = reachEvent(7);
assert.deepEqual(
  core.parseRunResultInput({ node_id: event.currentNode.id, outcome: 'cleared', gold: -10, hp: -12 }),
  { nodeId: event.currentNode.id, outcome: 'cleared', goldDelta: -10, hpDelta: -12 },
);
assert.throws(() => core.parseRunResultInput({ node_id: event.currentNode.id, outcome: 'cleared', hp_delta: -1 }), /字段不允许/);
assert.throws(() => core.parseRunResultInput({ node_id: event.currentNode.id, outcome: 'cleared', hp: '-1' }), /节点结果 hp 无效/);
assert.throws(() => core.parseRunResultInput({ node_id: '', outcome: 'cleared' }), /节点结果 node_id 无效/);
const inputBefore = structuredClone(event);
const settled = core.settleEventOutcome(
  event,
  { nodeId: event.currentNode.id, outcome: 'cleared', goldDelta: -10, hpDelta: -12 },
  { hp: 50, maxHp: 80 },
);
assert.equal(settled.hp, 38);
assert.equal(settled.run.gold, event.gold - 10);
assert.equal(settled.run.phase, 'awaiting_choice');
assert.deepEqual(event, inputBefore, 'portable event settlement must not mutate its inputs');

assert.equal(
  core.settleEventOutcome(event, { nodeId: event.currentNode.id, outcome: 'cleared', hpDelta: 999 }, { hp: 50, maxHp: 80 }).hp,
  80,
);
assert.throws(
  () => core.settleEventOutcome(event, { nodeId: event.currentNode.id, outcome: 'cleared', hpDelta: -50 }, { hp: 50, maxHp: 80 }),
  /不能使生命降到 0/,
);
assert.throws(
  () => core.settleEventOutcome(event, { nodeId: 'stale', outcome: 'cleared' }),
  /已过期/,
);

console.log('Portable event settlement atomically computes route, gold, and bounded HP outcomes.');
