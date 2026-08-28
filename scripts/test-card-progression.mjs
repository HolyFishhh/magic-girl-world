import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const program = amount => ({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount }] });
const runCard = {
  id: 'blade__run_card', templateId: 'blade', runInstanceId: 'blade__run__1', combatInstanceId: 'blade__run_card',
  originalId: 'blade', origin: 'deck', type: 'Attack', rarity: 'Common', cost: 2, effectProgram: program(6),
};

const first = core.applyCardUpgradeBundle(runCard, {
  source: { kind: 'card', id: 'growth_source', name: '成长来源' }, scope: 'combat', createdTurn: 2, maxLevel: 3,
  changes: [
    { kind: 'numeric', stat: 'damage', operator: 'add', value: 3 },
    { kind: 'cost', operator: 'subtract', value: 1 },
    { kind: 'keyword', keyword: 'retain', enabled: true },
  ],
});
assert.equal(first.effectProgram.steps[0].amount, 9);
assert.equal(first.cost, 1);
assert.equal(first.retain, true);
assert.equal(first.upgradeLevel, 1, 'one logical bundle increments one level');
assert.equal(first.upgradeHistory.length, 1);
assert.equal(runCard.effectProgram.steps[0].amount, 6, 'upgrade must not mutate source card');

const repeatable = core.applyCardUpgradeBundle(first, {
  source: { kind: 'card', id: 'growth_source' }, scope: 'permanent', createdTurn: 2, maxLevel: 3,
  changes: [{ kind: 'numeric', stat: 'damage', operator: 'add', value: 2 }],
});
assert.equal(repeatable.upgradeLevel, 2);
assert.equal(repeatable.effectProgram.steps[0].amount, 11);
assert.throws(() => core.applyCardUpgradeBundle(repeatable, {
  source: { kind: 'system', id: 'bad' }, scope: 'permanent', createdTurn: 2, maxLevel: 2,
  changes: [{ kind: 'numeric', stat: 'damage', operator: 'divide', value: 0 }],
}), /upgrade limit|divide by zero/);
assert.equal(repeatable.effectProgram.steps[0].amount, 11, 'failed upgrade leaves the source untouched');

const combatCopy = { ...repeatable, id: 'blade__combat__1', combatInstanceId: 'blade__combat__1' };
const temporaryCopy = {
  ...combatCopy, id: 'blade__combat__copy', combatInstanceId: 'blade__combat__copy', origin: 'copied',
  parentCombatInstanceId: combatCopy.id,
};
const writeBack = core.writeBackPersistentCardProgression([runCard], [combatCopy, temporaryCopy]);
assert.deepEqual(writeBack.updatedRunInstanceIds, ['blade__run__1']);
assert.deepEqual(writeBack.ignoredCombatInstanceIds, ['blade__combat__copy']);
assert.equal(writeBack.cards[0].effectProgram.steps[0].amount, 8, 'combat-only growth is stripped; permanent growth remains');
assert.equal(writeBack.cards[0].cost, 2);
assert.equal(writeBack.cards[0].upgradeLevel, 2);
assert.equal(writeBack.cards[0].combatInstanceId, runCard.combatInstanceId, 'combat identity never leaks into run deck');

console.log('Card upgrade bundles, repeatable levels, persistent write-back, temporary-copy exclusion, and rollback passed.');
