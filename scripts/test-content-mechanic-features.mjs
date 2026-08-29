import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const advanced = {
  id: 'advanced', name: '机械测试', type: 'Power', rarity: 'Rare', cost: { energy: 1, charge: 'all' }, quantity: 1,
  trigger: {
    on: 'turn_start',
    effects: [
      { card_rule: 'replay', limit: 1, extra: 1, card_type: 'Attack' },
      { schedule: 1, phase: 'turn_end', effects: { channel_orb: { id: 'echo', name: '回声', value: 'x_resource.charge + 1' } } },
      { spawn_summon: { id: 'shade', name: '影子', emoji: '◈', max_hp: 5, action: { damage: 2 } } },
    ],
  },
};
const features = core.extractContentMechanicFeatures(advanced);
for (const axis of ['回响', '延迟结算', 'Orb', '召唤', '自定义资源', 'X费用', '触发联动']) {
  assert.ok(features.axes.includes(axis), `feature extractor must expose ${axis}`);
}
assert.ok(features.roles.includes('启动'));
assert.ok(features.roles.includes('收益'));
assert.ok(features.roles.includes('桥接'));
assert.ok(features.resources.includes('charge'));

const splitFeatures = core.extractContentMechanicFeatures({
  id: 'split',
  name: '分裂被动',
  trigger: 'defeated',
  effects: {
    spawn_enemy: {
      id: 'split_child', name: '分裂子体', emoji: '🦠', max_hp: 6,
      actions: [{ name: '扑击', effects: { damage: 2 } }],
      abilities: [], status_effects: [],
      lust_effect: { name: '孢子爆发', effects: { damage: 1 } },
      action_mode: 'random', action_config: {},
    },
  },
});
assert.ok(splitFeatures.axes.includes('增援与分裂'));

const summonControlFeatures = core.extractContentMechanicFeatures({
  effects: [
    { copy_summon: { selector: { owner: 'self', pick: 'choose' }, to: 'self' } },
    { modify_summon_effect: { selector: { owner: 'self', pick: 'all' }, stat: 'damage', add: 2 } },
    { summoner_effects: [{ energy: 1 }, { block: 2 }] },
  ],
});
assert.ok(summonControlFeatures.axes.includes('召唤'));
assert.ok(summonControlFeatures.operations.includes('copy_summon'));
assert.ok(summonControlFeatures.operations.includes('modify_summon_effect'));
assert.ok(summonControlFeatures.operations.includes('summoner_effects'));

const flatEight = { id: 'a', name: '甲', type: 'Attack', cost: 1, effects: { damage: 8 } };
const flatEleven = { id: 'b', name: '乙', type: 'Attack', cost: 1, effects: { damage: 11 } };
const sweep = { id: 'c', name: '丙', type: 'Attack', cost: 1, effects: { damage: 11, targets: { mode: 'all' } } };
assert.notEqual(core.createContentMechanicsFingerprint(flatEight), core.createContentMechanicsFingerprint(flatEleven));
assert.equal(
  core.createContentStructuralFingerprint(flatEight),
  core.createContentStructuralFingerprint(flatEleven),
  'number-only and presentation-only variants share one structural fingerprint',
);
assert.notEqual(
  core.createContentStructuralFingerprint(flatEleven),
  core.createContentStructuralFingerprint(sweep),
  'targeting changes are real structural novelty',
);

const pack = core.createContentPack({
  playerResources: [{ id: 'charge', name: '充能', current: 2, max: 4, refresh: 'keep' }],
  cards: [
    { id: 'charge_up', name: '积蓄', type: 'Skill', cost: 0, quantity: 3, effects: { resource: { id: 'charge', amount: 1 } } },
    { id: 'nova', name: '释放', type: 'Attack', cost: { charge: 'all' }, quantity: 3, effects: { damage: 'x_resource.charge * 4' } },
    { id: 'sweep', name: '扫击', type: 'Attack', cost: 1, quantity: 3, effects: { damage: 5, targets: { mode: 'all' } } },
    advanced,
  ],
  enemies: [
    {
      id: 'guard', name: '守卫', hp: 20, max_hp: 20, action_priority: 2, speed: 0,
      actions: [{ id: 'cover', name: '掩护', effects: { block: 4 } }],
      abilities: [
        { id: 'first_guard', name: '首次应击', trigger: { on: 'take_damage', scope: 'turn', ordinal: 'first', effects: { block: 3 } } },
        { id: 'rage', name: '反击准备', trigger: { on: 'turn_end', effects: { apply_status: 'mark', stacks: 1, to: 'opponent' } } },
      ],
    },
    {
      id: 'hunter', name: '猎手', hp: 24, max_hp: 24, action_priority: 1, speed: 3,
      actions: [{ id: 'hunt', name: '追猎', effects: { damage: 6, apply_status: 'mark', stacks: 1 } }],
    },
  ],
  statuses: [{ id: 'mark', name: '标记', type: 'debuff', triggers: { tick: { effects: { damage: 1 } } } }],
});
const assessment = core.assessContentDesign({
  pack,
  budget: core.summarizeBuildBudget(pack, { hp: 80, maxHp: 80 }),
  player: { hp: 80, maxHp: 80, lust: 0, maxLust: 100 },
});
for (const axis of ['自定义资源', 'X费用', '多目标']) assert.ok(assessment.build.mechanicAxes.includes(axis));
assert.equal(assessment.rewardPlan.directions.map(entry => entry.kind).join(','), 'reinforce,bridge,pivot,universal');
assert.equal(assessment.enemy.enemyCount, 2);
assert.ok(assessment.enemy.roles.some(role => role.includes('支援')));
assert.ok(assessment.enemy.synergies.includes('同一敌人具有多个独立被动'));
assert.ok(assessment.encounterPlan.guidance.some(entry => entry.includes('职责')));

const rewards = [flatEight, flatEleven, sweep];
const reviewed = core.assessContentDesign({
  pack,
  budget: core.summarizeBuildBudget(pack, { hp: 80, maxHp: 80 }),
  player: { hp: 80, maxHp: 80 },
  previous: assessment.context,
  rewardCandidates: rewards,
});
assert.equal(reviewed.reward.uniqueMechanics, 3);
assert.equal(reviewed.reward.uniqueStructures, 2);
assert.ok(reviewed.diagnostics.some(issue => issue.code === 'REWARD_MECHANICAL_DUPLICATES'));
assert.equal(reviewed.context.recentRewardStructures.length, 2);
const rerendered = core.assessContentDesign({
  pack,
  budget: core.summarizeBuildBudget(pack, { hp: 80, maxHp: 80 }),
  player: { hp: 80, maxHp: 80 },
  previous: reviewed.context,
  rewardCandidates: rewards,
});
assert.equal(rerendered.context.recentRewardStructures.length, 2, 'rerendering does not grow reward history');

console.log('Mechanic features, structural fingerprints, build axes, multi-enemy roles, and reward plans passed.');
