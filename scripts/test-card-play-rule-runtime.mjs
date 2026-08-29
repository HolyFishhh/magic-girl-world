import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const state = {
  self: { hp: 30, maxHp: 30, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  opponent: { hp: 30, maxHp: 30, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  currentTurn: 2,
  cardsPlayedThisTurn: 0,
  attacksPlayedThisTurn: 0,
  skillsPlayedThisTurn: 0,
};
const rule = (kind, fields = {}) => ({
  type: 'card_play_rule',
  target: 'self',
  rule: kind,
  extra: 0,
  priority: 0,
  ...fields,
});
const selector = filter => ({ zone: 'hand', pick: 'all', filter });

const continuous = core.resolveActiveCardPlayRules([
  rule('retain_hand'),
  rule('retain_block'),
  rule('limit_draw', { limit: 0 }),
  rule('limit_block_gain', { limit: 4 }),
  rule('limit_energy_gain', { limit: 1 }),
], 0);
assert.equal(continuous.retainHand, true);
assert.equal(continuous.retainBlock, true);
assert.equal(continuous.drawLimit, 0, 'zero is a valid rule limit');
assert.equal(continuous.blockGainLimit, 4);
assert.equal(continuous.energyGainLimit, 1);

const ordinary = { id: 'ordinary', name: 'Ordinary', type: 'Skill', cost: 1 };
const ethereal = { id: 'ethereal', name: 'Ethereal', type: 'Skill', cost: 1, ethereal: true };
const retained = { id: 'retained', name: 'Retained', type: 'Skill', cost: 1, retain: true };
assert.deepEqual(core.resolveTurnEndHandDisposition([ordinary, ethereal, retained], true), {
  keep: [ordinary, retained],
  discard: [],
  exhaust: [ethereal],
}, 'retain_hand keeps the hand while Ethereal still exhausts');

const attack = { id: 'attack', name: 'Attack', type: 'Attack', rarity: 'Common', cost: 1, tags: ['strike'], templateId: 'attack' };
const skill = { id: 'skill', name: 'Skill', type: 'Skill', rarity: 'Common', cost: 1, tags: ['guard'], templateId: 'skill' };
const curse = { id: 'curse', name: 'Curse', type: 'Curse', rarity: 'Corrupt', cost: 0, tags: ['hex'], templateId: 'curse' };
const basePlayState = {
  phase: 'player_turn',
  hasOpponent: true,
  hand: [attack, skill, curse],
  energy: 3,
  cardsPlayedThisTurn: 0,
  attacksPlayedThisTurn: 0,
  skillsPlayedThisTurn: 0,
  statusIds: [],
};

const denyAttacks = rule('deny_card_play', { selector: selector({ types: ['Attack'] }) });
assert.equal(core.prepareCardPlay('attack', { ...basePlayState, cardPlayRules: [denyAttacks] }).code, 'RULE_DENIED');

const allowCurse = rule('allow_card_play', { selector: selector({ types: ['Curse'] }) });
assert.equal(core.prepareCardPlay('curse', { ...basePlayState, cardPlayRules: [allowCurse] }).ok, true);
const allowSkill = rule('allow_card_play', { selector: selector({ tags: ['guard'] }) });
assert.equal(core.prepareCardPlay('skill', { ...basePlayState, statusIds: ['silenced'], cardPlayRules: [allowSkill] }).ok, true);

const limitAttacks = rule('limit_card_play', { limit: 1, selector: selector({ types: ['Attack'] }) });
assert.equal(core.prepareCardPlay('attack', {
  ...basePlayState,
  cardPlayRules: [limitAttacks],
  playedCardsThisTurn: [attack],
}).code, 'RULE_LIMIT_REACHED');
assert.equal(core.prepareCardPlay('skill', {
  ...basePlayState,
  cardPlayRules: [limitAttacks],
  playedCardsThisTurn: [attack],
}).ok, true, 'filtered play limits do not consume unrelated cards');

const destinationRules = [
  rule('card_destination', { selector: selector({ types: ['Attack'] }), destination: 'exhaust', priority: 1 }),
  rule('card_destination', { selector: selector({ tags: ['strike'] }), destination: 'draw_top', priority: 20 }),
  rule('card_destination', { selector: selector({ types: ['Attack'] }), destination: 'discard', priority: 5 }),
];
assert.equal(core.prepareCardPlay('attack', { ...basePlayState, cardPlayRules: destinationRules }).destination, 'draw_top');

const compactCases = [
  { card_rule: 'retain_hand' },
  { card_rule: 'retain_block' },
  { card_rule: 'limit_draw', limit: 0 },
  { card_rule: 'limit_block_gain', limit: 3 },
  { card_rule: 'limit_energy_gain', limit: 1 },
  { card_rule: 'deny_card_play', card_type: 'Attack' },
  { card_rule: 'allow_card_play', card_type: 'Curse' },
  { card_rule: 'limit_card_play', limit: 2, tag: 'strike' },
  { card_rule: 'card_destination', destination: 'exhaust', priority: 5, rarity: 'Rare' },
];
for (const compact of compactCases) {
  const compiled = core.compileCompactEffectList([compact]);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.issues));
  assert.deepEqual(core.validateEffectProgram(compiled.value), { ok: true, value: compiled.value });
}
for (const invalid of [
  { card_rule: 'retain_hand', limit: 1 },
  { card_rule: 'limit_draw' },
  { card_rule: 'card_destination' },
  { card_rule: 'deny_card_play', destination: 'discard' },
]) assert.equal(core.compileCompactEffectList([invalid]).ok, false);

const passive = {
  id: 'persistent-rule',
  name: 'Persistent rule',
  trigger: 'passive',
  effectProgram: {
    spec: core.EFFECT_PROGRAM_SPEC,
    steps: [{ op: 'card_play_rule', target: 'self', rule: 'retain_block' }],
  },
};
const store = new core.BattleStateStore();
store.updatePlayer({ abilities: [passive] });
store.createSnapshot('rules');
store.updatePlayer({ abilities: [] });
assert.equal(store.restoreSnapshot('rules'), true);
const restoredEvents = core.resolvePassiveCardPlayRules(store.getPlayer().abilities, 'player', 'player', state).map(entry => entry.rule);
assert.equal(core.resolveActiveCardPlayRules(restoredEvents, 0).retainBlock, true, 'continuous rules survive rollback snapshots');

const compactSchema = JSON.parse(await readFile(resolve('schemas/mwg-card-effects-v1.schema.json'), 'utf8'));
const astSchema = JSON.parse(await readFile(resolve('schemas/mwg-effect-v1.schema.json'), 'utf8'));
for (const name of ['retain_hand', 'retain_block', 'limit_draw', 'limit_block_gain', 'limit_energy_gain', 'deny_card_play', 'allow_card_play', 'limit_card_play', 'card_destination']) {
  assert.equal(compactSchema.$defs.cardPlayRuleEffect.properties.card_rule.enum.includes(name), true);
  assert.equal(astSchema.$defs.cardPlayRuleEffect.properties.rule.enum.includes(name), true);
}

const cardSystemSource = await readFile(resolve('src/fish/combat/cardSystem.ts'), 'utf8');
assert.doesNotMatch(cardSystemSource, /if \(card\.type === 'Curse'\)/, 'the runtime must not re-block a card accepted by allow_card_play');

console.log('Generic continuous card rules cover retention, resource caps, play gates, destinations, persistence, and strict contracts.');
