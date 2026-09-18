import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { profileDeckArchetypes, scoreContentArchetypes } = require('../src/game-core/archetypeGraph.ts');
const { createContentPack } = require('../src/game-core/contentPack.ts');
const { compileCompactEffectList } = require('../src/game-core/compactEffectDsl.ts');
const card = (id, effects, extra = {}) => ({ id, name: id, type: 'Skill', cost: 1, effects, ...extra });
const ids = definition => scoreContentArchetypes(definition).map(value => value.id);
const compile = definition => {
  const compiled = compileCompactEffectList(definition.effects, { creates: definition.creates });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.issues));
  const result = { ...definition, effectProgram: compiled.value };
  delete result.effects;
  delete result.creates;
  return result;
};
const summon = card('call', { spawn_summon: { id: 'familiar', name: '伙伴', emoji: '◇', max_hp: 24, block: 0, slot: 'core', actions: [
  { id: 'hit', name: '攻击', effects: { damage: 7 } },
  { id: 'guard', name: '防守', effects: { block: 5 } },
] } }, { quantity: 2 });
const support = card('reinforce', { modify_summon_effect: { selector: { template_id: 'familiar' }, stat: 'damage', add: 2 } }, { quantity: 2 });
const compact = createContentPack({ cards: [
  summon, support,
  card('starter', { damage: 6 }, { type: 'Attack', quantity: 3 }),
  card('filter', [{ discard: 1 }, { draw: 1 }]),
  card('supply', [{ resource: { id: 'fuel', amount: 2 } }, { draw: 1 }]),
  card('burst', { damage: '6 + self.resource.fuel.current * 3' }),
], relics: [{ id: 'repair', name: 'repair', trigger: { on: 'turn_start', effects: { heal_summon: { selector: { template_id: 'familiar' }, amount: 3 } } } }] });
const before = JSON.stringify(compact);
const profile = profileDeckArchetypes(compact);
assert.equal(profile.primary[0], 'summon-engine', 'a summon and its same-template support are the main engine');
for (const falseFamily of ['discard-payoff', 'thin-deck', 'on-hit-engine', 'block-retention', 'retaliation', 'reactive-control', 'multi-hit']) {
  assert.ok(!profile.affinities.some(value => value.id === falseFamily), `${falseFamily} requires its own executable distinction`);
}
assert.deepEqual(profile.affinities.find(value => value.id === 'discard-engine').supportingCards, ['filter'], 'filtering does not recruit every damage/draw/trigger card');
assert.ok(!profile.affinities.find(value => value.id === 'direct-pressure')?.supportingCards.includes('call'), 'the familiar attack belongs to its summon engine');
assert.equal(JSON.stringify(compact), before, 'recognition cannot mutate execution or save data');
assert.deepEqual(profileDeckArchetypes(JSON.parse(before)), profile, 'save and restore preserve evidence');
const compiled = createContentPack({ ...compact, cards: compact.cards.map(compile) });
assert.deepEqual(profileDeckArchetypes(compiled).affinities.map(value => [value.id, value.share]), profile.affinities.map(value => [value.id, value.share]), 'compiled cards preserve classification and ownership');
const withoutStarters = createContentPack({ ...compact, cards: compact.cards.filter(value => value.id !== 'starter') });
assert.deepEqual(profileDeckArchetypes(withoutStarters).affinities, profile.affinities, 'starter exclusion is recognition-only and stable before and after removal');

// Distinct choices/actions, unrelated references, and display names cannot make a loop.
for (const definition of [
  card('two_options', { choose: 'option', options: [{ id: 'a', label: 'a', effects: { damage: 8 } }, { id: 'b', label: 'b', effects: { damage: 9 } }] }),
  card('one_hit', { damage: 8 }),
]) for (const value of [definition, compile(definition)]) assert.ok(!ids(value).includes('multi-hit'));
for (const value of [card('hits', [{ damage: 4 }, { damage: 4 }]), card('hits', { damage: 4, hits: 2 })]) {
  assert.ok(ids(value).includes('multi-hit'));
  assert.ok(ids(compile(value)).includes('multi-hit'));
}
for (const value of [card('payoff', { damage: 'cards_discarded_this_turn * 4' }), { id: 'discard_trigger', type: 'Power', trigger: { on: 'on_discard', effects: { energy: 1 } } }]) assert.ok(ids(value).includes('discard-payoff'));
assert.ok(!ids(card('ordinary_trigger', { block: 7 }, { trigger: { on: 'turn_start', effects: { draw: 1 } } })).includes('discard-payoff'));
const unused = card('unused', { draw: 1 }, { creates: [summon, card('fake', { discard: 2 })], metadata: { effects: { discard: 9 } } });
assert.ok(!ids(unused).some(id => id.startsWith('summon-') || id.startsWith('discard-')), 'unused templates and metadata do not execute');
const wrongIdentity = profileDeckArchetypes(createContentPack({ cards: [summon, card('other', { modify_summon_effect: { selector: { template_id: 'other_familiar' }, stat: 'damage', add: 3 } })] }));
assert.ok(!wrongIdentity.affinities.find(value => value.id === 'summon-single-core').supportingCards.includes('other'));
const sameNames = createContentPack({ ...compact, cards: compact.cards.map(value => ({ ...value, name: 'same' })), relics: compact.relics.map(value => ({ ...value, name: 'same' })) });
assert.deepEqual(profileDeckArchetypes(sameNames).affinities.map(value => [value.id, value.share]), profile.affinities.map(value => [value.id, value.share]), 'renaming distinct cards to the same name cannot merge their votes');
const scatter = profileDeckArchetypes(createContentPack({ cards: [summon, card('utility', { narrate: 'nothing numerical' })] }));
assert.equal(scatter.scatterShare, 33.3, 'unmatched instances keep their budget despite overlapping summon labels');
assert.ok(Math.abs(scatter.affinities.reduce((sum, value) => sum + value.share, scatter.scatterShare) - 100) <= 0.3);
console.log('PASS executable archetype evidence: ownership, identities, event-specific payoffs, compiled parity, save stability and bounded shares.');

// Binary form is not an enemy debuff, stack engine or expiration cashout.
const form = {id:'demon_form',name:'恶魔形态',emoji:'😈',type:'buff',maxStacks:1,triggers:{hold:{modify:'damage',multiply:1.5},turn_start:{remove_status:'demon_form',when:'self.resource.fuel.current <= 0'},turn_end:{resource:{id:'fuel',amount:-2}}}};
const formDeck = createContentPack({cards:[card('transform',{apply_status:'demon_form',to:'self'},{cost:{fuel:5}}),card('payoff',{damage:'self.status.demon_form.stacks > 0 ? 18 : 6'},{quantity:3}),card('shield',{block:'self.status.demon_form.stacks > 0 ? 10 : 4'})],statuses:[form]});
for(const pack of [formDeck,createContentPack({...formDeck,cards:formDeck.cards.map(compile)}),JSON.parse(JSON.stringify(formDeck))]) {
 const p=profileDeckArchetypes(pack);
 assert.equal(p.primary[0],'status-form-engine',JSON.stringify(p.affinities));
 for(const id of ['enemy-status-benefit','status-detonation','status-conversion','status-stack']) assert.ok(!p.affinities.some(a=>a.id===id),id);
}
console.log('PASS binary form primary / enemy ownership / expiration / compact-compiled parity');

const genericDebuffGuard=card('debuff_guard',{block:6,when:'opponent.has_debuff'});
for(const definition of [genericDebuffGuard,compile(genericDebuffGuard),JSON.parse(JSON.stringify(genericDebuffGuard))]) {
 assert.ok(ids(definition).includes('enemy-status-benefit'),'generic enemy debuff condition has executable payoff');
}
assert.ok(!ids(card('self_buff_guard',{block:6,when:'self.has_buff'})).includes('enemy-status-benefit'),'self status is not enemy status');
assert.ok(!ids(card('prose_only',{block:6},{description:'opponent.has_debuff'})).includes('enemy-status-benefit'),'flavor text is not executable status evidence');
