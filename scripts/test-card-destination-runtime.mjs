import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { TavernEffectCommandHost } = require(resolve('src/fish/core/effectCommandHost.ts'));

const compiled = core.compileCompactEffectList([{ card_destination: 'draw_top' }]);
assert.equal(compiled.ok, true, compiled.ok ? '' : JSON.stringify(compiled.issues));
assert.deepEqual(compiled.value.steps, [{ op: 'set_card_destination', destination: 'draw_top' }]);
assert.match(core.effectProgramToDisplayTags(compiled.value)[0].text, /抽牌堆顶部/);
assert.equal(core.compileCompactEffectList([{ card_destination: 'void' }]).ok, false);

const stateView = {
  self: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  opponent: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
  currentTurn: 1, cardsPlayedThisTurn: 0, attacksPlayedThisTurn: 0, skillsPlayedThisTurn: 0,
};
let hostDestination = null;
const host = new TavernEffectCommandHost({
  readState: () => structuredClone(stateView),
  isTerminal: () => false,
  executeCardCommand: async () => {},
  presentCommand: () => {},
  executeBattleCommand: async () => {},
  forEachEnemyTarget: async () => {},
  applyStatus: async () => {},
  removeStatuses: async () => {},
  registerAbility: async () => {},
  scheduleEffect: async () => {},
  setCardDestination: async destination => { hostDestination = destination; },
  narrate: async () => {},
});
await host.executeProgram(compiled.value, true);
assert.equal(hostDestination, 'draw_top');

const card = {
  id: 'returning', name: '回返', type: 'Skill', cost: 1,
  effectProgram: { spec: core.EFFECT_PROGRAM_SPEC, steps: [{ op: 'set_card_destination', destination: 'draw_top' }] },
};
const playState = {
  phase: 'player_turn', hasOpponent: true, hand: [card], energy: 3,
  cardsPlayedThisTurn: 0, attacksPlayedThisTurn: 0, skillsPlayedThisTurn: 0,
};
const gate = new core.BattleSessionActionGate();
let override = null;
let moved = null;
let committedState = playState;
const result = await core.playBattleSessionCard('returning', {
  gate,
  beginTransaction: () => structuredClone(committedState),
  commitTransaction: () => {},
  rollbackTransaction: snapshot => { committedState = snapshot; },
  readCardPlayState: () => committedState,
  isTerminal: () => false,
  applyCardPlayCommit: committed => { committedState = { ...committedState, ...committed }; },
  beginCardTransit: () => {},
  endCardTransit: () => {},
  executeCardEffect: () => { override = 'draw_top'; },
  resolvePlayedCardDestination: (_entry, defaultDestination) => override || defaultDestination,
  movePlayedCard: (_entry, destination) => { moved = destination; },
  triggerPostCardPlay: () => {},
});
assert.equal(result.status, 'completed');
assert.equal(result.destination, 'draw_top');
assert.equal(moved, 'draw_top');

const battle = core.createEmptyBattleState();
const store = new core.BattleStateStore(battle);
const fullHand = Array.from({ length: 10 }, (_, index) => ({ ...card, id: `h${index}`, name: `h${index}` }));
store.updatePlayer({ hand: fullHand });
assert.equal(store.placeResolvedCard({ ...card, id: 'overflow' }, 'hand'), 'discard');
assert.equal(store.getPlayer().discardPile.at(-1).id, 'overflow', 'return-to-hand safely falls back when the hand is full');
assert.equal(store.placeResolvedCard({ ...card, id: 'top' }, 'draw_top'), 'draw_top');
assert.equal(store.placeResolvedCard({ ...card, id: 'bottom' }, 'draw_bottom'), 'draw_bottom');
assert.deepEqual(store.getPlayer().drawPile.map(entry => entry.id), ['bottom', 'top']);
assert.equal(store.placeResolvedCard({ ...card, id: 'gone' }, 'remove'), 'remove');
assert.equal(
  [...store.getPlayer().hand, ...store.getPlayer().drawPile, ...store.getPlayer().discardPile].some(entry => entry.id === 'gone'),
  false,
);

console.log('Card effects can replace their post-resolution destination through the shared command host and transaction coordinator.');
