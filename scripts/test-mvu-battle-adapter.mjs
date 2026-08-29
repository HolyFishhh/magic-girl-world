import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const adapter = require(resolve('src/fish/core/mvuBattleAdapter.ts'));

const cards = adapter.convertMvuCards([
  { id: 'strike', name: '打击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 2, effects: { damage: 8 } },
  { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { block: 6 } },
]);
assert.equal(cards.length, 3);
assert.equal(new Set(cards.map(card => card.id)).size, 3);
assert.equal(cards[0].originalId, 'strike');
assert.equal(cards[0].effectProgram.steps[0].op, 'damage');

assert.equal(adapter.convertMvuCards([{ id: 'old', name: '旧牌', effect: 'OP.hp - 8' }]).length, 0);
assert.equal(adapter.convertMvuAbilities([{ id: 'old', effect: 'turn_end(ME.hp + 1)' }]).length, 0);

const enemy = adapter.convertMvuEnemy(
  {
    name: '训练傀儡',
    emoji: '🎯',
    max_hp: 30,
    hp: 30,
    max_lust: 100,
    lust: 0,
    actions: [
      { name: '轻击', weight: 1, effects: { damage: 4 } },
      { name: '重击', weight: 3, effects: { damage: 10 } },
    ],
    action_mode: 'sequence',
    action_config: { sequence: ['重击', '轻击'] },
    abilities: [{ id: 'guarded', name: '防守', trigger: 'turn_start', effects: { block: 2 } }],
    status_effects: [],
    lust_effect: { name: '反噬', effects: { damage: 2 } },
    stance: { id: 'guard_mode', name: '守势', enter: { block: 2 }, passive: { modify: 'block', add: 1 } },
    orb_slots: 2,
    orbs: [
      { id: 'ember', name: '余烬', value: 3, passive: { block: 'orb_value' }, evoke: { damage: 'orb_value' } },
    ],
  },
  () => 0,
);
assert.equal(enemy.nextAction.name, '重击');
assert.equal(enemy.intent.type, 'attack');
assert.equal(enemy.actions[0].effectProgram.steps[0].op, 'damage');
assert.equal(enemy.abilities[0].effectProgram.steps[0].op, 'gain_block');
assert.equal(enemy.lustEffect.effectProgram.steps[0].op, 'damage');
assert.equal(enemy.stance.id, 'guard_mode');
assert.equal(enemy.stance.enterEffects[0].op, 'gain_block');
assert.equal(enemy.orbs.slots, 2);
assert.equal(enemy.orbs.orbs[0].id, 'ember');
assert.deepEqual(enemy.orbs.orbs[0].passiveEffects[0].amount, { op: 'var', path: 'context.orb_value' });

assert.equal(adapter.convertMvuStance({ id: 'bad-id', name: '错误' }), null);
assert.equal(adapter.convertMvuOrbContainer(1, [{ id: 'bad-id', name: '错误', value: 1 }]).orbs.length, 0);
assert.equal(adapter.convertMvuOrbContainer(1, [
  { id: 'a', name: '甲', value: 1 },
  { id: 'b', name: '乙', value: 2 },
]).orbs.length, 1, 'initial Orb state is bounded by authored slots');

const display = adapter.buildMvuStatusDisplayContext([
  { id: 'focus', name: '专注', emoji: '✨', type: 'buff', triggers: { hold: { modify: 'damage', add: 1 } } },
]);
assert.equal(display.statusNames.focus, '专注');
assert.match(display.statusDescriptions.focus, /伤害/);

const keyedDisplay = adapter.buildMvuStatusDisplayContext({
  combo_flow: {
    name: '连击心流',
    emoji: 'F',
    type: 'buff',
    stacks_change: 'keep',
    triggers: { apply: { effects: { block: 1 } } },
  },
});
assert.equal(keyedDisplay.statusNames.combo_flow, '连击心流');
assert.match(keyedDisplay.statusDescriptions.combo_flow, /格挡/);

const conditionedAbility = adapter.convertMvuAbilities([
  {
    id: 'combo_awareness',
    name: '连段意识',
    trigger: 'card_played',
    when: 'self.status.combo_flow.stacks >= 5',
    effects: { draw: 1 },
  },
]);
assert.equal(conditionedAbility[0].effectProgram.steps[0].op, 'if');

console.log('Modern MUV battle adapter passed.');
