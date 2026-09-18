import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const adapter = require(resolve('src/fish/core/battleContentAdapter.ts'));
const core = require(resolve('src/game-core/index.ts'));
const rules = (card, field = 'effectProgram') => core.effectProgramToDisplayTags(card[field], {
  statusNames: { death_mark:'死印', focus:'专注' },
}).map(tag=>tag.text).join('；');
const { TavernEffectCommandHost } = require(resolve('src/fish/core/effectCommandHost.ts'));

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
assert.deepEqual(strike.effectProgram.steps, [{ op: 'damage', target: 'opponent', amount: 6, hitGroup: '$:damage' }]);

const inertCurse = adapter.normalizeCardDefinition({
  id: 'sealed_fragment',
  name: '封印残片',
  type: 'Curse',
  rarity: 'Corrupt',
  quantity: 1,
  description: '无法被打出，只会占据手牌位置。',
});
assert.ok(inertCurse);
assert.deepEqual(inertCurse.effectProgram, { spec: 'mwg.effect/v1', steps: [] });
assert.equal(inertCurse.cost, undefined);
assert.equal(adapter.normalizeCardDefinition({
  id: 'false_story_curse', name: '伪叙事诅咒', type: 'Curse', rarity: 'Corrupt', quantity: 1,
  effects: { narrate: '非法叙事占位。' },
}), null, 'an explicit invalid Curse effect cannot fall back to the inert program');

const power = adapter.normalizeCardDefinition({
  id: 'power',
  name: '能力',
  type: 'Power',
  trigger: 'turn_start',
  effects: [{ block: 2 }, { draw: 1 }],
});
assert.equal(power.exhaust, true);
assert.equal(power.effectProgram.steps[0].op, 'register_trigger');
assert.equal(power.description, '', 'rules are rendered from the live program, not stored as prose');
assert.match(rules(power), /回合开始.*2点格挡.*抽1张牌/);

const passivePower = adapter.normalizeCardDefinition({
  id: 'echo_form',
  name: '回响形态',
  type: 'Power',
  rarity: 'Rare',
  cost: 2,
  quantity: 1,
  trigger: { on: 'passive', effects: { card_rule: 'replay', limit: 1, extra: 1 } },
});
assert.ok(passivePower);
assert.equal(passivePower.exhaust, true);
assert.equal(passivePower.effectProgram.steps[0].op, 'register_trigger');
assert.equal(passivePower.effectProgram.steps[0].trigger, 'passive');
assert.equal(passivePower.effectProgram.steps[0].effects[0].op, 'card_play_rule');
const powerWithEmptyOptionalRoot = adapter.normalizeCardDefinition({
  id: 'empty_root_power',
  name: '空根能力',
  type: 'Power',
  rarity: 'Uncommon',
  cost: 1,
  quantity: 1,
  effects: [],
  trigger: { on: 'turn_start', effects: { block: 2 } },
});
assert.ok(powerWithEmptyOptionalRoot);
assert.equal(powerWithEmptyOptionalRoot.effectProgram.steps[0].trigger, 'turn_start');
const redundantOverflowGuard = adapter.normalizeNamedEffectDefinition({
  name: '满溢反击',
  effects: { damage: 5 },
  when: 'lust >= max_lust',
});
assert.ok(redundantOverflowGuard);
assert.equal(redundantOverflowGuard.effectProgram.steps[0].op, 'damage');
let registeredPassive = null;
const passiveCoreState = {
  self: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  opponent: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
  currentTurn: 1, cardsPlayedThisTurn: 0, attacksPlayedThisTurn: 0, skillsPlayedThisTurn: 0,
};
const passiveHost = new TavernEffectCommandHost({
  readState: () => passiveCoreState,
  isTerminal: () => false,
  executeCardCommand: async () => {}, presentCommand: () => {}, executeBattleCommand: async () => {},
  executeSpecialCommand: async () => {}, executeSummonCommand: async () => {}, executeEnemyCommand: async () => {},
  executeSummonerProgram: async () => {}, forEachEnemyTarget: async () => {}, applyStatus: async () => {},
  removeStatuses: async () => {}, scheduleEffect: async () => {}, setCardDestination: async () => {}, narrate: async () => {},
  registerAbility: async (_target, definition) => { registeredPassive = definition; },
});
await passiveHost.executeProgram(passivePower.effectProgram, true);
assert.equal(registeredPassive.trigger, 'passive');
const passiveRules = core.resolvePassiveCardPlayRules(
  [{ id: 'echo_form_power', name: '回响形态', ...registeredPassive }],
  'player',
  'player',
  passiveCoreState,
).map(entry => entry.rule);
assert.equal(core.resolveActiveCardPlayRules(passiveRules, 0).extraReplays, 1);

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
assert.equal(structuredPower.description, '');
assert.match(rules(structuredPower), /4点格挡.*造成伤害.*1层/);

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
assert.equal(duplicated.description, '造成6点伤害。', 'authored prose is preserved separately from executable rules');
assert.match(rules(duplicated), /6点伤害/);

const formulaCard = adapter.normalizeCardDefinition(
  {
    id: 'formula',
    name: '终结技',
    type: 'Attack',
    effects: { damage: 'opponent.status.death_mark.stacks * 10' },
  },
  { statusNames: { death_mark: '死印' } },
);
assert.equal(formulaCard.description, '');
assert.match(rules(formulaCard), /死印层数.*10/);

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
assert.equal(unsafeAuthoredFormula.description, '');
assert.match(rules(unsafeAuthoredFormula), /死印层数.*10/);

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
  '',
  'discard rules remain in the separately rendered discard program',
);
assert.match(rules(discardCard, 'discardEffectProgram'), /抽1张牌.*1层专注/);

const authoredConditionalCard = adapter.normalizeCardDefinition({
  id: 'authored_conditional',
  name: '条件牌',
  type: 'Skill',
  description: '护盾只会在真正需要的瞬间亮起。',
  effects: { block: 5, when: 'self.hp < self.max_hp / 2' },
});
assert.equal(
  authoredConditionalCard.description,
  '护盾只会在真正需要的瞬间亮起。',
  'creative prose never becomes a cached mechanical sentence',
);
assert.match(rules(authoredConditionalCard), /生命.*最大生命.*5点格挡/);

const conditionalDesire = adapter.normalizeNamedEffectDefinition({
  name: '临界回响',
  when: 'self.hp < self.max_hp / 2',
  effects: { damage: 4 },
});
assert.equal(conditionalDesire.effectProgram.steps[0].op, 'if');
assert.equal(conditionalDesire.description, '');
assert.match(rules(conditionalDesire), /生命.*最大生命.*4点伤害/);

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

const action = adapter.normalizeEnemyAction({ id: 'enemy_strike', name: '攻击', emoji: '⚔️', weight: 2, effects: { damage: 4 } });
assert.equal(action.id, 'enemy_strike');
assert.equal(action.emoji, '⚔️');
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

const inertCurseAction = adapter.normalizeEnemyAction({
  name: '封印牌库',
  weight: 1,
  effects: { add_card: 'sealed_enemy_curse', to: 'deck' },
  creates: [{
    id: 'sealed_enemy_curse', name: '沉默封印', type: 'Curse', rarity: 'Corrupt',
    description: '无法被打出，只会占据手牌位置。',
  }],
});
assert.ok(inertCurseAction);
assert.deepEqual(inertCurseAction.effectProgram.steps[0].card.program.steps, []);

assert.deepEqual(adapter.normalizeNamedEffectDefinition({ name: '反击', emoji: '💥', effects: { damage: 5 } }), {
  name: '反击',
  emoji: '💥',
  description: '',
  effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 5, hitGroup: '$:damage' }] },
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
