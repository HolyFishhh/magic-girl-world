import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const state = {
  self: { hp: 20, maxHp: 30, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0, statusStacks: {} },
  opponent: { hp: 30, maxHp: 30, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0, statusStacks: {} },
  currentTurn: 2,
  cardsPlayedThisTurn: 1,
  attacksPlayedThisTurn: 1,
  skillsPlayedThisTurn: 0,
};
const card = { id: 'skill__1', templateId: 'skill', type: 'Skill', rarity: 'Common', cost: 3, origin: 'deck' };
const rules = [
  { id: 'a', source: { kind: 'status', id: 'focus' }, timing: 'on_play', scope: 'turn', operator: 'subtract', value: 1, filter: { types: ['Skill'] }, priority: 0 },
  { id: 'b', source: { kind: 'relic', id: 'floor' }, timing: 'on_play', scope: 'combat', operator: 'multiply', value: 0.5, minimum: 1, priority: 1 },
];
assert.equal(core.resolveDynamicCardCost(card, rules, { state, effect: { spentEnergy: 0 }, timing: 'on_play' }), 1);
assert.equal(core.resolveDynamicCardCost(card, rules, { state, effect: { spentEnergy: 0 }, timing: 'on_play' }), 1, 'recalculation must not accumulate');
assert.equal(core.resolveDynamicCardCost({ ...card, cost: 'energy' }, rules, { state, effect: { spentEnergy: 0 }, timing: 'on_play' }), 'energy');
assert.throws(() => core.resolveDynamicCardCost(card, [{ ...rules[0], operator: 'divide', value: 0 }], { state, effect: { spentEnergy: 0 }, timing: 'on_play' }), /divide by zero/);

const playState = {
  phase: 'player_turn',
  hasOpponent: true,
  hand: [{ ...card, name: '技能', effectProgram: {}, replayCount: 0 }],
  energy: 1,
  cardsPlayedThisTurn: 1,
  dynamicCostRules: rules,
  dynamicCostState: state,
  dynamicCostContext: { spentEnergy: 0 },
};
const prepared = core.prepareCardPlay('skill__1', playState);
assert.equal(prepared.ok, true);
assert.equal(prepared.card.cost, 1);
assert.equal(prepared.payment.spentEnergy, 1);
const committed = core.commitCardPlay(prepared, playState);
assert.equal(committed.ok, true);
assert.equal(committed.energy, 0);

const lifecycleCard = {
  ...card,
  effectProgram: { spec: 'mwg.effect/v1', steps: [] },
  patches: [
    {
      id: 'enchantment:draw_shift:0:1', source: { kind: 'enchantment', id: 'draw_shift' }, scope: 'permanent',
      createdTurn: 0, priority: 0, removeOn: 'manual', kind: 'dynamic_cost', timing: 'on_draw',
      operator: 'subtract', value: { op: 'var', path: 'battle.turn_number' }, minimum: 1,
    },
    {
      id: 'status:hand_shift:2:1', source: { kind: 'status', id: 'hand_shift' }, scope: 'combat',
      createdTurn: 2, priority: 1, removeOn: 'combat_end', kind: 'dynamic_cost', timing: 'while_in_hand',
      operator: 'add', value: { op: 'var', path: 'self.status.tax.stacks' }, maximum: 4,
    },
  ],
};
const drawState = structuredClone(state);
drawState.currentTurn = 2;
drawState.self.statusStacks.tax = 2;
const drawnCard = core.snapshotDynamicCardCostOnDraw(lifecycleCard, [], {
  state: drawState, effect: { spentEnergy: 0 },
});
assert.equal(drawnCard.drawCostOverride, 1, 'draw-time value freezes once');
drawState.currentTurn = 4;
drawState.self.statusStacks.tax = 1;
assert.equal(core.resolveDynamicCardCostAtPlay(drawnCard, [], {
  state: drawState, effect: { spentEnergy: 0 },
}), 2, 'hand rules remain live while frozen draw cost does not recalculate');
assert.equal(core.resolveDynamicCardCostAtPlay(drawnCard, [], {
  state: drawState, effect: { spentEnergy: 0 },
}), 2, 'repeated reads never accumulate');
const cleared = core.clearDynamicCardCostAfterPlay(drawnCard);
assert.equal('drawCostOverride' in cleared, false);

const xCard = core.materializeCardPatches(core.appendCardPatch({
  ...lifecycleCard, id: 'x__1', cost: 'energy', patches: [],
}, {
  id: 'enchantment:x:0:1', source: { kind: 'enchantment', id: 'x' }, scope: 'permanent', createdTurn: 0,
  priority: 0, removeOn: 'manual', kind: 'x_value', operator: 'add', value: 2,
}));
assert.deepEqual(core.resolveCardEnergyPayment(xCard, 3), { requiredEnergy: 0, spentEnergy: 3, xValue: 5 });

console.log('Dynamic card costs recalculate by timing, filter, priority, bounds, X-cost semantics, and atomic payment.');
