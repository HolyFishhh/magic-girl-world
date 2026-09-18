import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { towerScreenFor } = require('../src/common/towerScreenPresentation.ts');
const stat = run => ({ run });
const awaiting = (kind, extra = {}) => ({ phase: 'awaiting_choice', currentNode: { kind }, ...extra });

assert.equal(towerScreenFor(stat(awaiting('battle')), true), 'battle-reward', 'battle rewards take priority over the completed battle room');
assert.equal(towerScreenFor(stat(awaiting('boss')), true), 'battle-reward', 'a won boss with a reward opens loot before the map');
assert.equal(towerScreenFor(stat(awaiting('battle')), false), 'map', 'after claims, a completed battle returns to the route map');
assert.equal(towerScreenFor(stat(awaiting('event')), false), 'map', 'a resolved event does not retain a room');
assert.equal(towerScreenFor(stat(awaiting('treasure')), false), 'map', 'a resolved treasure room does not retain a room');
assert.equal(towerScreenFor(stat(awaiting('shop')), false), 'map', 'a resolved shop does not retain a room');
assert.equal(towerScreenFor(stat(awaiting('event', { opening: { phase: 'offered' } })), false), 'room', 'an unclaimed event gift remains in its room');
assert.equal(towerScreenFor(stat(awaiting('treasure', { opening: { phase: 'offered' } })), false), 'room', 'an unclaimed treasure gift remains in its room');
assert.equal(towerScreenFor(stat(awaiting('shop', { opening: { phase: 'offered' } })), false), 'room', 'an unclaimed shop gift remains in its room');
assert.equal(towerScreenFor({ ...stat(awaiting('event')), run_event_reveal: { node_id: 'event-1', choice_id: 'look' } }, false), 'room', 'event reveal keeps the room until the user returns');
assert.equal(towerScreenFor({ ...stat(awaiting('event')), run_event_reveal: { node_id: 'event-1', choice_id: 'look' } }, false, true), 'map', 'dismissed event reveal returns to the map');
const input = stat(awaiting('battle')), before = JSON.stringify(input);
assert.equal(towerScreenFor(stat({phase:'awaiting_choice',currentNode:null,lastNodeKind:null,act:2,floor:0,visitedNodeIds:['boss-1'],nodeContent:{'boss-1':{kind:'boss'}},opening:{phase:'pending'}}),true),'battle-reward','act transition clears lastNodeKind but completed boss loot still precedes the gift');
assert.equal(towerScreenFor(stat({phase:'won',lastNodeKind:'boss',currentNode:null}),true),'battle-reward');
towerScreenFor(input, false);
assert.equal(JSON.stringify(input), before, 'screen routing does not mutate its saved-state input');
console.log('PASS tower screen routing preserves reward priority, room/reveal return paths, and input immutability.');
