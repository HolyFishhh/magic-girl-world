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
for (const axis of ['回响', '延迟结算', '姿态槽', '召唤', '自定义资源', 'X费用', '触发联动']) {
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

const metadataOnly = core.extractContentMechanicFeatures({ retain: false, free: false, block: 0, summon: { block: 0 } });
for (const operation of ['retain', 'free', 'block']) assert.ok(!metadataOnly.operations.includes(operation), `${operation} metadata must not become an executable mechanic`);

for (const [effect, expected] of [
  [{ modify: 'damage_taken', add: -1 }, true],
  [{ modify: 'damage_taken', subtract: 1 }, true],
  [{ modify: 'damage_taken', multiply: 0 }, true],
  [{ modify: 'damage_taken', divide: 2 }, true],
  [{ modify: 'damage_taken', set: -2 }, true],
  [{ modify: 'damage_taken', add: 1 }, false],
  [{ modify: 'damage_taken', subtract: -1 }, false],
  [{ modify: 'damage_taken', multiply: 1.25 }, false],
  [{ modify: 'damage_taken', multiply: 1 }, false],
  [{ modify: 'damage_taken', set: 2 }, false],
]) {
  const result = core.extractContentMechanicFeatures({ effects: effect }).operations.includes('damage_taken_reduction');
  assert.equal(result, expected, `damage_taken direction: ${JSON.stringify(effect)}`);
}

const compactMechanics = core.extractContentMechanicFeatures({ effects: [{ damage: 'skills_played_this_turn * 2' }, { spawn_summon: { id: 'drone', actions: [{ effects: { damage: 2 } }] } }, { activate_summon: { selector: { template_id: 'drone' } } }, { dismiss_summon: { selector: { template_id: 'drone' } } }] });
const compiledMechanics = core.extractContentMechanicFeatures({ effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: { op: 'var', path: 'skills_played_this_turn' } }, { op: 'spawn_summon', target: 'self', summon: { id: 'drone', name: '无人机', maxHp: 2, actions: [] }, count: 1 }, { op: 'activate_summons', selector: { templateId: 'drone' } }, { op: 'dismiss_summons', selector: { templateId: 'drone' } }] } });
for (const operation of ['damage', 'spawn_summon', 'activate_summon', 'dismiss_summon', 'history_formula']) {
  assert.ok(compactMechanics.operations.includes(operation), `compact form exposes ${operation}`);
  assert.ok(compiledMechanics.operations.includes(operation), `compiled form exposes ${operation}`);
}
assert.ok(compiledMechanics.axes.includes('召唤'));

function linkedResourceDeck(gainId, spendId) {
  return core.createContentPack({ cards: [
    { id: 'charge_gain', name: '蓄能', type: 'Skill', cost: 1, quantity: 3, effects: { resource: { id: gainId, amount: 2 } } },
    { id: 'charge_spend', name: '释放', type: 'Attack', cost: { [spendId]: 'all' }, quantity: 3, effects: { damage: `x_resource.${spendId} * 4` } },
  ] });
}
assert.ok(core.profileDeckArchetypes(linkedResourceDeck('charge', 'charge')).affinities.some(entry => entry.id === 'resource-cashout'), 'same resource may connect setup and payoff across cards');
const foreignOnlyCashout = core.profileDeckArchetypes(linkedResourceDeck('charge', 'focus')).affinities.find(entry => entry.id === 'resource-cashout');
assert.ok(foreignOnlyCashout?.supportingCards.includes('释放'), 'a resource-cost card remains a legal standalone cashout');
assert.ok(!foreignOnlyCashout?.supportingCards.includes('蓄能'), 'different resource identities do not fuse setup with that cashout');

const chargeWithForeignSpend = core.createContentPack({ cards: [
  { id: 'charge_gain', name: '充能建立', type: 'Skill', quantity: 3, effects: { resource: { id: 'charge', amount: 2 } } },
  { id: 'charge_guard', name: '充能防护', type: 'Skill', quantity: 3, effects: { block: 'x_resource.charge * 2' } },
  { id: 'focus_burst', name: '专注爆发', type: 'Attack', quantity: 3, cost: { focus: 'all' }, effects: { damage: 'x_resource.focus * 8' } },
] });
const chargeOnly = core.profileDeckArchetypes(core.createContentPack({ cards: chargeWithForeignSpend.cards.slice(0, 2) }));
const chargeMixed = core.profileDeckArchetypes(chargeWithForeignSpend);
const chargeAffinity = chargeMixed.affinities.find(entry => entry.id === 'resource-cashout');
assert.ok(chargeAffinity, 'charge setup and charge payoff form their own evidence group');
assert.ok(!chargeAffinity.supportingCards.includes('专注爆发'), 'foreign resource spender is absent from charge evidence');
assert.equal(chargeAffinity.score, chargeOnly.affinities.find(entry => entry.id === 'resource-cashout')?.score, 'unrelated cards do not dilute the linked group score');

const withThirtyTwoBlanks = core.createContentPack({ cards: [
  ...chargeWithForeignSpend.cards.slice(0, 2),
  ...Array.from({ length: 32 }, (_, index) => ({ id: `blank_${index}`, name: `白板${index}`, type: 'Skill', quantity: 1, effects: { block: 2 } })),
] });
assert.equal(
  core.profileDeckArchetypes(withThirtyTwoBlanks).affinities.find(entry => entry.id === 'resource-cashout')?.score,
  chargeOnly.affinities.find(entry => entry.id === 'resource-cashout')?.score,
  'more than 31 unrelated cards neither alias identities nor change the evidence-group score',
);

const singleCore = core.profileDeckArchetypes(core.createContentPack({ cards: [{ id: 'core', name: '核心使魔', type: 'Skill', quantity: 3, effects: { spawn_summon: { id: 'core_unit', name: '核心', slot: 'core', max_hp: 12, actions: [{ effects: { damage: 4 } }], abilities: [{id:'grow',name:'成长',trigger:{on:'turn_end',effects:{heal:1,to:'self'}}}] } } }] }));
const swarm = core.profileDeckArchetypes(core.createContentPack({ cards: [{ id: 'swarm', name: '蜂群', type: 'Skill', quantity: 3, effects: { spawn_summon: { id: 'drone', name: '蜂', max_hp: 2, count: 3, actions: [{ effects: { damage: 1 } }] } } }] }));
assert.ok(!singleCore.affinities.some(entry => entry.id === 'summon-swarm'), 'one passive core is not a swarm');
assert.ok(swarm.affinities.some(entry => entry.id === 'summon-swarm'), 'multiple spawned units are a swarm');
assert.ok(singleCore.affinities.some(entry => entry.id === 'summon-single-core'), 'one durable summon is identified as a core rather than a swarm');
assert.ok(singleCore.affinities.some(entry => entry.id === 'summon-passive-growth'), 'summon passive growth follows executable passive data');

const commandAndLifeFeatures = core.extractContentMechanicFeatures({ effects: [
  { activate_summon: { selector: { template_id: 'core_unit' } } },
  { damage_summon: { selector: { template_id: 'core_unit' }, amount: 3 } },
  { damage: 9 },
] });
assert.ok(commandAndLifeFeatures.operations.includes('activate_summon'));
assert.ok(commandAndLifeFeatures.operations.includes('damage_summon'));
const commandAndLife = core.profileDeckArchetypes(core.createContentPack({ cards: [{ id: 'command', name: '核心指令', type: 'Skill', quantity: 3, effects: commandAndLifeFeatures.operations.includes('damage_summon') ? [{ activate_summon: { selector: { template_id: 'core_unit' } } }, { damage_summon: { selector: { template_id: 'core_unit' }, amount: 3 } }, { damage: 9 }] : [] }] }));
assert.ok(commandAndLife.affinities.some(entry => entry.id === 'summon-command-chain'));
assert.ok(!commandAndLife.affinities.some(entry => entry.id === 'summon-life-conversion'), 'flat sacrifice damage is not HP-scaled summon damage');
const hpSummon = {spawn_summon:{id:'hp_core',name:'生命核心',emoji:'🤖',slot:'core',max_hp:12,actions:[{id:'strike',name:'生命打击',effects:{damage:'self.hp / 2'}}]}};
const hpCompiled=core.compileCompactEffectList(hpSummon);
assert.equal(hpCompiled.ok,true,JSON.stringify(hpCompiled.issues));
for(const value of [{effects:hpSummon},{effectProgram:hpCompiled.value}]) assert.ok(core.scoreContentArchetypes(value).some(entry=>entry.id==='summon-life-conversion'));
assert.ok(!core.extractContentMechanicFeatures({effects:{spawn_summon:{id:'empty',name:'空',abilities:[]}}}).operations.includes('summon_passive'));

const discardSplit = core.profileDeckArchetypes(core.createContentPack({ cards: [
  { id: 'discard_setup', name: '弃牌准备', type: 'Skill', quantity: 3, effects: { discard: { from: 'hand', pick: 'random' } } },
  { id: 'discard_payoff', name: '弃牌兑现', type: 'Attack', quantity: 3, effects: { damage: 'cards_discarded_this_turn * 4' } },
] }));
assert.ok(discardSplit.affinities.some(entry => entry.id === 'discard-payoff'), 'non-identity setup/payoff uses only its matching cross-card evidence group');

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

// Two unrelated setup cards do not constitute a linked payoff and cannot hide a valid singleton.
const gainOnlyGroup=core.profileDeckArchetypes(core.createContentPack({cards:[
 {id:'gain1',name:'建立一',type:'Skill',effects:{resource:{id:'charge',amount:2}}},
 {id:'gain2',name:'建立二',type:'Skill',effects:{resource:{id:'charge',amount:3}}},
 {id:'spender',name:'独立消耗',type:'Attack',cost:{focus:'all'},effects:{damage:'x_resource.focus * 3'}},
]}));
assert.ok(gainOnlyGroup.affinities.find(a=>a.id==='resource-cashout')?.supportingCards.includes('独立消耗'));
