import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const adapter = require(resolve('src/fish/core/battleContentAdapter.ts'));

const strike = adapter.normalizeCardDefinition({
  id: 'strike',
  name: '打击',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  quantity: 2,
  effects: { damage: 6 },
});
assert.equal(strike.quantity, 2);
assert.equal(strike.description, '');
assert.deepEqual(strike.effectProgram.steps, [{ op: 'damage', target: 'opponent', amount: 6 }]);

const power = adapter.normalizeCardDefinition({
  id: 'power',
  name: '能力',
  type: 'Power',
  trigger: 'turn_start',
  effects: [{ block: 2 }, { draw: 1 }],
});
assert.equal(power.exhaust, true);
assert.equal(power.effectProgram.steps[0].op, 'register_trigger');
assert.equal(power.description, '回合开始时，获得2点格挡；抽1张牌。');

const structuredPower = adapter.normalizeCardDefinition({
  id: 'structured_power',
  name: '持续能力',
  type: 'Power',
  rarity: 'Uncommon',
  cost: 1,
  quantity: 1,
  effects: { block: 4 },
  trigger: { on: 'deal_damage', effects: { apply_status: 'mark', stacks: 1, to: 'opponent' } },
});
assert.deepEqual(structuredPower.effectProgram.steps.map(step => step.op), ['gain_block', 'register_trigger']);
assert.equal(structuredPower.description, '获得4点格挡；造成伤害时，向敌方施加1层未注册状态。');

const authored = adapter.normalizeCardDefinition({
  id: 'authored',
  name: '风格牌',
  type: 'Attack',
  description: '迅疾的连续攻势，在目标身上留下难以摆脱的战斗痕迹。',
  effects: { damage: 6 },
});
assert.equal(authored.description, '迅疾的连续攻势，在目标身上留下难以摆脱的战斗痕迹。');

const duplicated = adapter.normalizeCardDefinition({
  id: 'duplicated',
  name: '重复规则牌',
  type: 'Attack',
  description: '造成6点伤害。',
  effects: { damage: 6 },
});
assert.equal(duplicated.description, '', 'simple numeric prose must not duplicate the authoritative effect tag');

const formulaCard = adapter.normalizeCardDefinition(
  {
    id: 'formula',
    name: '终结技',
    type: 'Attack',
    effects: { damage: 'opponent.status.death_mark.stacks * 10' },
  },
  { statusNames: { death_mark: '死印' } },
);
assert.equal(formulaCard.description, '对敌方造成敌方死印层数 * 10点伤害。');

const unsafeAuthoredFormula = adapter.normalizeCardDefinition(
  {
    id: 'unsafe_formula',
    name: '内部字段泄露',
    type: 'Attack',
    description: '造成 opponent.status.death_mark.stacks * 10 点伤害。',
    effects: { damage: 'opponent.status.death_mark.stacks * 10' },
  },
  { statusNames: { death_mark: '死印' } },
);
assert.equal(unsafeAuthoredFormula.description, '对敌方造成敌方死印层数 * 10点伤害。');

const discardCard = adapter.normalizeCardDefinition(
  {
    id: 'discard_payoff',
    name: '余响',
    type: 'Skill',
    effects: { block: 1 },
    discard_effects: [{ draw: 1 }, { apply_status: 'focus', to: 'self' }],
  },
  { statusNames: { focus: '专注' } },
);
assert.deepEqual(discardCard.discardEffectProgram.steps.map(step => step.op), ['draw_cards', 'apply_status']);
assert.equal(
  discardCard.description,
  '此牌被战斗效果弃掉后，抽1张牌；向自身施加1层专注。',
  'runtime card description keeps the discard condition and exact result',
);

const authoredConditionalCard = adapter.normalizeCardDefinition({
  id: 'authored_conditional',
  name: '条件牌',
  type: 'Skill',
  description: '护盾只会在真正需要的瞬间亮起。',
  effects: { block: 5, when: 'self.hp < self.max_hp / 2' },
});
assert.equal(
  authoredConditionalCard.description,
  '护盾只会在真正需要的瞬间亮起。当自身生命低于自身最大生命的一半时，获得5点格挡。',
  'creative prose is preserved while executable conditions are appended authoritatively',
);

const generated = adapter.normalizeCardDefinition({
  id: 'forge',
  name: '锻造',
  effects: { add_card: 'spark', count: 2 },
  creates: [{ id: 'spark', name: '火花', type: 'Attack', cost: 0, effects: { damage: 3 }, exhaust: true }],
});
assert.equal(generated.effectProgram.steps[0].card.id, 'spark');

for (const removed of [
  { id: 'old', name: '旧字段', effect: 'OP.hp - 6', type: 'Attack' },
  { id: 'ast', name: '内部字段', effect_program: { spec: 'mwg.effect/v1', steps: [] } },
  { id: 'discard', name: '旧弃牌', effects: { block: 1 }, discard_effect: 'draw + 1' },
  { id: 'payment', name: '旧弃牌费用', effects: { damage: 4 }, discard_requirement: 1 },
]) assert.equal(adapter.normalizeCardDefinition(removed), null);

const relic = adapter.normalizeRelicDefinition({
  id: 'guard_stone',
  name: '守护石',
  rarity: 'Common',
  trigger: 'battle_start',
  effects: { block: 2 },
});
assert.equal(relic.trigger, 'battle_start');
assert.equal(relic.effectProgram.steps[0].op, 'gain_block');

const structuredRelic = adapter.normalizeRelicDefinition({
  id: 'structured_relic',
  name: '结构化遗物',
  rarity: 'Common',
  trigger: { on: 'passive', effects: { modify: 'block', add: 1 } },
});
assert.equal(structuredRelic.trigger, 'passive');
assert.equal(structuredRelic.effectProgram.steps[0].op, 'modify');

const item = adapter.normalizeItemDefinition({ id: 'tonic', name: '药剂', count: 2, effects: { heal: 5 } });
assert.equal(item.count, 2);
assert.equal(item.effectProgram.steps[0].op, 'heal');

const ability = adapter.normalizeAbilityDefinition({
  id: 'focus',
  name: '专注',
  trigger: 'passive',
  effects: { modify: 'damage', add: 2 },
});
assert.equal(ability.effectProgram.steps[0].op, 'modify');
assert.equal(ability.source, '剧情获得');

const sourcedAbility = adapter.normalizeAbilityDefinition({
  id: 'oath_guard',
  name: '誓约守护',
  source: '遗物「旧誓徽章」',
  trigger: 'turn_start',
  effects: { block: 2 },
});
assert.equal(sourcedAbility.source, '遗物「旧誓徽章」');

const action = adapter.normalizeEnemyAction({ name: '攻击', weight: 2, effects: { damage: 4 } });
assert.equal(action.weight, 2);
assert.equal(action.description, '');

const insertingAction = adapter.normalizeEnemyAction({
  name: '侵蚀牌库',
  weight: 1,
  effects: { add_card: 'enemy_curse', to: 'deck' },
  creates: [
    {
      id: 'enemy_curse',
      name: '侵蚀残片',
      emoji: '🕸️',
      type: 'Curse',
      rarity: 'Corrupt',
      effects: { damage: 3, to: 'self' },
      ethereal: true,
    },
  ],
});
assert.equal(insertingAction.effectProgram.steps[0].op, 'add_card');
assert.equal(insertingAction.effectProgram.steps[0].zone, 'draw');
assert.equal(insertingAction.effectProgram.steps[0].card.type, 'Curse');

assert.deepEqual(adapter.normalizeNamedEffectDefinition({ name: '反击', effects: { damage: 5 } }), {
  name: '反击',
  description: '',
  effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 5 }] },
});

assert.deepEqual(
  adapter.normalizeNamedEffectDefinition(
    { apply_status: 'mark_of_execution', stacks: 5, to: 'opponent' },
    { fallbackName: '欲望满溢' },
  ),
  {
    name: '欲望满溢',
    description: '',
    effectProgram: {
      spec: 'mwg.effect/v1',
      steps: [{ op: 'apply_status', target: 'opponent', status: 'mark_of_execution', stacks: 5 }],
    },
  },
);

assert.deepEqual(
  adapter.normalizeActiveStatus(
    { id: 'guard', stacks: 2, type: 'buff' },
    { statusNames: { guard: '守护' }, statusDescriptions: { guard: '持续生效。' } },
  ),
  { id: 'guard', name: '守护', emoji: '✨', description: '持续生效。', type: 'buff', stacks: 2 },
);

console.log('Modern battle content adapter passed.');
