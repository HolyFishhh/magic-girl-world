import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { validateRewardCandidateAgainstLibrary, collectRewardCandidateTypedContractIssues } = require('../src/game-core/rewardCandidateValidation.ts');
const { validateTowerOpeningRewardCandidates } = require('../src/game-core/towerOpeningOutcome.ts');
const { applyRewardSelectionsToStat } = require('../src/common/rewardTransactions.ts');
const {
  extractTowerInitialRepairTargets,
  extractTowerInitialRepairSlotTargets,
} = require('../src/sillytavern-extension/controller.ts');
const payoff = { name: '满溢打击', effects: [{ damage: 50 }] };
const card = { id: 'lust_card', name: '欲望打击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: [{ lust: 10, to: 'opponent' }] };
const candidates = {
  cards: card,
  artifacts: { id: 'lust_relic', name: '欲望遗物', rarity: 'Common', trigger: 'battle_start', effects: [{ lust: 10, to: 'opponent' }] },
  items: { id: 'lust_item', name: '欲望药剂', count: 1, effects: [{ lust: 10, to: 'opponent' }] },
};
for (const [category, value] of Object.entries(candidates)) {
  const before = JSON.stringify(value);
  const valid = validateRewardCandidateAgainstLibrary(category, value, { playerDesireEffect: payoff });
  assert.equal(valid.ok, true, JSON.stringify(valid));
  const missing = validateRewardCandidateAgainstLibrary(category, value, {});
  assert.equal(missing.ok, false);
  assert.match(missing.message, /desireEffects.player/);
  assert.equal(validateRewardCandidateAgainstLibrary(category, value, { playerDesireEffect: {} }).ok, false, 'empty owner effect is not a bypass');
  assert.equal(JSON.stringify(value), before, 'validation must not mutate reward');
}
const choices = [{ id: 'gift', outcome: { reward: { cards: [card] } } }];
const pressureStatus = {
  id: 'pressure', name: '欲望烙印', emoji: '◈', type: 'debuff',
  triggers: { tick: { lust: 3 } },
};
const relayStatus = {
  id: 'relay', name: '烙印传递', emoji: '◈', type: 'debuff',
  triggers: { tick: { apply_status: 'pressure', stacks: 1, to: 'self' } },
};
const statusDefinitions = [pressureStatus, relayStatus];
for (const statusId of ['pressure', 'relay']) for (const [category, base] of Object.entries(candidates)) {
  const candidate = { ...base, effects: [{ apply_status: statusId, stacks: 1, to: 'opponent' }] };
  const before = structuredClone({ candidate, statusDefinitions });
  for (const owner of [undefined, {}, payoff]) {
    const library = { statusDefinitions, playerDesireEffect: owner };
    const result = validateRewardCandidateAgainstLibrary(category, candidate, library);
    assert.equal(result.ok, owner === payoff, `${category}/${statusId}: ${JSON.stringify(result)}`);
    if (owner === undefined) {
      assert.ok(collectRewardCandidateTypedContractIssues(category, candidate, library)
        .some(issue => issue.code === 'MISSING_LUST_OVERFLOW_EFFECT' && issue.path === 'desireEffects.player'));
    }
  }
  assert.deepEqual({ candidate, statusDefinitions }, before, 'reference traversal must not mutate candidate or library');
}
const indirectCard = { ...card, effects: [{ apply_status: 'relay', stacks: 1, to: 'opponent' }] };
const unrelatedInvalidStatus = { id: 'unrelated', unsupported: true };
assert.deepEqual(collectRewardCandidateTypedContractIssues('cards', indirectCard, {
  statusDefinitions: [...statusDefinitions, unrelatedInvalidStatus], playerDesireEffect: payoff,
}), [], 'unrelated library structure is validated by its owner, not duplicated per reward');
assert.equal(validateRewardCandidateAgainstLibrary('cards', { ...card, effects: [{ block: 3 }] }, {
  statusDefinitions,
}).ok, true, 'an unreferenced lust status must not require an owner payoff');
assert.equal(validateRewardCandidateAgainstLibrary('cards', {
  ...indirectCard, statuses: [{ ...relayStatus, triggers: { tick: { block: 1 } } }],
}, { statusDefinitions, playerDesireEffect: payoff }).ok, false, 'candidate cannot overwrite a registered status with different rules');
assert.equal(validateRewardCandidateAgainstLibrary('cards', {
  ...indirectCard, statuses: [relayStatus],
}, { statusDefinitions, playerDesireEffect: payoff }).ok, true, 'equal support definitions remain legal');
const indirectChoices = [{ id: 'indirect_gift', outcome: { reward: { cards: [indirectCard] } } }];
assert.throws(() => validateTowerOpeningRewardCandidates(indirectChoices, { statuses: statusDefinitions }), /desireEffects.player/);
assert.doesNotThrow(() => validateTowerOpeningRewardCandidates(indirectChoices, {
  statuses: statusDefinitions, player_lust_effect: payoff,
}));
for (const owner of [undefined, {}, payoff]) {
  const state = { battle: { core: {}, cards: [], artifacts: [], items: [], statuses: statusDefinitions, player_lust_effect: owner },
    reward: { card: [indirectCard], artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 } } };
  const before = structuredClone(state);
  const claim = () => applyRewardSelectionsToStat(state, { cards: [0], artifacts: [], items: [] });
  if (owner === payoff) {
    assert.doesNotThrow(claim);
    assert.equal(state.battle.cards[0].id, indirectCard.id);
  } else {
    assert.throws(claim, /desireEffects.player/);
    assert.deepEqual(state, before, 'rejected indirect reward leaves the entire transaction unchanged');
  }
}
for (const [category, value] of Object.entries(candidates)) {
  const growth = { ...value, effects: [{ persistent_growth: 'max_hp', add: 2 }] };
  const result = validateRewardCandidateAgainstLibrary(category, growth, {});
  assert.equal(result.ok, true, `player-owned growth reward: ${JSON.stringify(result)}`);
}
assert.doesNotThrow(() => validateTowerOpeningRewardCandidates(choices, { player_lust_effect: payoff }));
assert.throws(() => validateTowerOpeningRewardCandidates(choices, {}), /desireEffects.player/);
const stat = { battle: { core: {}, cards: [], artifacts: [], items: [], player_lust_effect: payoff }, reward: {
  card: [card], artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 },
} };
assert.doesNotThrow(() => applyRewardSelectionsToStat(stat, { cards: [0], artifacts: [], items: [] }));
assert.equal(stat.battle.cards[0].id, card.id);
const initialWithTwoLustGifts = {
  narrative: '开场',
  player: { cards: [] },
  opening: {
    choices: [
      { id: 'gift_a', outcome: { reward: { cards: [card] } } },
      { id: 'gift_b', outcome: { reward: { items: [candidates.items] } } },
    ],
  },
};
const twoGiftOwnerErrors = [
  '开局馈赠 gift_a.cards[0] 欲望打击 无效：desireEffects.player: player content can increase lust and must define a non-empty player desire effect',
  '开局馈赠 gift_b.items[0] 欲望药剂 无效：desireEffects.player: player content can increase lust and must define a non-empty player desire effect',
].join('；');
const ownerRepairSlots = extractTowerInitialRepairSlotTargets(initialWithTwoLustGifts, twoGiftOwnerErrors);
assert.equal(ownerRepairSlots.length, 1, JSON.stringify(ownerRepairSlots));
assert.equal(ownerRepairSlots[0].path, 'player.player_lust_effect');
assert.deepEqual(ownerRepairSlots[0].slots.map(slot => ({ kind: slot.kind, path: slot.path })), [
  { kind: 'missing_lust_effect', path: 'player.player_lust_effect' },
]);
const mixedRepairRoots = extractTowerInitialRepairTargets(
  initialWithTwoLustGifts,
  `${twoGiftOwnerErrors}；开局馈赠 gift_b.items[0] 欲望药剂 无效：items[0].count: count must be 1..999`,
);
assert.deepEqual(mixedRepairRoots.map(root => root.path), [
  'opening.choices[1]',
  'player.player_lust_effect',
]);
if (process.argv[2]) {
  const archive = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const compiled = JSON.parse(archive.run.records.find(record => record.stage === 'compiled-result').text);
  assert.ok(compiled.player.player_lust_effect, 'recorded model already supplied owner payoff');
  assert.doesNotThrow(() => validateTowerOpeningRewardCandidates(compiled.opening.choices, compiled.player));
  const missing = structuredClone(compiled.player);
  delete missing.player_lust_effect;
  assert.throws(() => validateTowerOpeningRewardCandidates(compiled.opening.choices, missing), /desireEffects.player/);
  console.log('Archived failed opening passes unchanged; deleting the actual owner payoff still fails.');
}
console.log('Reward owner desire context: cards, relics, items, gifts and battle settlement passed.');
