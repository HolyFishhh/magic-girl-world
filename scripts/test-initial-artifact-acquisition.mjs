import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const run = require(resolve('src/game-core/runState.ts'));
const acquisitions = require(resolve('src/common/initialArtifactAcquisition.ts'));
const transactions = require(resolve('src/common/runTransactions.ts'));

const card = (id, name = id) => ({ id, name, type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { block: 2 } });
const source = {
  id: 'first_relic', name: '初始遗物', rarity: 'Rare', on_acquire: {
    gold: 4, max_hp: 2, gain_cards: [card('first_card', '初得卡')],
    grant: { cards: [card('choice_card', '选择卡')], items: [], limits: { cards: 1, items: 0 } },
  },
};
const base = () => ({
  run: run.createRunState({ seed: 77 }),
  battle: { core: { hp: 20, max_hp: 30, lust: 0, max_lust: 100, card_removal_count: 0, resources: [] }, cards: [], artifacts: [structuredClone(source)], items: [], statuses: [] },
  reward: { card: [], artifact: [], item: [], limits: {} },
});

const receipt = acquisitions.createInitialArtifactAcquisitionReceipt([source], 'initial-77', 0);
assert.equal(receipt.phase, 'pending');
assert.equal(acquisitions.createInitialArtifactAcquisitionReceipt([], 'initial-77', 0), null);
const stat = base();
stat[acquisitions.INITIAL_ARTIFACT_ACQUISITION_KEY] = receipt;
assert.equal(acquisitions.hasPendingInitialArtifactAcquisition(JSON.parse(JSON.stringify(stat))), true, 'JSON restore preserves a pending initial receipt');
const settled = acquisitions.settleInitialArtifactAcquisitionInStat(stat, { first_relic: { grant: { cards: [0], items: [] } } });
assert.equal(settled.phase, 'settled');
assert.equal(stat[acquisitions.INITIAL_ARTIFACT_ACQUISITION_KEY].generationId, 'initial-77');
assert.equal(stat.run.gold, 103);
assert.equal(stat.battle.core.max_hp, 32);
assert.deepEqual(stat.battle.cards.map(entry => entry.id).sort(), ['choice_card', 'first_card']);
const afterFirst = structuredClone(stat);
assert.equal(acquisitions.settleInitialArtifactAcquisitionInStat(stat, {}), null, 'a settled receipt never replays on retry');
assert.deepEqual(stat, afterFirst);
assert.equal(acquisitions.settleInitialArtifactAcquisitionInStat(base(), {}), null, 'old saves without a receipt never receive a load-time scan');

const unified = base();
unified[acquisitions.INITIAL_ARTIFACT_ACQUISITION_KEY] = receipt;
const unifiedResult = transactions.executeUnifiedRunTransactionInStat(unified, {
  kind: 'initial_artifact_acquisition', generationId: 'initial-77',
  answers: { first_relic: { grant: { cards: [0], items: [] } } }, expectedRevision: 0,
});
assert.deepEqual(unifiedResult.value.artifactNames, ['初始遗物']);
assert.equal(unified.run_transaction_revision, 1);
assert.equal(unified.run_transaction_events.at(-1).type, 'initial_artifacts_acquired');
const unifiedAfter = structuredClone(unified);
assert.throws(() => transactions.executeUnifiedRunTransactionInStat(unified, {
  kind: 'initial_artifact_acquisition', generationId: 'initial-77', answers: {}, expectedRevision: 1,
}), /已处理/);
assert.deepEqual(unified, unifiedAfter, 'the unified transaction journal cannot replay one receipt');

const rejected = base();
const costly = structuredClone(source); costly.on_acquire = { cost: { gold: 1000 }, gold: 1 };
rejected.battle.artifacts = [costly];
rejected[acquisitions.INITIAL_ARTIFACT_ACQUISITION_KEY] = acquisitions.createInitialArtifactAcquisitionReceipt([costly], 'initial-cost', 0);
const rejectedBefore = structuredClone(rejected);
assert.throws(() => acquisitions.settleInitialArtifactAcquisitionInStat(rejected, {}), /金币成本不可支付/);
assert.deepEqual(rejected, rejectedBefore, 'a failed initial acquisition preserves the receipt, ownership, reward pool, and all scalar state');

const mismatched = base();
mismatched[acquisitions.INITIAL_ARTIFACT_ACQUISITION_KEY] = receipt;
mismatched.battle.artifacts[0].name = '被篡改遗物';
const mismatchBefore = structuredClone(mismatched);
assert.throws(() => acquisitions.hasPendingInitialArtifactAcquisition(mismatched), /不一致/);
assert.deepEqual(mismatched, mismatchBefore, 'identity validation is read-only and blocks stale sources');

console.log('Initial artifact acquisition receipt stamps only explicit new content and settles atomically.');
