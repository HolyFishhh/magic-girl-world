import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));

const baseCard = {
  id: 'strike__combat__1',
  originalId: 'strike',
  templateId: 'strike',
  runInstanceId: 'strike__run__1',
  combatInstanceId: 'strike__combat__1',
  origin: 'deck',
  name: '测试攻击',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 6 }] },
};

const withResolutionChanges = () => {
  let card = core.appendCardPatch(baseCard, {
    id: 'card:focus:1:1',
    source: { kind: 'card', id: 'focus' },
    scope: 'resolution',
    createdTurn: 1,
    priority: 0,
    removeOn: 'resolution_end',
    kind: 'numeric',
    stat: 'damage',
    operator: 'add',
    value: 2,
  });
  card = core.applyCardAttachment(card, {
    id: 'brief_edge',
    kind: 'affliction',
    name: '瞬时刻印',
    source: { kind: 'card', id: 'focus' },
    scope: 'resolution',
    appliedTurn: 1,
    changes: [{ kind: 'numeric', stat: 'damage', operator: 'add', value: 1 }],
  });
  assert.equal(card.effectProgram.steps[0].amount, 9);
  assert.equal(card.attachments[0].removeOn, 'resolution_end');
  return card;
};

const buildExecutor = (store, executeProgram) => {
  const executor = Object.create(UnifiedEffectExecutor.prototype);
  executor.gameStateManager = store;
  executor.executionContext = { sourceIsPlayer: false };
  executor.pendingDeaths = new Set();
  executor.effectProgramDepth = 0;
  executor.effectCommandHost = { executeProgram };
  executor.processPendingDeaths = async () => {};
  return executor;
};

const emptyProgram = { spec: 'mwg.effect/v1', steps: [] };
const nestedState = core.createEmptyBattleState();
nestedState.player.hand = [withResolutionChanges()];
const nestedStore = new core.BattleStateStore(nestedState);
let executor;
let calls = 0;
executor = buildExecutor(nestedStore, async () => {
  calls += 1;
  if (calls !== 1) return;
  await executor.executeEffectProgram(emptyProgram, true);
  const duringOuter = nestedStore.getPlayer().hand[0];
  assert.equal(duringOuter.effectProgram.steps[0].amount, 9, 'nested auto-play/trigger does not close the outer resolution');
  assert.equal(duringOuter.attachments.length, 1);
});
await executor.executeEffectProgram(emptyProgram, true);
const afterOuter = nestedStore.getPlayer().hand[0];
assert.equal(afterOuter.effectProgram.steps[0].amount, 6);
assert.equal(afterOuter.attachments.length, 0);
assert.equal(afterOuter.patches.length, 0, 'the outermost resolution atomically clears direct and bundled patches');

// Replay invokes the effect program again after the previous resolution has
// closed; no resolution-scoped state may leak into the next replay.
nestedStore.updatePlayer({ hand: [withResolutionChanges()] });
await executor.executeEffectProgram(emptyProgram, true);
assert.equal(nestedStore.getPlayer().hand[0].effectProgram.steps[0].amount, 6);
await executor.executeEffectProgram(emptyProgram, true);
assert.equal(nestedStore.getPlayer().hand[0].effectProgram.steps[0].amount, 6);

const failedState = core.createEmptyBattleState();
failedState.player.hand = [withResolutionChanges()];
const failedStore = new core.BattleStateStore(failedState);
const failedExecutor = buildExecutor(failedStore, async () => { throw new Error('expected failure'); });
await assert.rejects(() => failedExecutor.executeEffectProgram(emptyProgram, true), /expected failure/);
assert.equal(failedStore.getPlayer().hand[0].effectProgram.steps[0].amount, 6);
assert.equal(failedStore.getPlayer().hand[0].attachments.length, 0, 'failed resolutions cannot leak temporary state');

const detached = core.finalizeCardResolution(withResolutionChanges());
assert.equal(detached.effectProgram.steps[0].amount, 6, 'a detached played card is cleaned before returning to a pile');
assert.equal(detached.attachments.length, 0);

console.log('Resolution-scoped card changes close after outer effects, replay calls, failures, and detached play.');
