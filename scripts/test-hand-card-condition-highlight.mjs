import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require('../src/game-core/index.ts');
const { evaluateHandCardConditionHighlight } = require('../src/fish/ui/handCardConditionHighlight.ts');

const compile = effects => {
  const result = core.compileCompactEffectList(effects);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
const targets = [{ id: 'bleeding' }, { id: 'clear' }];
const stateFor = target => ({
  self: {
    hp: 40, maxHp: 40, lust: 0, maxLust: 30, energy: 3, maxEnergy: 3, block: 0,
    stanceId: 'demon', statusStacks: {}, resources: {}, maxResources: {},
  },
  opponent: {
    hp: 50, maxHp: 50, lust: 0, maxLust: 30, energy: 0, maxEnergy: 0, block: 0,
    statusStacks: { bleed: target.id === 'bleeding' ? 2 : 1 }, resources: {}, maxResources: {},
  },
  currentTurn: 2, cardsPlayedThisTurn: 0, attacksPlayedThisTurn: 0, skillsPlayedThisTurn: 0,
});

const bloodHarvest = compile({ damage: 8, lifesteal: 3, when: 'opponent.status.bleed.stacks >= 2' });
const before = JSON.stringify({ targets, bleeding: stateFor(targets[0]), clear: stateFor(targets[1]) });
const activeMatch = evaluateHandCardConditionHighlight({
  program: bloodHarvest, targets, activeTargetId: 'bleeding', getState: stateFor,
});
assert.deepEqual(activeMatch, { kind: 'current-target', hint: '条件满足：当前目标满足', glows: true },
  '炼血收割在当前流血目标满足阈值时才发光');
assert.equal(JSON.stringify({ targets, bleeding: stateFor(targets[0]), clear: stateFor(targets[1]) }), before,
  'preflight only evaluates conditions and must not alter combat snapshots');

const otherMatch = evaluateHandCardConditionHighlight({
  program: bloodHarvest, targets, activeTargetId: 'clear', getState: stateFor,
});
assert.deepEqual(otherMatch, { kind: 'other-target', hint: '条件满足：其他目标满足', glows: false },
  'different active target reports a matching other target rather than glowing falsely');

const infernoSlash = compile({ damage: 12, when: "self.stance == 'demon'" });
const stanceMatch = evaluateHandCardConditionHighlight({
  program: infernoSlash, targets, activeTargetId: 'clear', getState: stateFor,
});
assert.deepEqual(stanceMatch, { kind: 'current-target', hint: '条件满足：当前条件满足', glows: true },
  '炼狱斩 reads the real self stance predicate rather than card prose');

const partlyMatched = compile({ damage: 8, when: 'opponent.status.bleed.stacks >= 2 && self.block >= 1' });
const partialMatch = evaluateHandCardConditionHighlight({
  program: partlyMatched,
  targets: [{ id: 'bleeding' }], activeTargetId: 'bleeding', getState: stateFor,
});
assert.deepEqual(partialMatch, { kind: 'partial', hint: '条件满足：当前目标部分符合', glows: false },
  'a compound predicate distinguishes partial satisfaction from a complete enhancement');
const noMatch = evaluateHandCardConditionHighlight({
  program: bloodHarvest,
  targets: [{ id: 'clear' }], activeTargetId: 'clear', getState: stateFor,
});
assert.deepEqual(noMatch, { kind: 'none', hint: null, glows: false });

const executionOnly = {
  spec: 'mwg.effect/v1',
  steps: [{ op: 'if', condition: { op: 'event_status_is', statusId: 'bleed' }, then: [] }],
};
assert.deepEqual(evaluateHandCardConditionHighlight({
  program: executionOnly, targets, activeTargetId: 'bleeding', getState: stateFor,
}), { kind: 'unknown', hint: '条件将在执行时判定', glows: false },
  'event-only conditions have no hand-time context and must not be guessed');

const afterDamage = {
  spec: 'mwg.effect/v1',
  steps: [
    { op: 'damage', target: 'opponent', amount: 1, hitGroup: 'test' },
    { op: 'if', condition: { op: 'compare', relation: 'gte', left: { op: 'var', path: 'opponent.status.bleed.stacks' }, right: 2 }, then: [] },
  ],
};
assert.deepEqual(evaluateHandCardConditionHighlight({
  program: afterDamage, targets, activeTargetId: 'bleeding', getState: stateFor,
}), { kind: 'unknown', hint: '条件将在执行时判定', glows: false },
  'a later condition can depend on prior steps, so multi-step programs are never pre-resolved');

const paidEnergyCondition = compile({ damage: 5, when: 'self.energy >= 3' });
assert.deepEqual(evaluateHandCardConditionHighlight({
  program: paidEnergyCondition, targets, activeTargetId: 'bleeding', getState: stateFor,
}), { kind: 'unknown', hint: '条件将在执行时判定', glows: false },
  'payment happens before card execution, so self energy cannot be honestly preflighted');

const paidResourceCondition = {
  spec: 'mwg.effect/v1',
  steps: [{ op: 'if', condition: {
    op: 'compare', relation: 'gte', left: { op: 'var', path: 'self.resource.blood.current' }, right: 1,
  }, then: [] }],
};
assert.deepEqual(evaluateHandCardConditionHighlight({
  program: paidResourceCondition, targets, activeTargetId: 'bleeding', getState: stateFor,
}), { kind: 'unknown', hint: '条件将在执行时判定', glows: false },
  'current resource can also change as payment and must remain unknown');

const selectorProgram = {
  spec: 'mwg.effect/v1',
  steps: [{ op: 'if', condition: {
    op: 'compare', relation: 'gte', left: { op: 'var', path: 'opponent.status.bleed.stacks' }, right: 2,
  }, then: [{ op: 'damage', target: 'opponent', targetSelector: { mode: 'random' }, amount: 3, hitGroup: 'random-target' }] }],
};
assert.deepEqual(evaluateHandCardConditionHighlight({
  program: selectorProgram, targets, activeTargetId: 'bleeding', getState: stateFor,
}), { kind: 'unknown', hint: '条件将在执行时判定', glows: false },
  'a random target selector must not be represented as an active-target match');

const allSelectorProgram = {
  spec: 'mwg.effect/v1',
  steps: [{ op: 'if', condition: {
    op: 'compare', relation: 'gte', left: { op: 'var', path: 'opponent.status.bleed.stacks' }, right: 2,
  }, then: [{ op: 'damage', target: 'opponent', targetSelector: { mode: 'all' }, amount: 3, hitGroup: 'all-targets' }] }],
};
assert.deepEqual(evaluateHandCardConditionHighlight({
  program: allSelectorProgram, targets, activeTargetId: 'bleeding', getState: stateFor,
}), { kind: 'unknown', hint: '条件将在执行时判定', glows: false },
  'an all-target selector has no single active-target condition claim');

const fixedSelectorProgram = {
  spec: 'mwg.effect/v1',
  steps: [{ op: 'if', condition: {
    op: 'compare', relation: 'gte', left: { op: 'var', path: 'opponent.status.bleed.stacks' }, right: 2,
  }, then: [{ op: 'damage', target: 'opponent', targetSelector: { mode: 'by_id', id: 'bleeding' }, amount: 3, hitGroup: 'fixed-target' }] }],
};
assert.deepEqual(evaluateHandCardConditionHighlight({
  program: fixedSelectorProgram, targets, activeTargetId: 'clear', getState: stateFor,
}), { kind: 'current-target', hint: '条件满足：固定目标满足', glows: true },
  'a fixed selector evaluates its real fixed target instead of the active enemy');

assert.deepEqual(evaluateHandCardConditionHighlight({
  program: infernoSlash, targets, activeTargetId: 'clear', getState: () => { throw new Error('snapshot unavailable'); },
}), { kind: 'unknown', hint: '条件将在执行时判定', glows: false },
  'a failed read is contained so hand rendering can continue');

console.log('hand card condition highlight tests passed');
