import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const bleed = {
  id: 'bleed',
  name: '流血',
  emoji: '🩸',
  type: 'debuff',
  stacks_change: -1,
  maxStacks: 12,
  triggers: { tick: { damage: 'stacks', to: 'self' } },
};
assert.equal(core.validateCompactStatusDefinition(bleed).ok, true);
assert.equal(core.validateCompactStatusDefinition({ ...bleed, triggers: { tick: 'ME.hp - stacks' } }).ok, false);
assert.equal(core.validateCompactStatusDefinition({ ...bleed, max_stacks: 12 }).ok, false);
assert.equal(core.validateCompactStatusDefinition({ ...bleed, triggers: { hold: { damage: 1 } } }).ok, false);

const echoState = {
  id: 'echo_state',
  name: '回响状态',
  emoji: '🔁',
  type: 'buff',
  stacks_change: 'keep',
  triggers: { hold: { card_rule: 'replay', limit: 'stacks', extra: 1 } },
};
assert.equal(core.validateCompactStatusDefinition(echoState).ok, true);
assert.equal(
  core.validateCompactStatusDefinition({ ...echoState, triggers: { tick: echoState.triggers.hold } }).ok,
  false,
  'card play rules are continuous hold effects, not tick effects',
);

const registry = new core.StatusDefinitionRegistry();
const loaded = registry.replace([bleed]);
assert.deepEqual(loaded.rejected, []);
assert.equal(loaded.loaded[0].maxStacks, 12);
assert.equal(registry.getTriggerEffects('bleed', 'tick')[0].spec, 'mwg.effect/v1');

console.log('Modern shallow status definitions passed.');
