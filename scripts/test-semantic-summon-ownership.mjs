import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { auditInitialSemanticStructure: audit } = require('../src/game-core/initialSemanticAudit.ts');

const fixture = () => ({
  spec: 'mwg.initial-draft/v1', narrative: 'unchanged story',
  player: { core: {}, cards: [{ id: 'gain', effects: { resource: { id: 'charge', amount: 1 } } }] },
  opening: { choices: [] }, registry: { statuses: [], templates: [], resources: [
    { id: 'charge', name: '充能', emoji: '⚡', start: 0, max: 5, refresh: 'retain' },
  ] },
});
const spawn = (effects, to) => ({
  spawn_summon: { id: 'pet', name: 'Pet', emoji: '✨', resources: { charge: { current: 0, max: 5 } },
    actions: [{ id: 'act', name: 'Act', effects }] },
  ...(to ? { to } : {}),
});
const missing = report => report.observations.filter(o => o.code === 'NO_OWNED_RESOURCE_USE');
function run(effect) {
  const draft = fixture();
  draft.player.cards.push({ id: 'summon', effects: effect });
  const before = structuredClone(draft), report = audit(draft);
  assert.deepEqual(draft, before);
  assert.equal(report.truncated, false);
  return report;
}

let r = run(spawn({ damage: 3 }));
assert.equal(r.unexpandedPaths.length, 0, 'inline summon programs are expanded');
assert.equal(missing(r).length, 1, 'irrelevant summon does not mask an unused player resource');
for (const to of [undefined, 'opponent']) {
  r = run(spawn({ damage: 'self.resource.charge.current' }, to));
  assert.equal(missing(r).length, 1, 'summon own stock is never player stock');
  const read = r.facts.find(f => f.kind === 'resource_read');
  assert.ok(read.actor.startsWith('spawn_summon:'));
  r = run(spawn({ summoner_effects: { damage: 'self.resource.charge.current' } }, to));
  assert.equal(missing(r).length, to ? 1 : 0, 'recipient side determines the concrete owner, not the caster');
  assert.equal(r.facts.find(f => f.kind === 'resource_read').actor, to ? 'opponent' : 'player');
  r = run(spawn({ damage: 'opponent.resource.charge.current' }, to));
  assert.equal(missing(r).length, to ? 0 : 1, 'enemy summon opponent is player; ally summon opponent is not');
}

// A summon created by another summon still belongs to a combatant, not to the parent pet.
r = run(spawn(spawn({ summoner_effects: { damage: 'self.resource.charge.current' } })));
assert.equal(missing(r).length, 0);
r = run(spawn(spawn({ summoner_effects: { damage: 'self.resource.charge.current' } }, 'opponent')));
assert.equal(missing(r).length, 1);

// Spawn count is evaluated by the creating source, before the new unit exists.
const counted = spawn({ damage: 3 });
counted.spawn_summon.count = 'self.resource.charge.current';
assert.equal(missing(run(counted)).length, 0);

// References reached through a summon must retain the holder, not inherit a stale summoner.
const draft = fixture();
draft.registry.statuses = [{ id: 'read', triggers: { turn_start: { block: 'self.resource.charge.current' } } }];
draft.player.cards.push({ id: 'spawn', effects: spawn({ apply_status: 'read', to: 'opponent' }, 'opponent') });
r = audit(draft);
assert.equal(missing(r).length, 0);
assert.equal(r.facts.find(f => f.kind === 'resource_read').actor, 'player');

for (const effect of [
  { copy_summon: { owner: 'opponent', pick: 'all' }, to: 'self' },
  { apply_summon_status: { id: 'read', stacks: 1 }, selector: { owner: 'self', pick: 'all' } },
  { spawn_enemy: { id: 'enemy', actions: [{ effects: { damage: 1 } }] } },
]) {
  r = run(effect);
  assert.ok(r.unexpandedPaths.length, 'dynamic or otherwise unexpanded ownership is explicit');
  assert.equal(missing(r).length, 0, 'partial graphs do not assert absence');
}
r = run({ apply_status: 'missing', to: 'self' });
assert.ok(r.references.length);
assert.equal(missing(r).length, 0, 'unresolved definitions cannot establish absence');
console.log('PASS inline summon ownership, side, nested creation, creator formula and status references; dynamic relations stay unknown; no mutation or acceptance gate.');
