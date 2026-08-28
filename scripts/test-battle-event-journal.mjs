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

assert.equal(journal.countBattleEvents(state, { scope: 'turn', turn: 1, filter: { kind: 'card_played', cardType: 'Attack' } }), 2);
assert.equal(journal.countBattleEvents(state, { scope: 'card_instance', cardInstanceId: 'strike__1', filter: { kind: 'card_played' } }), 2);
assert.equal(journal.countBattleEvents(state, { scope: 'team', teamActorIds: ['player'], filter: { kind: 'damage_resolved', damageKind: 'attack' } }), 1);
assert.equal(journal.matchesEventOrdinal(state, played.event.id, { scope: 'combat', ordinal: 'first', filter: { kind: 'card_played' } }), true);
assert.equal(journal.matchesEventOrdinal(state, replayed.event.id, { scope: 'combat', ordinal: 'every_n', n: 2, filter: { kind: 'card_played' } }), true);
assert.equal(state.lastCardPlayed.id, replayed.event.id);
assert.equal(state.lastDamage.hpLost, 5);
assert.equal(state.lastActualHpLoss.hpLost, 5);

const restored = journal.createBattleEventJournal(JSON.parse(JSON.stringify(state.events)));
assert.deepEqual(restored, state, 'journal restoration must not recount or reorder events differently');
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

console.log('Causal battle journal preserves phases, reasons, scopes, ordinals, recursion guards, and deterministic restoration.');
