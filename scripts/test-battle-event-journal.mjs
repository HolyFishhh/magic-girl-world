import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const journal = require(resolve('src/game-core/battleEventJournal.ts'));

let state = journal.createBattleEventJournal();
const source = { kind: 'card', id: 'strike', name: '斩击' };
const played = journal.appendBattleEvent(state, {
  turn: 1,
  phase: 'after',
  kind: 'card_played',
  cause: { source, reason: 'player_choice' },
  actorId: 'player',
  cardInstanceId: 'strike__1',
  templateId: 'strike',
  cardType: 'Attack',
  automatic: false,
  replayIndex: 0,
});
assert.equal(played.ok, true);
state = played.state;

const damage = journal.appendBattleEvent(state, {
  turn: 1,
  phase: 'after',
  kind: 'damage_resolved',
  depth: 1,
  cause: { source, parentEventId: played.event.id, rootEventId: played.event.id },
  actorId: 'player',
  targetId: 'enemy:a',
  damageKind: 'attack',
  requested: 8,
  modified: 8,
  blocked: 3,
  hpLost: 5,
  fatal: false,
});
assert.equal(damage.ok, true);
state = damage.state;

const replayed = journal.appendBattleEvent(state, {
  turn: 1,
  phase: 'after',
  kind: 'card_played',
  cause: { source, reason: 'auto_play', parentEventId: played.event.id, rootEventId: played.event.id },
  actorId: 'player',
  cardInstanceId: 'strike__1',
  templateId: 'strike',
  cardType: 'Attack',
  automatic: true,
  replayIndex: 1,
});
assert.equal(replayed.ok, true);
state = replayed.state;

const spent = journal.appendBattleEvent(state, {
  turn: 1,
  phase: 'resolve',
  kind: 'resource_spent',
  cause: { source, parentEventId: played.event.id, rootEventId: played.event.id },
  actorId: 'player',
  resource: 'stars',
  requested: 2,
  spent: 2,
});
assert.equal(spent.ok, true);
state = spent.state;
const changed = journal.appendBattleEvent(state, {
  turn: 1,
  phase: 'resolve',
  kind: 'resource_changed',
  cause: { source, parentEventId: played.event.id, rootEventId: played.event.id },
  actorId: 'player',
  targetId: 'enemy:a',
  resource: 'rage',
  previousValue: 1,
  nextValue: 3,
  change: 'gain',
});
assert.equal(changed.ok, true);
state = changed.state;

const shuffled = journal.appendBattleEvent(state, {
  turn: 1,
  phase: 'resolve',
  kind: 'draw_pile_shuffled',
  cause: { source: { kind: 'system', id: 'draw' } },
  actorId: 'player',
  recycledCards: 4,
});
assert.equal(shuffled.ok, true);
state = shuffled.state;
const lustRaised = journal.appendBattleEvent(state, {
  turn: 1,
  phase: 'resolve',
  kind: 'lust_increased',
  cause: { source },
  actorId: 'player',
  targetId: 'enemy:a',
  previousValue: 2,
  nextValue: 7,
  amount: 5,
});
assert.equal(lustRaised.ok, true);
state = lustRaised.state;

assert.equal(journal.countBattleEvents(state, { scope: 'turn', turn: 1, filter: { kind: 'card_played', cardType: 'Attack' } }), 2);
assert.equal(journal.countBattleEvents(state, { scope: 'card_instance', cardInstanceId: 'strike__1', filter: { kind: 'card_played' } }), 2);
assert.equal(journal.countBattleEvents(state, { scope: 'team', teamActorIds: ['player'], filter: { kind: 'damage_resolved', damageKind: 'attack' } }), 1);
assert.equal(journal.matchesEventOrdinal(state, played.event.id, { scope: 'combat', ordinal: 'first', filter: { kind: 'card_played' } }), true);
assert.equal(journal.matchesEventOrdinal(state, replayed.event.id, { scope: 'combat', ordinal: 'every_n', n: 2, filter: { kind: 'card_played' } }), true);
assert.equal(state.lastCardPlayed.id, replayed.event.id);
assert.equal(state.lastDamage.hpLost, 5);
assert.equal(state.lastActualHpLoss.hpLost, 5);
assert.equal(journal.countBattleEvents(state, { scope: 'turn', turn: 1, filter: { kind: 'resource_spent' } }), 1);
assert.equal(journal.countBattleEvents(state, { scope: 'combat', filter: { kind: 'resource_changed' } }), 1);
assert.equal(journal.countBattleEvents(state, { scope: 'combat', filter: { kind: 'draw_pile_shuffled' } }), 1);
assert.equal(journal.matchesEventTriggerQuery({
  ...journal.battleTriggerContextFromEvent(lustRaised.event, state),
  teamActorIds: ['player'],
}, {
  scope: 'team', ordinal: 'first', filter: { kind: 'lust_increased' },
}), true, 'team scope derives its actor membership from the runtime trigger context');

const restored = journal.createBattleEventJournal(JSON.parse(JSON.stringify(state.events)));
assert.deepEqual(restored, state, 'journal restoration must not recount or reorder events differently');
const archived = journal.archiveBattleJournalInRun(journal.createRunEventHistory(), 'encounter:a', state);
assert.equal(archived.records.length, state.events.length);
const archivedAgain = journal.archiveBattleJournalInRun(archived, 'encounter:a', state);
assert.equal(
  archivedAgain.records.length,
  state.events.length,
  're-settling the same encounter must replace rather than duplicate its run history',
);
assert.deepEqual(journal.readRunEventHistory(JSON.parse(JSON.stringify(archivedAgain))), archivedAgain);
assert.equal(
  journal.readRunEventHistory({ ...archivedAgain, records: [{ encounterId: 'bad', event: { kind: 'invented' } }] }),
  null,
  'host-written run history must reject events outside the executable event vocabulary',
);
let nextEncounter = journal.createBattleEventJournal();
const nextPlayed = journal.appendBattleEvent(nextEncounter, {
  turn: 1,
  phase: 'after',
  kind: 'card_played',
  cause: { source, reason: 'player_choice' },
  actorId: 'player',
  cardInstanceId: 'guard__1',
  templateId: 'guard',
  cardType: 'Skill',
  automatic: false,
  replayIndex: 0,
});
assert.equal(nextPlayed.ok, true);
nextEncounter = journal.attachRunEventHistory(nextPlayed.state, archivedAgain);
assert.equal(
  journal.countBattleEvents(nextEncounter, { scope: 'run', filter: { kind: 'card_played' } }),
  3,
  'run scope combines archived encounters with the current encounter exactly once',
);
const tooDeep = journal.appendBattleEvent(state, {
  turn: 1,
  phase: 'after',
  kind: 'turn_ended',
  depth: 33,
  cause: { source: { kind: 'system', id: 'turn' } },
  actorId: 'player',
});
assert.equal(tooDeep.code, 'MAX_EVENT_DEPTH');
const invalidDamage = journal.appendBattleEvent(state, {
  turn: 1,
  phase: 'after',
  kind: 'damage_resolved',
  cause: { source },
  actorId: 'player',
  targetId: 'enemy:a',
  damageKind: 'effect',
  requested: -1,
  modified: -1,
  blocked: 0,
  hpLost: 0,
  fatal: false,
});
assert.equal(invalidDamage.code, 'INVALID_EVENT_VALUE');
const invalidResource = journal.appendBattleEvent(state, {
  turn: 1,
  phase: 'resolve',
  kind: 'resource_changed',
  cause: { source },
  actorId: 'player',
  targetId: 'enemy:a',
  resource: 'bad-resource',
  previousValue: 0,
  nextValue: 1,
  change: 'gain',
});
assert.equal(invalidResource.code, 'INVALID_EVENT_VALUE');
const invalidAttribute = journal.appendBattleEvent(state, {
  turn: 1,
  phase: 'resolve',
  kind: 'block_gained',
  cause: { source },
  actorId: 'player',
  targetId: 'player',
  previousValue: 2,
  nextValue: 2,
  amount: 0,
});
assert.equal(invalidAttribute.code, 'INVALID_EVENT_VALUE');

console.log('Causal battle journal preserves phases, reasons, scopes, ordinals, recursion guards, and deterministic restoration.');
