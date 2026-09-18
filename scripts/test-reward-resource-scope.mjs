import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { validateRewardCandidateAgainstLibrary: validate } = require('../src/game-core/rewardCandidateValidation.ts');
const summon = {
  id: 'familiar', name: '使魔', emoji: '✨', has_hp: true, max_hp: 10,
  resources: { charge: { name: '充能', emoji: '✨', start: 0, max: 5, refresh: 'retain' } },
  actions: [{ id: 'shield', name: '充能护盾', when: 'self.resource.charge.current >= 1', effects: { block: 1, to: 'self' } }],
  abilities: [{ id: 'charge_tick', name: '充能', trigger: { on: 'turn_start', effects: { resource: { id: 'charge', amount: 1 } } } }],
};
const card = { id: 'call', name: '召来使魔', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { spawn_summon: summon } };
const before = structuredClone(card);
const localResult = validate('cards', card, { knownResourceIds: ['essence'] });
assert.equal(localResult.ok, true, `summon local resource must not require a player definition: ${JSON.stringify(localResult)}`);
assert.deepEqual(card, before);
const missingLocal = structuredClone(card);
delete missingLocal.effects.spawn_summon.resources.charge;
assert.match(validate('cards', missingLocal, { knownResourceIds: ['charge'] }).message, /未注册资源: charge/, 'player pool cannot satisfy a missing summon resource');
const summoner = structuredClone(card);
summoner.effects.spawn_summon.abilities[0].trigger.effects = { summoner_effects: { resource: { id: 'essence', amount: 1 } } };
assert.equal(validate('cards', summoner, { knownResourceIds: ['essence'] }).ok, true);
assert.match(validate('cards', summoner, { knownResourceIds: ['charge'] }).message, /未注册资源: essence/, 'summoner_effects returns to the player pool');
const opponent = { ...card, effects: { damage: 'opponent.resource.enemy_charge.current' } };
assert.equal(validate('cards', opponent, { knownResourceIds: [] }).ok, true, 'opponent references cannot be validated against the player pool');
const playerMissing = { ...card, effects: { resource: { id: 'charge', amount: 1 } } };
assert.match(validate('cards', playerMissing, { knownResourceIds: [] }).message, /未注册资源: charge/);
const sourceResource = structuredClone(card);
sourceResource.effects.spawn_summon.actions[0].effects = { summon_resource: { selector: { pick: 'source' }, id: 'charge', amount: 1 } };
assert.equal(validate('cards', sourceResource, { knownResourceIds: [] }).ok, true);
delete sourceResource.effects.spawn_summon.resources.charge;
assert.match(validate('cards', sourceResource, { knownResourceIds: ['charge'] }).message, /未注册资源: charge/);
const generated = structuredClone(card);
generated.creates = [{ id: 'generated', name: '充能牌', type: 'Skill', rarity: 'Common', cost: 0,
  effects: { resource: { id: 'essence', amount: 1 } } }];
generated.effects.spawn_summon.actions[0].effects = { add_card: 'generated', to: 'hand' };
const generatedResult = validate('cards', generated, { knownResourceIds: ['essence'] });
assert.equal(generatedResult.ok, true, JSON.stringify(generatedResult));
assert.match(validate('cards', generated, { knownResourceIds: ['charge'] }).message, /未注册资源: essence/,
  'generated player cards do not inherit the summoning actor resource pool');
console.log('Reward resource ownership: local summon, missing local, summoner, opponent and player scopes passed.');
