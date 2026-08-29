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

const deniedByAttachment = core.applyCardAttachment({
  ...attack,
  rarity: 'Common',
  effectProgram: { spec: 'mwg.effect/v1', steps: [] },
}, {
  id: 'sealed', kind: 'affliction', name: '封锁', scope: 'combat', appliedTurn: 1,
  source: { kind: 'enemy_action', id: 'seal' },
  changes: [{ kind: 'play_access', mode: 'deny' }],
});
assert.equal(core.prepareCardPlay(deniedByAttachment.id, { ...base, hand: [deniedByAttachment] }).code, 'RULE_DENIED');
const allowedCurse = core.applyCardAttachment({
  ...deniedByAttachment,
  id: 'curse', type: 'Curse', cost: undefined, attachments: [], patches: [], patchBase: undefined,
}, {
  id: 'permission', kind: 'enchantment', name: '解放', scope: 'combat', appliedTurn: 1,
  source: { kind: 'card', id: 'permission' },
  changes: [{ kind: 'play_access', mode: 'allow' }],
});
assert.equal(core.prepareCardPlay('curse', { ...base, hand: [allowedCurse] }).ok, true);

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

const compositeCard = { id: 'composite', name: '复合费用', type: 'Skill', cost: { energy: 1, stars: 2 } };
const compositeState = { ...base, hand: [compositeCard], resources: { stars: 3 } };
const compositePrepared = core.prepareCardPlay('composite', compositeState);
assert.equal(compositePrepared.ok, true);
assert.deepEqual(compositePrepared.payment.spent, { energy: 1, stars: 2 });
const compositeCommit = core.commitCardPlay(compositePrepared, compositeState);
assert.equal(compositeCommit.ok, true);
assert.equal(compositeCommit.energy, 2);
assert.deepEqual(compositeCommit.resources, { stars: 1 });
const insufficientComposite = core.prepareCardPlay('composite', { ...compositeState, resources: { stars: 1 } });
assert.equal(insufficientComposite.code, 'INSUFFICIENT_RESOURCE');
assert.deepEqual(insufficientComposite.effectiveCost, { energy: 1, stars: 2 });
assert.deepEqual(insufficientComposite.payment.waived, []);

const partialFreeRule = { ...freeRule, limit: 'all', freeResources: ['energy'] };
const partiallyFree = core.prepareCardPlay('composite', {
  ...compositeState,
  energy: 0,
  resources: { stars: 2 },
  cardPlayRules: [partialFreeRule],
});
assert.equal(partiallyFree.ok, true);
assert.deepEqual(partiallyFree.payment.spent, { energy: 0, stars: 2 });
const allFreeComposite = core.prepareCardPlay('composite', {
  ...compositeState,
  energy: 0,
  resources: { stars: 0 },
  cardPlayRules: [{ ...freeRule, limit: 'all' }],
});
assert.equal(allFreeComposite.ok, true);
assert.deepEqual(allFreeComposite.payment.spent, { energy: 0, stars: 0 });

const multiX = { id: 'multi_x', name: '多资源X', type: 'Attack', cost: { energy: 'all', stars: 'all' } };
const multiXPrepared = core.prepareCardPlay('multi_x', {
  ...base,
  hand: [multiX],
  energy: 3,
  resources: { stars: 2 },
});
assert.equal(multiXPrepared.ok, true);
assert.deepEqual(multiXPrepared.payment.xValues, { energy: 3, stars: 2 });
assert.deepEqual(multiXPrepared.payment.spent, { energy: 3, stars: 2 });

const stackedRules = core.resolveActiveCardPlayRules(
  [
    { ...replayRule, limit: 'all', extra: 12 },
    { ...replayRule, limit: 'all', extra: 12 },
    { ...freeRule, limit: 'all' },
  ],
  99,
);
assert.deepEqual(
  stackedRules,
  {
    free: true,
    extraReplays: 20,
    retainHand: false,
    retainBlock: false,
    denied: false,
    explicitlyAllowed: false,
    playLimitReached: false,
  },
  'replays stack but keep the safety cap',
);

console.log('Portable card play transactions re-read host state and preserve atomic intent.');
