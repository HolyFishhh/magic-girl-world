import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { normalizeAbilityDefinition, normalizeRelicDefinition } = require('../src/fish/core/battleContentAdapter.ts');
const { resolveAbilityTriggerPlan, resolveRelicTriggerPlan } = require('../src/game-core/triggerDefinitionRuntime.ts');
const { resolvePlayedCardTriggers } = require('../src/game-core/battleTriggers.ts');
const journal = require('../src/game-core/battleEventJournal.ts');
const { TavernEffectCommandHost } = require('../src/fish/core/effectCommandHost.ts');
const { INITIAL_DRAFT_TIMING_EXAMPLES } = require('../src/sillytavern-extension/initialDraftPrompt.ts');

// A bounded behavioral regression, not a universal natural-language requirement validator.
// Exercise production normalization, event ordinals, dispatch names and effect execution.
async function trace(trigger, carrier) {
  const authored = { id: 'skill_probe', name: 'Skill probe', trigger };
  const normalize = carrier === 'ability' ? normalizeAbilityDefinition : normalizeRelicDefinition;
  const plan = carrier === 'ability' ? resolveAbilityTriggerPlan : resolveRelicTriggerPlan;
  let definition = normalize(authored);
  assert.ok(definition, JSON.stringify(authored));
  let events = journal.createBattleEventJournal();
  const actor = { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 0, maxEnergy: 3, block: 0 };
  let blocks = 0;
  const host = new TavernEffectCommandHost({
    readState: () => ({ self: actor, opponent: actor }), isTerminal: () => false,
    presentCommand: () => {}, executeCardCommand: async () => {}, chooseEffectOption: async () => null,
    executeBattleCommand: async command => {
      assert.equal(command.type, 'gain_block');
      blocks += command.amount;
    }, executeSpecialCommand: async () => {},
  });
  const result = [];
  for (const [turn, cardType] of [[1, 'Attack'], [1, 'Skill'], [1, 'Skill'], [1, 'Skill'], [2, 'Attack'], [2, 'Skill'], [2, 'Skill'], [2, 'Skill']]) {
    if (result.length === 3) {
      events = journal.createBattleEventJournal(JSON.parse(JSON.stringify(events.events)));
      definition = normalize(JSON.parse(JSON.stringify(authored)));
    }
    const appended = journal.appendBattleEvent(events, {
      kind: 'card_played', phase: 'after', turn, actorId: 'player',
      cause: { source: { kind: 'card', id: 'probe' }, reason: 'player_choice' },
      cardInstanceId: `probe_${events.nextSequence}`, templateId: 'probe', cardType,
      automatic: false, replayIndex: 0,
    });
    assert.equal(appended.ok, true);
    events = appended.state;
    const context = journal.battleTriggerContextFromEvent(appended.event, events);
    const before = blocks;
    for (const name of resolvePlayedCardTriggers(cardType)) {
      const resolved = plan(definition, name, context);
      if (resolved) await host.executeProgram(resolved.program, true, context);
    }
    result.push(blocks - before);
  }
  return result;
}

const expected = [0, 2, 0, 0, 0, 2, 0, 0];
for (const carrier of ['ability', 'relic']) {
  assert.deepEqual(await trace(INITIAL_DRAFT_TIMING_EXAMPLES.firstSkill, carrier), expected);
  for (const event of [{ on: 'skill_played' }, { on: 'card_played', card_type: 'Skill' }]) {
    assert.deepEqual(await trace({ ...event, scope: 'turn', ordinal: 'first', effects: { block: 2, to: 'self' } }, carrier), expected);
  }
  assert.deepEqual(
    await trace({ on: 'skill_played', scope: 'turn', ordinal: 'first_n', n: 2, effects: { block: 2, to: 'self' } }, carrier),
    [0, 2, 2, 0, 0, 2, 2, 0],
    'first_n fires for each of the first N matching events and resets with the turn-scoped journal after restoration',
  );
  // Valid DSL is insufficient: wrong scope, missing ordinal and wrong timing must differ.
  for (const trigger of [
    { on: 'skill_played', scope: 'combat', ordinal: 'first' },
    { on: 'skill_played', scope: 'turn' },
    { on: 'turn_start' },
    { on: 'card_played', scope: 'turn', ordinal: 'first' },
  ]) assert.notDeepEqual(await trace({ ...trigger, effects: { block: 2, to: 'self' } }, carrier), expected);
}
console.log('PASS: prompt example plus type-specific and filtered generic triggers execute equivalent payoffs with ability/relic carriers across two turns and journal restoration; 8 semantic near-misses differ. Bounded runtime regression, not live gameplay acceptance.');
