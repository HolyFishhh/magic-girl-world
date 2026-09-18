import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const {
  canonicalizeTowerOpeningArtifactIds,
  createRunState,
  completeRunNode,
  enterRunNode,
  validateTowerOpeningRewardCandidates,
} = require('../src/game-core/index.ts');
const {
  executeUnifiedRunTransactionInStat,
  settleTowerOpeningChoiceInStat,
} = require('../src/common/runTransactions.ts');

function statWithOpening(outcome) {
  const run = createRunState({ seed: 174 });
  run.opening = {
    phase: 'ready',
    requestId: 'opening-request',
    basedOnRevision: 0,
    attempts: 1,
    content: {
      title: '启程礼物',
      narrative: '旅途开始前，一份馈赠落入手中。',
      choices: [{ id: 'accept', label: '接受', outcome }],
    },
  };
  return {
    run,
    battle: {
      core: { hp: 100, max_hp: 100, lust: 10, max_lust: 100, card_removal_count: 1, resources: [] },
      cards: [],
      artifacts: [],
      items: [],
      statuses: [],
    },
    reward: { card: [], artifact: [], item: [], limits: {}, disabled_categories: [] },
  };
}

const stat = statWithOpening({
  hp: -5,
  max_hp: 10,
  lust: 15,
  max_lust: 5,
  gold: 20,
  card_removals: 1,
  reward: {
    items: [{
      id: 'opening_tonic',
      name: '启程药剂',
      count: 1,
      description: '为接下来的道路准备的温和药剂。',
      effects: { heal: 5 },
    }],
  },
});
const result = settleTowerOpeningChoiceInStat(stat, 'accept');
assert.equal(result.hp, 110, 'each act opening restores health after applying any maximum increase');
assert.equal(result.maxHp, 110);
assert.equal(stat.battle.core.lust, 25);
assert.equal(stat.battle.core.max_lust, 105, 'opening max_lust is a persistent relative increase');
assert.equal(result.gold, 119);
assert.equal(result.cardRemovalCount, 2);
assert.deepEqual(result.items, ['启程药剂']);
assert.equal(stat.battle.items[0].id, 'opening_tonic');
assert.equal(stat.run.opening.phase, 'consumed');
assert.equal(stat.run.floor, 0, 'the opening is independent of the map start room');
assert.equal(stat.run.choices.length, 3, 'all three ordinary first-floor routes remain available after the gift');
assert.ok(stat.run.choices.every(choice => choice.floor === 1 && choice.kind === 'battle'));
assert.equal(new Set(stat.run.choices.map(choice => choice.id)).size, 3, 'the opening preserves three distinct route choices');
assert.throws(() => settleTowerOpeningChoiceInStat(stat, 'accept'), /没有可结算/);
assert.equal(stat.battle.core.max_lust, 105, 'a repeated claim cannot grant the increase twice');

// Boss completion starts the next act at an independent opening boundary.
// The second gift heals once without consuming the new first battle room.
while (stat.run.act === 1) {
  stat.run = enterRunNode(stat.run, stat.run.choices[0].id);
  stat.run = completeRunNode(stat.run, { outcome: 'cleared' });
}
assert.equal(stat.run.act, 2);
assert.equal(stat.run.floor, 0);
assert.equal(stat.run.opening.phase, 'pending');
stat.run.opening = {
  phase: 'ready', requestId: 'act-two-opening', basedOnRevision: stat.run.stateRevision, attempts: 2,
  content: { title: '第二幕馈赠', narrative: '首领之后，一道新的门扉打开。', choices: [{ id: 'act-two', label: '继续前行', outcome: { gold: 15 } }] },
};
stat.battle.core.hp = 12;
const actTwo = settleTowerOpeningChoiceInStat(stat, 'act-two');
assert.equal(actTwo.hp, stat.battle.core.max_hp);
assert.equal(stat.run.act, 2);
assert.equal(stat.run.floor, 0);
assert.equal(stat.run.choices[0].kind, 'battle');
assert.throws(() => settleTowerOpeningChoiceInStat(stat, 'act-two'), /没有可结算/);
for (const [max_lust, lust, expectedMax, expectedLust] of [[5, 999, 105, 105], [-99, 0, 1, 1], [0, -999, 100, 0]]) {
  const changed = statWithOpening({ max_lust, lust });
  settleTowerOpeningChoiceInStat(changed, 'accept');
  assert.equal(changed.battle.core.max_lust, expectedMax);
  assert.equal(changed.battle.core.lust, expectedLust, 'current desire is clamped after updating the cap');
}
for (const max_lust of [-100, 1000, 1.5, '5']) {
  const invalidCap = statWithOpening({ max_lust });
  const beforeCap = structuredClone(invalidCap);
  assert.throws(() => settleTowerOpeningChoiceInStat(invalidCap, 'accept'), /欲望上限变化/);
  assert.deepEqual(invalidCap, beforeCap);
}
const invalidCapReward = statWithOpening({ max_lust: 5, reward: { cards: [{ id: 'broken' }] } });
const beforeCapReward = structuredClone(invalidCapReward);
assert.throws(() => settleTowerOpeningChoiceInStat(invalidCapReward, 'accept'));
assert.deepEqual(invalidCapReward, beforeCapReward, 'a failed reward cannot partially grant the cap increase');

const openingGiftStatuses = [
  {
    id: 'opening_force', name: '启程之力', emoji: '⚔️', type: 'buff',
    triggers: { hold: { modify: 'damage', add: 'stacks' } },
  },
  {
    id: 'opening_guard', name: '启程之护', emoji: '🛡️', type: 'buff',
    triggers: { hold: { modify: 'block', add: 'stacks' } },
  },
  {
    id: 'opening_focus', name: '启程之愈', emoji: '✨', type: 'buff',
    triggers: { hold: { modify: 'heal', add: 'stacks' } },
  },
];
const multiStatusOpening = statWithOpening({
  reward: {
    artifacts: [{
      id: 'opening_threefold_charm',
      name: '三相启程符',
      rarity: 'Rare',
      trigger: {
        on: 'battle_start',
        effects: {
          choose: 'opening_threefold_choice',
          options: openingGiftStatuses.map((status, index) => ({
            id: `opening_threefold_${index + 1}`,
            label: status.name,
            effects: { apply_status: status.id, stacks: 1, to: 'self' },
          })),
        },
      },
      statuses: openingGiftStatuses,
    }],
  },
});
const multiStatusOpeningResult = settleTowerOpeningChoiceInStat(multiStatusOpening, 'accept');
assert.deepEqual(multiStatusOpeningResult.artifacts, ['三相启程符']);
assert.deepEqual(multiStatusOpening.battle.statuses.map(status => status.id), openingGiftStatuses.map(status => status.id));
assert.equal(multiStatusOpening.battle.artifacts[0].status, undefined);
assert.equal(multiStatusOpening.battle.artifacts[0].statuses, undefined);

const invalid = statWithOpening({ reward: { items: [{ id: 'broken' }] } });
const before = structuredClone(invalid);
assert.throws(() => settleTowerOpeningChoiceInStat(invalid, 'accept'));
assert.deepEqual(invalid, before, 'invalid opening rewards must roll back every scalar and route change');

const openingBattle = {
  core: { resources: [] },
  cards: [],
  artifacts: [],
  items: [],
  statuses: [],
};
const validFilteredRecoveryChoice = [{
  id: 'prepare',
  label: '整备牌库',
  outcome: {
    reward: {
      cards: [{
        id: 'gear_recovery',
        name: '齿轮整备',
        type: 'Skill',
        rarity: 'Uncommon',
        cost: 1,
        quantity: 1,
        effects: { recover: 1, from: 'discard', pick: 'choose', card_type: 'Attack' },
      }],
    },
  },
}];
assert.doesNotThrow(() => validateTowerOpeningRewardCandidates(validFilteredRecoveryChoice, openingBattle));
const ownedOpeningArtifact = {
  id: 'gear_core',
  name: '齿轮核心',
  rarity: 'Uncommon',
  trigger: { on: 'turn_start', effects: { block: 1 } },
};
const artifactCollisionBattle = {
  ...structuredClone(openingBattle),
  artifacts: [structuredClone(ownedOpeningArtifact)],
};
const artifactCollisionChoices = [{
  id: 'choice_overdrive',
  label: '过载模块',
  outcome: { reward: { artifacts: [structuredClone(ownedOpeningArtifact)] } },
}];
const canonicalArtifactChoices = canonicalizeTowerOpeningArtifactIds(
  artifactCollisionChoices,
  artifactCollisionBattle,
);
assert.equal(
  artifactCollisionChoices[0].outcome.reward.artifacts[0].id,
  'gear_core',
  'opening artifact canonicalization must not mutate the model response',
);
assert.match(
  canonicalArtifactChoices[0].outcome.reward.artifacts[0].id,
  /^gear_core__opening_[a-z0-9]+$/,
);
assert.doesNotThrow(() => validateTowerOpeningRewardCandidates(canonicalArtifactChoices, artifactCollisionBattle));
const invalidOpeningChoice = structuredClone(validFilteredRecoveryChoice);
invalidOpeningChoice[0].outcome.reward.cards[0].effects.illegal_field = true;
assert.throws(
  () => validateTowerOpeningRewardCandidates(invalidOpeningChoice, openingBattle),
  /开局馈赠 prepare\.cards\[0\].*无效/,
  'opening candidates must fail during initial validation instead of after the player clicks them',
);
const twoInvalidOpeningChoices = [
  ...invalidOpeningChoice,
  {
    id: 'prepare_again',
    label: '再次整备',
    outcome: {
      reward: {
        cards: [{
          ...structuredClone(validFilteredRecoveryChoice[0].outcome.reward.cards[0]),
          id: 'second_bad_card',
          effects: { another_illegal_field: true },
        }],
      },
    },
  },
];
assert.throws(
  () => validateTowerOpeningRewardCandidates(twoInvalidOpeningChoices, openingBattle),
  error => /prepare\.cards\[0\]/.test(error.message) && /prepare_again\.cards\[0\]/.test(error.message),
  'one repair request must receive every invalid mutually exclusive reward candidate',
);
const invalidOutcomeAndCandidate = structuredClone(invalidOpeningChoice);
invalidOutcomeAndCandidate[0].outcome.status = 'temporary_block';
assert.throws(
  () => validateTowerOpeningRewardCandidates(invalidOutcomeAndCandidate, openingBattle),
  error => /prepare\.outcome 无效：开局馈赠不支持字段：status/.test(error.message)
    && /prepare\.cards\[0\].*无效/.test(error.message),
  'an invalid sibling outcome field must not hide independently inspectable reward candidate errors',
);

const treasureStat = statWithOpening({});
treasureStat.run.opening.phase = 'consumed';
while (treasureStat.run.floor < 8) {
  treasureStat.run = enterRunNode(treasureStat.run, treasureStat.run.choices[0].id);
  treasureStat.run = completeRunNode(treasureStat.run, { outcome: 'cleared' });
}
const treasure = treasureStat.run.choices.find(choice => choice.kind === 'treasure');
assert.ok(treasure, 'floor 9 must expose the mandatory treasure node');
treasureStat.run = enterRunNode(treasureStat.run, treasure.id);
treasureStat.reward.artifact = [1, 2, 3].map(index => ({
  id: `treasure_relic_${index}`,
  name: `宝箱遗物${index}`,
  rarity: 'Common',
  trigger: { on: 'battle_start', effects: { block: index } },
}));
treasureStat.reward.limits = { cards: 0, artifacts: 1, items: 0 };
const treasureResult = executeUnifiedRunTransactionInStat(treasureStat, {
  kind: 'treasure_reward_claim',
  selections: { cards: [], artifacts: [0], items: [] },
});
assert.equal(treasureStat.run.phase, 'awaiting_choice');
assert.equal(treasureStat.run.floor, 9);
assert.equal(treasureStat.run.nodeCounts.treasure, 1, 'the independent opening does not consume a treasure node');
assert.equal(treasureResult.event.type, 'treasure_claimed');

console.log('tower opening and treasure settlements are atomic');
