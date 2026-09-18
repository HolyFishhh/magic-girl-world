import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { INITIAL_DRAFT_TIMING_EXAMPLES: examples, initialDraftAuthoringPrompt } = require('../src/sillytavern-extension/initialDraftPrompt.ts');
const { compileCompactEffectList, validateStructuredTriggerInput } = require('../src/game-core/compactEffectDsl.ts');
const { resolveEventTriggerQueryInput } = require('../src/game-core/triggerInput.ts');
const { resolveAbilityTriggerPlan, resolveRelicTriggerPlan } = require('../src/game-core/triggerDefinitionRuntime.ts');
const { evaluateConditionExpression } = require('../src/game-core/effectDsl.ts');
const journal = require('../src/game-core/battleEventJournal.ts');
const issues = [];
validateStructuredTriggerInput(examples.firstAttackDiscard, 'trigger', issues);
assert.deepEqual(issues, []);
const program = compileCompactEffectList(examples.firstAttackDiscard.effects);
assert.equal(program.ok, true);
const definition = { id: 'example', name: 'example', trigger: examples.firstAttackDiscard.on,
  effectProgram: program.value, eventQuery: resolveEventTriggerQueryInput(examples.firstAttackDiscard) };
let state = journal.createBattleEventJournal();
function moved(turn, cardType, moveReason) {
  const result = journal.appendBattleEvent(state, { kind: 'card_moved', phase: 'after', turn,
    cause: { source: { kind: 'system', id: 'test' } }, actorId: 'player',
    cardInstanceId: `card_${state.nextSequence}`, templateId: 'test', cardType,
    from: 'hand', to: 'discardPile', moveReason });
  assert.equal(result.ok, true);
  state = result.state;
  const context = journal.battleTriggerContextFromEvent(result.event, state);
  const ability = Boolean(resolveAbilityTriggerPlan(definition, 'on_discard', context));
  assert.equal(Boolean(resolveRelicTriggerPlan(definition, 'on_discard', context)), ability);
  return ability;
}
// Cleanup and played disposal never consume the first eligible Attack discard.
moved(1, 'Attack', 'turn_cleanup');
moved(1, 'Attack', 'played');
assert.equal(moved(1, 'Skill', 'player_choice'), false);
assert.equal(moved(1, 'Attack', 'player_choice'), true);
assert.equal(moved(1, 'Attack', 'effect'), false);
state = journal.createBattleEventJournal(JSON.parse(JSON.stringify(state.events)));
assert.equal(moved(2, 'Attack', 'player_choice'), true);
const local = compileCompactEffectList(examples.localDiscardResult);
assert.equal(local.ok, true);
// Event metadata is not the local discard result cell, even when card type matches.
assert.equal(evaluateConditionExpression({ op: 'discarded_card_type', cardType: 'Attack' }, {}, { cardType: 'Attack' }), false);
const prompt = initialDraftAuthoringPrompt({ startPrompt: 'test', config: {}, narrative: 'retained story', currentStat: {}, designGuidance: null });
for (const example of Object.values(examples)) assert.ok(prompt.includes(JSON.stringify(example)));
assert.ok(prompt.includes('不能写成 turn_start'));
assert.ok(prompt.includes('新的触发器没有外层操作结果'));
console.log('Actual prompt examples compile; Attack discard ordinal/filter and next-turn restoration match production ability/relic planning; event metadata does not impersonate local result. Not UI acceptance.');
