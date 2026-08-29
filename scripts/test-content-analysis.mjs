import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const formula = core.analyzeContentDefinition({ effects: [{ damage: 'spent_energy * 4' }] });
assert.equal(core.hasContentMetric(formula, 'attack'), true, 'positive content metrics are shared by diagnostics');
assert.equal(formula.metrics.attack, 12, 'formula estimates use the same compact compiler with representative energy');
assert.equal(formula.dynamicMetrics.has('attack'), true);
assert.equal(formula.damageKnown, false, 'formula damage stays diagnostic-unknown despite its conservative estimate');

const fixedCompositeResource = core.analyzeContentDefinition(
  { cost: { energy: 1, stars: 2 }, effects: [{ damage: 'spent_resource.stars * 5 + spent_energy' }] },
  { selfResources: { stars: 4 }, selfMaxResources: { stars: 6 } },
);
assert.equal(fixedCompositeResource.metrics.attack, 11, 'composite payment formulas use every paid resource component');

const customXResource = core.analyzeContentDefinition(
  { cost: { stars: 'all' }, effects: [{ damage: 'x_resource.stars * 4' }] },
  { selfResources: { stars: 3 }, selfMaxResources: { stars: 8 } },
);
assert.equal(customXResource.metrics.attack, 12, 'custom-resource X formulas use the resolved all-cost value');

const resourceStateFormula = core.analyzeContentDefinition(
  { effects: [{ block: 'self.resource.stars.current + self.resource.stars.max + opponent.resource.rage.current' }] },
  {
    selfResources: { stars: 2 },
    selfMaxResources: { stars: 7 },
    opponentResources: { rage: 3 },
    opponentMaxResources: { rage: 5 },
  },
);
assert.equal(resourceStateFormula.metrics.defense, 12, 'detached analysis exposes registered self and opponent resource state');

const scenarioFormula = core.analyzeContentScenarioRange({
  effects: [{ damage: 'self.hp < self.max_hp / 2 ? 12 : 3' }],
});
assert.equal(scenarioFormula.expected.metrics.attack > 3, true, 'dynamic formulas use a weighted scenario estimate');
assert.equal(scenarioFormula.min.attack, 3, 'scenario sampler records the safe branch');
assert.equal(scenarioFormula.max.attack, 12, 'scenario sampler records the low-health branch');
assert.equal(scenarioFormula.damageMin, 3);
assert.equal(scenarioFormula.damageMax, 12);

const fixedScenario = core.analyzeContentScenarioRange({ effects: [{ block: 4 }] });
assert.equal(core.hasContentMetric(fixedScenario.expected, 'defense'), true);
assert.deepEqual(fixedScenario.min, fixedScenario.max, 'fixed content keeps a zero-width scenario range');

const selfCost = core.analyzeContentDefinition({ effects: [{ damage: 'spent_energy', to: 'self' }] });
assert.equal(selfCost.metrics.attack, 0, 'self-damage is not mistaken for player output');
assert.equal(selfCost.dynamicMetrics.has('attack'), false);

const bundled = core.analyzeContentDefinition({ effects: { damage: 6, block: 4, draw: 1 } });
assert.equal(bundled.metrics.attack, 6);
assert.equal(bundled.metrics.defense, 4);
assert.equal(bundled.metrics.draw, 1);

const multiHit = core.analyzeContentDefinition({ effects: { damage: 3, hits: 4 } });
assert.equal(multiHit.metrics.attack, 12, 'multi-hit damage contributes every independently resolved hit');
assert.equal(multiHit.damage, 12);

const turnCombo = core.analyzeContentDefinition(
  { effects: { damage: 'turn_number + attacks_played_this_turn * 2 + skills_played_this_turn' } },
  { currentTurn: 3, attacksPlayedThisTurn: 2, skillsPlayedThisTurn: 1 },
);
assert.equal(turnCombo.metrics.attack, 8);
assert.equal(turnCombo.dynamicMetrics.has('attack'), true);

const power = core.analyzeContentDefinition(
  {
    type: 'Power',
    trigger: 'turn_start',
    effects: [{ block: 'self.status.focus.stacks + 1' }],
  },
  { statusStacks: { focus: 2 } },
);
assert.equal(power.metrics.defense, 3);
assert.equal(power.dynamicMetrics.has('defense'), true);

const structuredPower = core.analyzeContentDefinition({
  type: 'Power',
  effects: { block: 4 },
  trigger: { on: 'deal_damage', effects: { apply_status: 'mark', stacks: 1, to: 'opponent' } },
});
assert.equal(structuredPower.metrics.defense, 4, 'structured Power keeps its immediate effect in build analysis');
assert.ok(structuredPower.tags.includes('能力'));
assert.ok(structuredPower.tags.includes('状态:mark'));

const passiveModifier = core.analyzeContentDefinition({
  trigger: 'passive',
  effects: [{ modify: 'damage', add: 2 }],
});
assert.deepEqual(passiveModifier.modifiers, [{ target: 'self', stat: 'damage', operator: 'add', value: 2 }]);

const structuredPassiveModifier = core.analyzeContentDefinition({
  trigger: { on: 'passive', effects: [{ modify: 'block', add: 1 }] },
});
assert.deepEqual(structuredPassiveModifier.modifiers, [{ target: 'self', stat: 'block', operator: 'add', value: 1 }]);

const status = core.analyzeStatusDefinition(
  {
    triggers: { tick: [{ heal: 'stacks' }], apply: [{ block: 4 }] },
  },
  { currentStatusStacks: 2 },
);
assert.equal(status.metrics.sustain, 2);
assert.equal(status.metrics.defense, 1, 'one-time apply effects use a conservative trigger weight');

const generated = core.analyzeContentDefinition({
  effects: [{ add_card: 'spark', count: 2 }],
  creates: [{ id: 'spark', name: 'Spark', effects: [{ damage: 5 }] }],
});
assert.equal(generated.metrics.attack, 3.5, 'generated cards contribute at a conservative availability weight');
assert.equal(generated.damageKnown, false, 'generated-card damage is an estimate, not immediate known action damage');

const conditional = core.analyzeContentDefinition({
  effects: [{ damage: 8, when: 'self.hp < self.max_hp / 2' }],
});
assert.equal(conditional.metrics.attack, 0, 'inactive conditions are not counted a second time by the shallow scan');
assert.equal(conditional.dynamicMetrics.has('attack'), true, 'conditional output remains visible to build guidance');
assert.equal(conditional.damageKnown, false, 'conditional damage is not reported as a fixed enemy action value');

const inlineTrigger = core.analyzeContentDefinition({ effects: [{ block: 4, on: 'on_discard' }] });
assert.equal(inlineTrigger.metrics.defense, 2, 'inline triggers use the same conservative frequency weights');

const exhaustTrigger = core.analyzeContentDefinition({ trigger: 'on_exhaust', effects: { block: 4 } });
assert.equal(exhaustTrigger.metrics.defense, 2, 'exhaust synergies share the conservative card-event weight');

assert.equal(core.analyzeContentDefinition({ trigger: 'attack_played', effects: { block: 4 } }).metrics.defense, 4);
assert.equal(core.analyzeContentDefinition({ trigger: 'skill_played', effects: { block: 4 } }).metrics.defense, 4);
assert.equal(core.analyzeContentDefinition({ trigger: 'power_played', effects: { block: 4 } }).metrics.defense, 1);
assert.equal(core.analyzeContentDefinition({ trigger: 'on_draw', effects: { block: 4 } }).metrics.defense, 3);
assert.equal(core.analyzeContentDefinition({ trigger: 'on_shuffle', effects: { energy: 2 } }).metrics.energy, 0.7);

const mixedRootTrigger = core.analyzeContentDefinition({
  trigger: 'ability_gain',
  effects: [{ block: 4 }, { draw: 1, on: 'turn_start' }],
});
assert.equal(mixedRootTrigger.metrics.defense, 1, 'default-trigger effects use the root trigger weight');
assert.equal(
  mixedRootTrigger.metrics.draw,
  1,
  'an explicit per-effect trigger keeps its own weight instead of inheriting the root weight twice',
);

const outerLifecycleTrigger = core.analyzeContentDefinition({
  trigger: 'battle_start',
  effects: [{ block: 4 }, { draw: 1, on: 'turn_start' }],
});
assert.equal(outerLifecycleTrigger.metrics.defense, 1, 'outer lifecycle effects use their lifecycle weight');
assert.equal(
  outerLifecycleTrigger.metrics.draw,
  1,
  'an outer lifecycle root does not suppress an explicitly registered nested trigger',
);

const reducedCost = core.analyzeContentDefinition({
  effects: [{ reduce_cost: 1, count: 2, pick: 'choose' }],
});
assert.equal(reducedCost.metrics.energy, 2, 'card cost reduction is measured as energy value per selected card');
const recover = core.analyzeContentDefinition({ effects: [{ recover: 2, from: 'discard', pick: 'choose' }] });
assert.equal(recover.metrics.draw, 1, 'card recovery contributes a conservative draw value');
assert.equal(recover.tags.includes('取回'), true);
const scry = core.analyzeContentDefinition({ effects: [{ scry: 4 }] });
assert.equal(scry.metrics.draw, 1, 'scry contributes conservative deck-quality value without pretending to draw');
assert.equal(scry.tags.includes('预见'), true);
const seek = core.analyzeContentDefinition({ effects: [{ seek: 1 }] });
assert.equal(seek.metrics.draw, 0.75, 'seek contributes a bounded tutor value');
assert.equal(seek.tags.includes('检索'), true);

const discardPayoff = core.analyzeContentDefinition({
  effects: [{ block: 5 }],
  discard_effects: [{ draw: 2 }],
});
assert.equal(discardPayoff.metrics.defense, 5);
assert.equal(
  discardPayoff.metrics.draw,
  1,
  'discard-only effects are weighted once and kept separate from play effects',
);

const pack = core.createContentPack({
  cards: [
    { id: 'strike', quantity: 5, effects: [{ damage: 8 }] },
    { id: 'guard', quantity: 5, effects: [{ block: 6 }] },
  ],
  relics: [{ id: 'root', trigger: 'battle_start', effects: [{ block: 4 }] }],
  abilities: [{ id: 'focus', trigger: 'turn_start', effects: [{ draw: 1 }] }],
  statuses: [{ id: 'regen', triggers: { tick: [{ heal: 'stacks' }] } }],
  activeStatuses: [{ id: 'regen', stacks: 2 }],
});
const budget = core.summarizeBuildBudget(pack, { hp: 40, maxHp: 50 });
assert.deepEqual(budget, {
  deck: 10,
  attack: 24,
  defense: 19,
  sustain: 2,
  draw: 1,
  energy: 0,
  hp: 40,
  maxHp: 50,
});
assert.equal(
  core.formatBuildBudget(budget),
  'deck=10 atk=24 def=19 heal=2 draw=1 energy=0 hp=40/50',
  'the AI-facing budget line stays flat and does not expose analysis internals',
);

const costlyHand = core.createContentPack({
  cards: [{ id: 'meteor', type: 'Attack', cost: 3, quantity: 5, effects: { damage: 8 } }],
});
assert.equal(
  core.summarizeBuildBudget(costlyHand, { hp: 80, maxHp: 80 }).attack,
  8,
  'five three-cost cards contribute only the one card payable with base energy',
);
const cheapHand = core.createContentPack({
  cards: [{ id: 'spark', type: 'Attack', cost: 1, quantity: 5, effects: { damage: 8 } }],
});
assert.equal(core.summarizeBuildBudget(cheapHand, { hp: 80, maxHp: 80 }).attack, 24);
const freeHand = core.createContentPack({
  cards: [{ id: 'flash', type: 'Attack', cost: 0, quantity: 5, effects: { damage: 8 } }],
});
assert.equal(core.summarizeBuildBudget(freeHand, { hp: 80, maxHp: 80 }).attack, 40);

const curseDilution = core.createContentPack({
  cards: [
    { id: 'strike', type: 'Attack', cost: 1, quantity: 5, effects: { damage: 8 } },
    { id: 'curse', type: 'Curse', quantity: 5, effects: { damage: 99 } },
  ],
});
assert.equal(
  core.summarizeBuildBudget(curseDilution, { hp: 80, maxHp: 80 }).attack,
  20,
  'unplayable curses dilute the hand without becoming positive output',
);

const energyEngine = core.createContentPack({
  cards: [
    { id: 'bolt', type: 'Attack', cost: 1, quantity: 8, effects: { damage: 8 } },
    { id: 'battery', type: 'Skill', cost: 0, quantity: 2, effects: { energy: 2 } },
  ],
});
const energyEngineBudget = core.summarizeBuildBudget(energyEngine, { hp: 80, maxHp: 80 });
assert.equal(energyEngineBudget.attack, 32, 'one bounded second pass lets playable energy generation fund more cards');
assert.equal(energyEngineBudget.energy, 2);

const drawEngine = core.createContentPack({
  cards: [
    { id: 'needle', type: 'Attack', cost: 0, quantity: 8, effects: { damage: 8 } },
    { id: 'insight', type: 'Skill', cost: 0, quantity: 2, effects: { draw: 2 } },
  ],
});
assert.equal(
  core.summarizeBuildBudget(drawEngine, { hp: 80, maxHp: 80 }).attack,
  45,
  'one bounded second pass values additional cards made reachable by draw',
);

const modifierPack = core.createContentPack({
  cards: [{ id: 'strike', quantity: 5, effects: [{ damage: 8 }] }],
  relics: [{ id: 'rage', trigger: 'passive', effects: [{ modify: 'damage', add: 2 }] }],
});
assert.deepEqual(
  core.summarizeBuildBudget(modifierPack, { hp: 80, maxHp: 80 }),
  { deck: 5, attack: 50, defense: 0, sustain: 0, draw: 0, energy: 0, hp: 80, maxHp: 80 },
  'passive modifiers apply to cards once and are not counted as direct damage a second time',
);

const noPhantomAttack = core.createContentPack({
  cards: [{ id: 'guard', quantity: 5, effects: [{ block: 6 }] }],
  relics: [{ id: 'rage', trigger: 'passive', effects: [{ modify: 'damage', add: 2 }] }],
});
assert.equal(
  core.summarizeBuildBudget(noPhantomAttack, { hp: 80, maxHp: 80 }).attack,
  0,
  'damage modifiers cannot create attack value on a card with no damage source',
);

const noPhantomDefense = core.createContentPack({
  cards: [{ id: 'strike', quantity: 5, effects: [{ damage: 8 }] }],
  relics: [{ id: 'guarding', trigger: 'passive', effects: [{ modify: 'block', add: 2 }] }],
});
assert.equal(
  core.summarizeBuildBudget(noPhantomDefense, { hp: 80, maxHp: 80 }).defense,
  0,
  'block modifiers cannot create defense value on a card with no block source',
);

const lustModifierPack = core.createContentPack({
  cards: [{ id: 'tempt', quantity: 10, effects: [{ lust: 10 }] }],
  relics: [{ id: 'allure', trigger: 'passive', effects: [{ modify: 'lust', multiply: 2 }] }],
});
assert.equal(
  core.summarizeBuildBudget(lustModifierPack, { hp: 80, maxHp: 80 }).attack,
  50,
  'lust modifiers apply only to desire output and are not lost inside the attack summary',
);

const desireEffectPack = core.createContentPack({
  cards: [{ id: 'guard', quantity: 10, effects: [{ block: 5 }] }],
  playerDesireEffect: { name: 'overflow', effects: [{ damage: 20 }] },
});
assert.equal(
  core.summarizeBuildBudget(desireEffectPack, { hp: 80, maxHp: 80 }).attack,
  10,
  'player desire overflow contributes a bounded support value without becoming a card-hand estimate',
);

const splitModifierPack = core.createContentPack({
  cards: [{ id: 'hybrid', quantity: 10, effects: [{ damage: 8 }, { lust: 10 }] }],
  relics: [
    { id: 'rage', trigger: 'passive', effects: [{ modify: 'damage', add: 2 }] },
    { id: 'allure', trigger: 'passive', effects: [{ modify: 'lust', multiply: 2 }] },
  ],
});
assert.equal(
  core.summarizeBuildBudget(splitModifierPack, { hp: 80, maxHp: 80 }).attack,
  100,
  'damage and desire modifiers remain independent for hybrid cards',
);

const activeStatusFormulaPack = core.createContentPack({
  cards: [{ id: 'focus_burst', quantity: 10, effects: [{ damage: 'self.status.focus.stacks * 2' }] }],
  activeStatuses: [{ id: 'focus', stacks: 3 }],
});
assert.equal(
  core.summarizeBuildBudget(activeStatusFormulaPack, { hp: 80, maxHp: 80 }).attack,
  30,
  'card formulas read actual player status stacks without leaking them to opponent status formulas',
);
const opponentStatusFormulaPack = core.createContentPack({
  cards: [{ id: 'mark_burst', quantity: 10, effects: [{ damage: 'opponent.status.focus.stacks * 2' }] }],
  activeStatuses: [{ id: 'focus', stacks: 3 }],
});
assert.equal(
  core.summarizeBuildBudget(opponentStatusFormulaPack, { hp: 80, maxHp: 80 }).attack,
  0,
  'player status stacks are never copied into the representative opponent',
);

const holdModifierPack = core.createContentPack({
  cards: [{ id: 'guard', quantity: 5, effects: [{ block: 6 }] }],
  statuses: [{ id: 'focus', triggers: { hold: [{ modify: 'block', add: 'stacks' }] } }],
  activeStatuses: [{ id: 'focus', stacks: 2 }],
});
assert.equal(
  core.summarizeBuildBudget(holdModifierPack, { hp: 80, maxHp: 80 }).defense,
  40,
  'active status hold modifiers use their real stacks when estimating one hand',
);

const statusFormulaWithHoldModifierPack = core.createContentPack({
  cards: [{ id: 'focused_burst', quantity: 5, effects: [{ damage: 'self.status.focus.stacks * 2' }] }],
  statuses: [{ id: 'focus', triggers: { hold: [{ modify: 'damage', add: 'stacks' }] } }],
  activeStatuses: [{ id: 'focus', stacks: 2 }],
});
assert.equal(
  core.summarizeBuildBudget(statusFormulaWithHoldModifierPack, { hp: 80, maxHp: 80 }).attack,
  30,
  'status stack formulas and hold modifiers are evaluated in one shared scenario',
);

const lowHealthFormulaPack = core.createContentPack({
  cards: [{ id: 'risk', quantity: 10, effects: [{ damage: 'self.hp < self.max_hp / 2 ? 12 : 3' }] }],
});
const fullHealthBudget = core.summarizeBuildBudget(lowHealthFormulaPack, { hp: 100, maxHp: 100 });
const lowHealthBudget = core.summarizeBuildBudget(lowHealthFormulaPack, { hp: 40, maxHp: 100 });
assert.ok(
  lowHealthBudget.attack > fullHealthBudget.attack,
  'actual player hp is included in the weighted build scenarios',
);

const scenarioBudget = core.summarizeBuildBudgetScenarios(lowHealthFormulaPack, { hp: 40, maxHp: 100 });
assert.ok(scenarioBudget.min.attack <= scenarioBudget.expected.attack);
assert.ok(scenarioBudget.expected.attack <= scenarioBudget.max.attack);
assert.deepEqual(
  core.formatBuildBudget(scenarioBudget.expected),
  'deck=10 atk=56 def=0 heal=0 draw=0 energy=0 hp=40/100',
  'scenario ranges remain internal and the AI-facing format stays flat',
);

const [contentPackSource, buildGuidanceSource, enemyBudgetSource] = await Promise.all([
  readFile(resolve('src/game-core/contentPack.ts'), 'utf8'),
  readFile(resolve('src/game-core/buildGuidance.ts'), 'utf8'),
  readFile(resolve('src/game-core/enemyBudget.ts'), 'utf8'),
]);
for (const source of [contentPackSource, buildGuidanceSource, enemyBudgetSource]) {
  assert.match(source, /from '.\/contentAnalysis'/);
}
assert.doesNotMatch(contentPackSource, /card\.effects|card\.effect/);
assert.doesNotMatch(buildGuidanceSource, /card\.effects|card\.effect|Object\.values\(effect\)/);
assert.doesNotMatch(enemyBudgetSource, /action\.effects|action\.effect|matchAll\(/);

console.log('One portable content-analysis pass drives formulas, triggers, statuses, and build budgets.');
