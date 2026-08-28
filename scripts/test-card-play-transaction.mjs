import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const attack = { id: 'attack', name: '攻击', type: 'Attack', cost: 1 };
const fodder = { id: 'fodder', name: '代价', type: 'Skill', cost: 0 };
const generated = { id: 'generated', name: '弃牌触发生成', type: 'Skill', cost: 0 };
const base = {
  phase: 'player_turn',
  hasOpponent: true,
  hand: [attack, fodder],
  energy: 3,
  cardsPlayedThisTurn: 0,
  attacksPlayedThisTurn: 0,
  skillsPlayedThisTurn: 0,
  statusIds: [],
};

const prepared = core.prepareCardPlay('attack', base);
assert.equal(prepared.ok, true);
assert.equal(prepared.payment.spentEnergy, 1);

const committed = core.commitCardPlay(
  prepared,
  {
    ...base,
    // The host may finish presentation work against a newer hand/energy snapshot.
    hand: [attack, generated],
    energy: 4,
  },
);
assert.equal(committed.ok, true);
assert.deepEqual(committed.hand.map(card => card.id), ['generated']);
assert.equal(committed.energy, 3, 'payment must use the latest host energy');
assert.equal(committed.cardsPlayedThisTurn, 1);
assert.equal(committed.attacksPlayedThisTurn, 1);
assert.equal(committed.skillsPlayedThisTurn, 0);
assert.equal(committed.destination, 'discard');

assert.equal(core.prepareCardPlay('attack', { ...base, statusIds: ['dominated'] }).code, 'DOMINATED_ATTACK');
assert.equal(core.prepareCardPlay('attack', { ...base, stunned: true }).code, 'STUNNED');
assert.equal(core.prepareCardPlay('missing', base).code, 'CARD_NOT_FOUND');
assert.equal(core.prepareCardPlay('attack', { ...base, phase: 'enemy_turn' }).code, 'WRONG_PHASE');
assert.equal(core.prepareCardPlay('attack', { ...base, hasOpponent: false }).code, 'NO_OPPONENT');
assert.equal(core.prepareCardPlay('attack', { ...base, energy: 0 }).code, 'INSUFFICIENT_ENERGY');

const xCard = { id: 'x', name: '全力', type: 'Attack', cost: 'energy', doubleEffect: true };
const xPrepared = core.prepareCardPlay('x', { ...base, hand: [xCard], energy: 4, cardsPlayedThisTurn: 2 });
assert.equal(xPrepared.ok, true);
const xCommit = core.commitCardPlay(xPrepared, { ...base, hand: [xCard], energy: 4, cardsPlayedThisTurn: 2 });
assert.equal(xCommit.ok, true);
assert.equal(xCommit.payment.spentEnergy, 4);
assert.equal(xCommit.energy, 0);
assert.equal(xCommit.repeatCount, 2);
assert.equal(xCommit.cardsPlayedThisTurn, 3);
assert.equal(xCommit.attacksPlayedThisTurn, 1);
assert.equal(xCommit.skillsPlayedThisTurn, 0);

const skillPrepared = core.prepareCardPlay('fodder', base);
const skillCommit = core.commitCardPlay(skillPrepared, base);
assert.equal(skillCommit.ok, true);
assert.equal(skillCommit.cardsPlayedThisTurn, 1);
assert.equal(skillCommit.attacksPlayedThisTurn, 0);
assert.equal(skillCommit.skillsPlayedThisTurn, 1);

const replayRule = { type: 'card_play_rule', target: 'self', rule: 'replay', limit: 1, extra: 2 };
const firstReplay = core.prepareCardPlay('attack', { ...base, cardPlayRules: [replayRule] });
assert.equal(firstReplay.ok, true);
assert.equal(firstReplay.repeatCount, 3, 'the first card resolves once plus two extra replays');
const laterReplay = core.prepareCardPlay('attack', {
  ...base,
  cardsPlayedThisTurn: 1,
  cardPlayRules: [replayRule],
});
assert.equal(laterReplay.ok, true);
assert.equal(laterReplay.repeatCount, 1, 'a limited replay rule stops after the first card');

const freeRule = { type: 'card_play_rule', target: 'self', rule: 'free', limit: 2, extra: 0 };
const firstFree = core.prepareCardPlay('attack', { ...base, energy: 0, cardPlayRules: [freeRule] });
assert.equal(firstFree.ok, true);
assert.equal(firstFree.payment.spentEnergy, 0);
const thirdPaid = core.prepareCardPlay('attack', {
  ...base,
  energy: 0,
  cardsPlayedThisTurn: 2,
  cardPlayRules: [freeRule],
});
assert.equal(thirdPaid.ok, false);
assert.equal(thirdPaid.code, 'INSUFFICIENT_ENERGY');

const freeX = core.prepareCardPlay('x', {
  ...base,
  hand: [xCard],
  energy: 4,
  cardPlayRules: [{ ...freeRule, limit: 'all' }],
});
assert.equal(freeX.ok, true);
assert.equal(freeX.payment.spentEnergy, 0, 'a free X-cost card resolves with zero spent energy');
assert.equal(freeX.repeatCount, 2, 'free payment does not remove an existing one-shot double effect');

const stackedRules = core.resolveActiveCardPlayRules(
  [
    { ...replayRule, limit: 'all', extra: 12 },
    { ...replayRule, limit: 'all', extra: 12 },
    { ...freeRule, limit: 'all' },
  ],
  99,
);
assert.deepEqual(stackedRules, { free: true, extraReplays: 20 }, 'replays stack but keep the safety cap');

console.log('Portable card play transactions re-read host state and preserve atomic intent.');
