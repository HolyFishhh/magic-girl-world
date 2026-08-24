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
assert.equal(strike.description, '造成6点伤害。');
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

const discardCard = adapter.normalizeCardDefinition({
  id: 'discard_payoff',
  name: '余响',
  type: 'Skill',
  effects: { block: 1 },
  discard_effects: [{ draw: 1 }, { apply_status: 'focus', to: 'self' }],
});
assert.deepEqual(discardCard.discardEffectProgram.steps.map(step => step.op), ['draw_cards', 'apply_status']);

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

const action = adapter.normalizeEnemyAction({ name: '攻击', weight: 2, effects: { damage: 4 } });
assert.equal(action.weight, 2);
assert.equal(action.description, '造成4点伤害。');

assert.deepEqual(adapter.normalizeNamedEffectDefinition({ name: '反击', effects: { damage: 5 } }), {
  name: '反击',
  description: '造成5点伤害。',
  effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 5 }] },
});

assert.deepEqual(
  adapter.normalizeActiveStatus(
    { id: 'guard', stacks: 2, type: 'buff' },
    { statusNames: { guard: '守护' }, statusDescriptions: { guard: '持续生效。' } },
  ),
  { id: 'guard', name: '守护', emoji: '✨', description: '持续生效。', type: 'buff', stacks: 2 },
);

console.log('Modern battle content adapter passed.');
