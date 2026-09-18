import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const journal = require(resolve('src/game-core/battleEventJournal.ts'));
const { resolveEventTriggerQueryInput } = require(resolve('src/game-core/triggerInput.ts'));
const { resolveAbilityTriggerPlan, resolveRelicTriggerPlan } = require(resolve('src/game-core/triggerDefinitionRuntime.ts'));
const { EVENT_KIND_BY_TRIGGER, CARD_TYPE_BY_TRIGGER, EVENT_PHASE_BY_TRIGGER, triggerEventSchemaConstraints } = require(resolve('src/game-core/triggerEventContract.ts'));
const portableSchema = require(resolve('schemas/mwg-card-effects-v1.schema.json'));
assert.deepEqual(portableSchema.$defs.triggerEventContract.allOf, triggerEventSchemaConstraints(), 'portable artifact must exactly mirror the shared event facts');
assert.ok(portableSchema.$defs.trigger.enum.includes('kill'), 'card-owned registered triggers expose kill');
assert.ok(portableSchema.$defs.abilityTrigger.enum.includes('kill'), 'relic and ability triggers expose kill');
const validatePortableTrigger = new Ajv2020({ strict: false, allErrors: true }).compile({
  $defs: portableSchema.$defs,
  type: 'object', required: ['trigger'], properties: { trigger: { $ref: '#/$defs/triggerInput' } },
});
const { EVENT_FILTERABLE_TRIGGER_SET } = require(resolve('src/game-core/battleTriggers.ts'));
const { validateStructuredTriggerInput, compileCompactEffectList } = require(resolve('src/game-core/compactEffectDsl.ts'));
const { withAiContentDefinitions } = require(resolve('src/game-core/aiContentJsonSchema.ts'));
const { createContentPack, validateContentPackContract } = require(resolve('src/game-core/index.ts'));
const validateCard = new Ajv2020({ strict: false, allErrors: true }).compile(withAiContentDefinitions({
  type: 'object', required: ['card'], properties: { card: { $ref: '#/$defs/mwgCard' } },
}));
const program = { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] };
const card = trigger => ({ id: 'ordinal_power', name: '序数之力', type: 'Power', rarity: 'Rare', cost: 1, quantity: 1, trigger });
assert.deepEqual(Object.keys(EVENT_KIND_BY_TRIGGER).sort(), [...EVENT_FILTERABLE_TRIGGER_SET].sort());
for (const on of EVENT_FILTERABLE_TRIGGER_SET) {
  const input = { on, ordinal: 'first', effects: { block: 2 } };
  const snapshot = structuredClone(input);
  const query = resolveEventTriggerQueryInput(input);
  assert.equal(query.filter.kind, EVENT_KIND_BY_TRIGGER[on]);
  assert.equal(query.filter.phase, EVENT_PHASE_BY_TRIGGER[on]);
  if (CARD_TYPE_BY_TRIGGER[on]) assert.equal(query.filter.cardType, CARD_TYPE_BY_TRIGGER[on]);
  assert.deepEqual(input, snapshot);
  assert.equal(validateCard({ card: card(input) }), true, JSON.stringify(validateCard.errors));
  const issues = [];
  validateStructuredTriggerInput(input, 'trigger', issues);
  assert.deepEqual(issues, []);
}
const killTrigger = { on: 'kill', ordinal: 'first', effects: { block: 2 } };
assert.equal(validatePortableTrigger({ trigger: killTrigger }), true, JSON.stringify(validatePortableTrigger.errors));
assert.equal(validateCard({ card: card(killTrigger) }), true, JSON.stringify(validateCard.errors));
for (const contradictoryKill of [
  { ...killTrigger, event: 'damage_resolved' },
  { ...killTrigger, phase: 'resolve' },
]) {
  assert.equal(validatePortableTrigger({ trigger: contradictoryKill }), false);
  assert.equal(validateCard({ card: card(contradictoryKill) }), false);
}
for (const [extra, code] of [
  [{ event: 'card_drawn' }, 'CONFLICTING_TRIGGER_EVENT'],
  [{ card_type: 'Attack' }, 'CONFLICTING_TRIGGER_CARD_TYPE'],
  [{ phase: 'before' }, 'CONFLICTING_TRIGGER_PHASE'],
]) {
  const trigger = { on: 'skill_played', ordinal: 'first', effects: { block: 2 }, ...extra };
  assert.equal(validateCard({ card: card(trigger) }), false);
  const checked = validateContentPackContract(createContentPack({ cards: [card(trigger)] }), { requireExecutable: true });
  assert.equal(checked.ok, false);
  assert.ok(checked.issues.some(issue => issue.code === code && issue.path.startsWith('cards[0].trigger.')));
  const template = compileCompactEffectList({ add_card: 'ordinal_power' }, { creates: [card(trigger)] });
  assert.equal(template.ok, false);
  assert.ok(template.issues.some(issue => issue.code === code));
}

let state;
function reset(runHistory) { state = journal.createBattleEventJournal([], runHistory); }
function add(fields) {
  const result = journal.appendBattleEvent(state, {
    turn: 1, phase: 'resolve', cause: { source: { kind: 'system', id: 'test' } }, actorId: 'player', ...fields,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  state = result.state;
  return result.event;
}
function played(cardType = 'Skill', fields = {}) {
  return add({ kind: 'card_played', phase: 'after', cardType, cardInstanceId: `card_${state.nextSequence}`, templateId: 'test', automatic: false, replayIndex: 0, ...fields });
}
function damage(actorId, targetId, hpLost = 2) {
  return add({ kind: 'damage_resolved', actorId, targetId, damageKind: 'attack', requested: 2, modified: 2, blocked: 2 - hpLost, hpLost, fatal: false });
}
function status(statusType, targetId, fields = {}) {
  return add({ kind: 'status_applied', actorId: targetId, targetId, statusId: 'test_status', statusName: '测试状态', stacks: 1, trigger: 'apply', statusType, ...fields });
}
function fires(on, event, queryFields = {}, contextFields = {}) {
  const eventQuery = resolveEventTriggerQueryInput({ on, ordinal: 'first', ...queryFields });
  const definition = { id: 'test', name: '测试', trigger: on, effectProgram: program, eventQuery };
  const context = { ...journal.battleTriggerContextFromEvent(event, state), teamActorIds: ['player', 'summon_friend'], ...contextFields };
  const ability = Boolean(resolveAbilityTriggerPlan(definition, on, context));
  assert.equal(Boolean(resolveRelicTriggerPlan(definition, on, context)), ability, 'ability and relic share the same count boundary');
  return ability;
}

reset();
add({ kind: 'turn_started' });
played('Attack');
played('Skill', { actorId: 'enemy_a' });
played('Skill', { phase: 'before' });
const firstSkill = played();
assert.equal(fires('skill_played', firstSkill), true, 'attack, enemy skill and lifecycle events are not my first skill');
assert.equal(fires('skill_played', firstSkill, { event: 'card_played' }), true);
assert.equal(fires('skill_played', firstSkill, { event: 'card_played', phase: 'after', card_type: 'Skill' }), true, 'explicit matching metadata has identical runtime behavior');
assert.equal(fires('skill_played', firstSkill, { card_type: 'Attack' }), false, 'an explicit contradiction cannot be normalized into a working ability');
played('Attack');
const secondSkill = played();
assert.equal(fires('skill_played', secondSkill), false);
assert.equal(fires('skill_played', secondSkill, { ordinal: 'nth', n: 2 }), true);
assert.equal(fires('skill_played', secondSkill, { ordinal: 'every_n', n: 2 }), true);
assert.equal(fires('skill_played', played(), { ordinal: 'every_n', n: 2 }), false);
assert.equal(fires('skill_played', played('Skill', { turn: 2 }), { scope: 'turn' }), true);
assert.equal(fires('power_played', played('Power')), true);
assert.equal(fires('card_played', firstSkill), false, 'generic card_played still includes earlier attacks');

// Old runtime saves with no event filter also receive the implied kind/type.
const legacy = { id: 'legacy', trigger: 'skill_played', effectProgram: program, eventQuery: { scope: 'combat', ordinal: 'first' } };
assert.ok(resolveAbilityTriggerPlan(legacy, 'skill_played', journal.battleTriggerContextFromEvent(firstSkill, state)));

reset();
damage('player', 'enemy_a');
damage('enemy_a', 'summon_friend');
damage('enemy_a', 'player', 0);
const myFirstHit = damage('enemy_a', 'player');
assert.equal(fires('take_damage', myFirstHit), true, 'damage dealt, summon damage and fully blocked hits cannot consume my first received HP loss');
assert.equal(fires('take_damage', damage('enemy_b', 'player')), false);
assert.equal(fires('take_damage', myFirstHit, { scope: 'team' }), false, 'team receive scope counts friendly recipients, not enemy attackers');
reset();
damage('enemy_a', 'player');
damage('player', 'player');
assert.equal(fires('deal_damage', damage('player', 'enemy_a')), true, 'self HP loss does not dispatch deal_damage');
assert.equal(fires('deal_damage', damage('player', 'enemy_b')), false, 'different victims share the same source count');
reset();
const heal = (actorId, targetId, hpGained) => add({ kind: 'heal_resolved', actorId, targetId, requested: 2, hpGained });
heal('player', 'enemy_a', 2);
heal('player', 'player', 0);
assert.equal(fires('take_heal', heal('player', 'player', 2)), true, 'zero healing and other recipients do not consume my first actual heal');
assert.equal(fires('take_heal', heal('enemy_a', 'player', 2)), false);
reset();
heal('player', 'player', 2);
heal('player', 'enemy_a', 0);
assert.equal(fires('deal_heal', heal('player', 'enemy_a', 2)), true);
assert.equal(fires('deal_heal', heal('player', 'enemy_b', 2)), false);

reset();
status('debuff', 'player');
status('buff', 'enemy_a');
const firstBuff = status('buff', 'player');
assert.equal(fires('gain_buff', firstBuff), true, 'debuff and enemy buff are not my buff');
assert.equal(fires('gain_buff', status('buff', 'player')), false);
assert.equal(fires('enemy_gain_buff', firstBuff, {}, { teamActorIds: ['enemy_a', 'enemy_b'] }), true, 'observer excludes its own side');
reset();
status('buff', 'player');
const firstEnemyBuff = status('buff', 'enemy_a');
assert.equal(fires('enemy_gain_buff', firstEnemyBuff), true);
assert.equal(fires('enemy_gain_buff', status('buff', 'enemy_b')), false, 'opposing observers count across the opposing roster');
reset();
status(undefined, 'player');
assert.equal(fires('gain_buff', status('buff', 'player')), false, 'ambiguous old polarity must not restart an exact ordinal');
reset();
status(undefined, 'enemy_a');
status('neutral', 'player');
assert.equal(fires('gain_buff', status('buff', 'player')), true, 'unrelated legacy holders and explicitly neutral statuses do not block my exact count');
reset();
status('buff', 'dead_friend', { targetSide: 'player' });
const enemyBuffWithSide = status('buff', 'enemy_a', { targetSide: 'enemy' });
assert.equal(fires('enemy_gain_buff', enemyBuffWithSide), true, 'a removed friendly unit is not reclassified as opposing');
status('buff', 'dead_enemy', { targetSide: 'enemy' });
assert.equal(fires('enemy_gain_buff', status('buff', 'enemy_b', { targetSide: 'enemy' })), false);
const removed = (statusType, targetId, targetSide) => add({
  kind: 'status_removed', statusId: 'removed_status', statusName: '移除状态', statusType,
  actorId: 'player', actorSide: 'player', targetId, targetSide, stacks: 1, reason: 'explicit',
});
for (const on of ['lose_buff', 'lose_debuff', 'enemy_lose_buff', 'enemy_lose_debuff']) {
  reset();
  const polarity = on.endsWith('_debuff') ? 'debuff' : 'buff';
  const observer = on.startsWith('enemy_');
  const holder = observer ? 'enemy_a' : 'player';
  const side = observer ? 'enemy' : 'player';
  removed(polarity === 'buff' ? 'debuff' : 'buff', holder, side);
  removed(polarity, observer ? 'player' : 'enemy_a', observer ? 'player' : 'enemy');
  const first = removed(polarity, holder, side);
  assert.equal(fires(on, first), true, `${on} counts only matching polarity and recipient side`);
  const saved = JSON.parse(JSON.stringify(state.events));
  state = journal.createBattleEventJournal(saved);
  assert.equal(fires(on, first), true, `${on} provenance survives battle reload`);
  assert.equal(fires(on, removed(polarity, observer ? 'enemy_b' : holder, side)), false);
}
reset();
status('buff', 'enemy_old', { actorSide: 'player', targetSide: 'enemy' });
const savedStatusRun = JSON.parse(JSON.stringify(journal.archiveBattleJournalInRun(journal.createRunEventHistory(), 'old_battle', state)));
reset(journal.readRunEventHistory(savedStatusRun));
const newEnemyBuff = status('buff', 'enemy_new', { actorSide: 'enemy', targetSide: 'enemy' });
assert.equal(fires('enemy_gain_buff', newEnemyBuff, { scope: 'run' }), false);
assert.equal(fires('enemy_gain_buff', newEnemyBuff, { scope: 'run', ordinal: 'nth', n: 2 }), true, 'status polarity and sides survive run archive reload across different enemy IDs');

reset();
const moved = fields => add({ kind: 'card_moved', phase: 'after', cardInstanceId: `move_${state.nextSequence}`, templateId: 'test', cardType: 'Skill', from: 'hand', to: 'discardPile', moveReason: 'effect', ...fields });
moved({ moveReason: 'turn_cleanup' });
moved({ moveReason: 'played' });
moved({ moveReason: 'auto_play' });
moved({ from: 'drawPile', moveReason: 'scry' });
const exhaust = moved({ to: 'exhaustPile', moveReason: 'exhaust' });
assert.equal(fires('on_exhaust', exhaust), true);
const firstDiscard = moved({});
assert.equal(fires('on_discard', firstDiscard), true, 'played disposal, auto-play, cleanup, scry and exhaust are not true hand discards');
const secondDiscard = moved({ moveReason: 'random_effect' });
assert.equal(fires('on_discard', secondDiscard), false);
assert.equal(fires('on_discard', secondDiscard, { ordinal: 'nth', n: 2 }), true);
assert.equal(fires('on_discard', secondDiscard, { ordinal: 'every_n', n: 2 }), true);
assert.equal(fires('on_exhaust', moved({ to: 'exhaustPile', moveReason: 'exhaust' })), false);
const discardArchive = journal.archiveBattleJournalInRun(journal.createRunEventHistory(), 'discard_encounter', state);
reset(journal.readRunEventHistory(JSON.parse(JSON.stringify(discardArchive))));
const thirdDiscard = moved({ moveReason: 'player_choice' });
assert.equal(fires('on_discard', thirdDiscard, { scope: 'run', ordinal: 'nth', n: 3 }), true, 'run archive retains played-vs-discard semantics');

reset();
played('Attack');
played('Skill');
const archived = journal.archiveBattleJournalInRun(journal.createRunEventHistory(), 'encounter_a', state);
reset(archived);
const nextCombatSkill = played('Skill');
assert.equal(fires('skill_played', nextCombatSkill), true);
assert.equal(fires('skill_played', nextCombatSkill, { scope: 'run' }), false);
assert.equal(fires('skill_played', nextCombatSkill, { scope: 'run', ordinal: 'nth', n: 2 }), true);
state = journal.createBattleEventJournal(JSON.parse(JSON.stringify(state.events)), journal.readRunEventHistory(JSON.parse(JSON.stringify(archived))));
assert.equal(fires('skill_played', nextCombatSkill, { scope: 'run', ordinal: 'nth', n: 2 }), true, 'reload preserves the exact ordinal');

console.log('Trigger contract: inferred technical fields, contradictory filters, mixed event/type/owner/polarity/move histories, legacy filter saves and run reload verified.');
