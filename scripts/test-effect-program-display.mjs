import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { EffectProgramDisplay } = require(resolve('src/fish/ui/effectProgramDisplay.ts'));
const { DynamicStatusManager } = require(resolve('src/fish/combat/dynamicStatusManager.ts'));
const { compactContentToDisplayTags } = require(resolve('src/game-core/effectDisplay.ts'));

const manager = DynamicStatusManager.getInstance();
const loaded = manager.registry.replace([
  {
    id: 'death_mark',
    name: '死印',
    emoji: '◆',
    type: 'debuff',
    stacks_change: -1,
    triggers: { tick: { damage: 'stacks', to: 'self' } },
  },
]);
assert.equal(loaded.rejected.length, 0);

const display = EffectProgramDisplay.getInstance();
const defenseTags = compactContentToDisplayTags({ defense: { prevent_hp_loss: true, retaliate_attack: 3 } }).map(entry => entry.text);
assert.ok(defenseTags.some(text => text.includes('抵消一次格挡后仍会失去生命')));
assert.ok(defenseTags.some(text => text.includes('反击3点伤害')));
for (const amount of [2, -2, 0]) {
  const effects = {resource:{id:'charge',amount}};
  const change = amount < 0 ? '减少2点充能' : `获得${amount}点充能`;
  const context = {resourceNames:{charge:'充能'}};
  assert.deepEqual(compactContentToDisplayTags({effects},context).map(tag=>tag.text), [`自身${change}`]);
  assert.deepEqual(compactContentToDisplayTags({effects:{...effects,to:'opponent'}},context).map(tag=>tag.text), [`敌方${change}`]);
  assert.match(compactContentToDisplayTags({effects:{summon_resource:{selector:{owner:'self',pick:'all'},id:'charge',amount}}},context)
    .map(tag=>tag.text).join(' '),new RegExp(change));
  assert.equal(effects.resource.amount,amount);
}
const tags = display.programToTags({
  spec: 'mwg.effect/v1',
  steps: [
    {
      op: 'damage',
      target: 'opponent',
      amount: {
        op: 'multiply',
        left: { op: 'var', path: 'opponent.status.death_mark.stacks' },
        right: 10,
      },
    },
    { op: 'apply_status', target: 'opponent', status: 'death_mark', stacks: 2 },
    { op: 'set_stat', target: 'self', stat: 'energy', value: 3 },
    { op: 'recover_cards', source: 'discard', pick: 'choose', amount: 1 },
    { op: 'modify', target: 'self', stat: 'damage_taken', operator: 'multiply', value: 0.5 },
  ],
});

assert.deepEqual(
  tags.map(entry => entry.text),
  [
    '对敌方造成(敌方死印层数 × 10)点伤害',
    '为敌方赋予2层死印',
    '将自身能量设为3',
    '从弃牌堆取回1张牌',
    '自身受到的伤害×0.5',
  ],
);

const multiHitTags = compactContentToDisplayTags({ effects: { damage: 4, hits: 3 } });
assert.deepEqual(multiHitTags.map(entry => entry.text), ['对敌方造成4点伤害 ×3']);
assert.deepEqual(
  compactContentToDisplayTags({ effects: { persistent_growth: 'max_hp', add: 3 } }).map(entry => entry.text),
  ['永久生命上限增加3'],
  'explicit permanent growth has a Chinese rule tag instead of an unknown-effect fallback',
);
assert.doesNotMatch(tags.map(entry => entry.text).join(' '), /death_mark|opponent\.status|damage_taken|discard/);

const structuredTags = compactContentToDisplayTags(
  {
    type: 'Power',
    effects: { block: 4 },
    trigger: { on: 'deal_damage', effects: { apply_status: 'death_mark', stacks: 1, to: 'opponent' } },
  },
  { statusNames: { death_mark: '死印' } },
);
assert.deepEqual(
  structuredTags.map(entry => entry.text),
  ['自身获得4点格挡', '造成伤害时：为敌方赋予1层死印'],
);

const conditionalTags = compactContentToDisplayTags({ effects: { block: 5, when: 'self.hp < self.max_hp / 2' } });
assert.deepEqual(conditionalTags.map(entry => entry.text), ['当自身生命低于自身最大生命的一半时，自身获得5点格挡']);
assert.deepEqual(
  compactContentToDisplayTags({ effects: { damage: 'opponent.lust >= 8 ? 11 : 7' } }).map(entry => entry.text),
  ['对敌方造成7点伤害；如果敌方欲望不低于8，则造成11点伤害'],
  'compiled ternary damage keeps its baseline and branch condition in one readable tag',
);
assert.deepEqual(
  compactContentToDisplayTags({ effects: { block: 'min(opponent.lust, 9)' } }).map(entry => entry.text),
  ['自身获得等同于敌方欲望的格挡，最多9点'],
  'compiled min expressions keep their cap without exposing function syntax',
);

const discardTags = compactContentToDisplayTags({
  type: 'Skill',
  effects: { block: 1 },
  discard_effects: { block: 5 },
});
assert.deepEqual(
  discardTags.map(entry => entry.text),
  ['自身获得1点格挡', '此牌被战斗效果弃掉后：自身获得5点格挡'],
);

const filteredRuleTags = compactContentToDisplayTags({
  trigger: 'passive',
  effects: [
    { card_rule: 'replay', limit: 2, extra: 1, card_type: 'Attack' },
    { card_rule: 'free', limit: 1, rarity: 'Rare' },
  ],
});
assert.deepEqual(filteredRuleTags.map(entry => entry.text), [
  '被动效果：每回合前2张符合“攻击牌”的牌额外结算1次',
  '被动效果：每回合前1张符合“稀有”的牌不消耗任何资源',
]);

const summonTags = compactContentToDisplayTags({
  effects: {
    spawn_summon: {
      id: 'detail_guard', name: '细节护卫', emoji: '⚙️', max_hp: 12, block: 3,
      actions_per_activation: 2,
      actions: [{ id: 'strike', name: '冲撞', weight: 2, effects: { damage: 4 } }],
      abilities: [{
        id: 'guard_start', name: '启动护盾',
        trigger: { on: 'turn_start', effects: { summoner_effects: { block: 2 } } },
      }],
      resources: { charge: { name: '充能', emoji: '⚡', max: 4, current: 2, refresh: 'retain' } },
      modifiers: { damage_modifier: 1 },
      intercept: { mode: 'unblocked_attack', priority: 2, max_per_turn: 1 },
      slot: 'guardian', on_existing: 'reinforce', on_defeated: 'revive_reset',
      count: 1, capacity: 3, overflow: 'replace_oldest',
    },
  },
});
const summonText = summonTags.map(entry => entry.text).join('\n');
for (const expected of [
  '12点生命', '初始3点格挡', '每次激活行动2次', '召唤容量3', '满员时替换最早的召唤物',
  '行动「冲撞」', '对敌方造成4点伤害', '能力「启动护盾」·回合开始', '召唤者获得2点格挡',
  '资源：充能2/4（保留）', '造成伤害+1', '每回合至多1次', '同一召唤者的唯一召唤物', '当前生命和生命上限各增加12',
  '倒下后再次召唤：复活至12/12',
]) assert.match(summonText, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const upgradeTags = compactContentToDisplayTags({
  effects: {
    upgrade_card: 1, from: 'hand', pick: 'choose', scope: 'run', levels: 2, max_level: 5,
    changes: [
      { kind: 'numeric', stat: 'damage', operator: 'add', value: 3 },
      { kind: 'keyword', keyword: 'retain', enabled: true },
    ],
  },
});
const upgradeText = upgradeTags.map(entry => entry.text).join('\n');
for (const expected of ['本局游戏', '伤害增加3', '获得“保留”']) assert.match(upgradeText, new RegExp(expected));

const choiceTags = compactContentToDisplayTags({
  effects: {
    choose: 'display_choice',
    options: [
      { id: 'strike', label: '进攻', effects: { damage: 7 } },
      { id: 'guard', label: '防守', effects: { block: 6 } },
    ],
  },
});
const choiceText = choiceTags.map(entry => entry.text).join('\n');
assert.deepEqual(choiceTags.map(entry => entry.text), [
  '选择一项：\n“进攻”：对敌方造成7点伤害\n“防守”：自身获得6点格挡',
]);
for (const expected of ['“进攻”：对敌方造成7点伤害', '“防守”：自身获得6点格挡']) assert.match(choiceText, new RegExp(expected));

const summonSelectorText = compactContentToDisplayTags({
  effects: { modify_summon: { selector: { owner: 'self', pick: 'right', template_id: 'persona_doll' }, stat: 'block', add: 4 } },
}, { summonNames: { persona_doll: '心象人偶' } }).map(entry => entry.text).join('\n');
assert.match(summonSelectorText, /我方最新的类型为“心象人偶”的召唤物的格挡增加4/);
const preciseSummonTags = compactContentToDisplayTags({
  effects: { modify_summon_effect: { selector: { owner: 'self', pick: 'last', count: 2, template_id: 'persona_doll', slot: 'core', tags: ['guardian'] }, stat: 'damage', add: 3 } },
}, { summonNames: { persona_doll: '心象人偶' } });
assert.equal(preciseSummonTags[0].text, '为我方最新的2个类型为“心象人偶”且位于“core”唯一槽且同时带有“guardian”标签的召唤物，赋予伤害增加3（本场战斗）');
assert.equal(preciseSummonTags[0].reference?.name, '心象人偶', 'a template-filtered summon modifier carries an accessible summon reference');
assert.ok(preciseSummonTags[0].reference?.summon, 'the summon reference opens the summon detail channel rather than a plain status label');
const instanceSummonTags = compactContentToDisplayTags({
  effects: { damage_summon: { selector: { owner: 'opponent', pick: 'by_id', id: 'enemy_unit_1' }, amount: 3 } },
});
assert.equal(instanceSummonTags[0].text, '对敌方实例“enemy_unit_1”的召唤物造成3点伤害');

const filteredAbilityTags = compactContentToDisplayTags({
  type: 'Power',
  trigger: {
    on: 'turn_start', scope: 'combat', ordinal: 'first', event: 'turn_started',
    effects: { block: 4 },
  },
});
assert.match(filteredAbilityTags.map(entry => entry.text).join('\n'), /回合开始时（本场战斗首次）/);

const reinforcementTags = compactContentToDisplayTags({
  effects: {
    spawn_enemy: {
      id: 'display_reinforcement', name: '增援守卫', emoji: '🛡️', hp: 18, max_hp: 20,
      lust: 0, max_lust: 100, block: 3,
      actions: [{ id: 'shield_hit', name: '盾击', effects: { damage: 5 } }],
      abilities: [{
        id: 'opening_guard', name: '列阵',
        trigger: { on: 'turn_start', scope: 'combat', ordinal: 'first', event: 'turn_started', effects: { block: 4 } },
      }],
      status_effects: [{ id: 'focus', stacks: 2 }],
      lust_effect: { name: '压迫', effects: { damage: 6 } },
      action_mode: 'random', action_config: {},
      resources: [{ id: 'charge', name: '蓄力', emoji: '⚡', current: 1, max: 3, refresh: 'retain' }],
      stance: { id: 'guarding', name: '守势' },
      orb_slots: 1,
      orbs: [{ id: 'spark', name: '火花', value: 2 }],
    },
  },
}, { statusNames: { focus: '专注' } });
const reinforcementText = reinforcementTags.map(entry => entry.text).join('\n');
for (const expected of [
  '18/20生命', '3格挡', '行动“盾击”', '造成5点伤害', '能力“列阵”', '首次', '获得4点格挡',
  '初始状态：专注×2', '欲望满溢“压迫”', '造成6点伤害', '资源：蓄力 1/3', '初始姿态：守势', '初始姿态槽：火花',
]) assert.match(reinforcementText, new RegExp(expected));
assert.doesNotMatch(reinforcementText, /\bOrb\b/, 'effect display uses the player-facing stance terminology');

const coreSource = readFileSync(resolve('src/game-core/effectDisplay.ts'), 'utf8');
const battleAdapterSource = readFileSync(resolve('src/fish/ui/effectProgramDisplay.ts'), 'utf8');
const commonPageSource = readFileSync(resolve('src/common/index.ts'), 'utf8');

assert.match(coreSource, /function nodeTags\(/);
assert.match(coreSource, /switch \(node\.op\)/);
assert.match(battleAdapterSource, /effectProgramToDisplayTags/);
assert.doesNotMatch(battleAdapterSource, /switch \(node\.op\)/);
assert.match(commonPageSource, /compactContentToDisplayTags/);
assert.ok(commonPageSource.includes('rulesHtml: contentRulesHtml(card)'), 'collection cards use the shared rule renderer');
assert.ok(commonPageSource.includes('renderRulePills(presentation.rulesGroups'), 'content rules use structured pills');
assert.doesNotMatch(commonPageSource, /简化显示，不显示详细效果/);
assert.doesNotMatch(commonPageSource, /switch \(node\.op\)/);

console.log('Effect tags use one shared core for battle and common/reward pages.');

const defaultGuard = { id: 'default_guard', name: '默认守卫', emoji: 'G', max_hp: 8 };
const guardDisplay = summon => compactContentToDisplayTags({ effects: { spawn_summon: summon } }).map(tag => tag.text).join('；');
assert.match(guardDisplay(defaultGuard), /先计召唤者易伤，再计承伤者减伤与格挡/, 'default interception is visible even without an explicit intercept field');
assert.match(guardDisplay(JSON.parse(JSON.stringify(defaultGuard))), /先计召唤者易伤/);
assert.doesNotMatch(guardDisplay({ ...defaultGuard, capabilities: { intercepts: false } }), /援护攻击/);
assert.doesNotMatch(guardDisplay({ ...defaultGuard, has_hp: false }), /援护攻击/);
