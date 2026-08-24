import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const definitions = require(resolve('src/game-core/statusDefinitionRuntime.ts'));

const valid = {
  id: 'star_guard',
  name: '星之守护',
  emoji: '⭐',
  type: 'buff',
  stacks_change: 'x0.5',
  maxStacks: 8,
  triggers: {
    apply: { block: 2 },
    tick: [{ block: 'stacks' }, { heal: 1 }],
    hold: { modify: 'block', add: 'stacks * 2' },
  },
};
const normalized = definitions.normalizeRuntimeStatusDefinition(valid);
assert.match(normalized.description, /首次获得时/);
assert.match(normalized.description, /最多叠加8层/);
assert.equal(normalized.maxStacks, 8);
assert.deepEqual(normalized.triggers.tick[0].steps, [
  { op: 'gain_block', target: 'self', amount: { op: 'var', path: 'context.status_stacks' } },
  { op: 'heal', target: 'self', amount: 1 },
]);
assert.equal(normalized.triggers.hold[0].steps[0].op, 'modify');

for (const invalid of [
  { ...valid, id: 'bad id' },
  { ...valid, type: 'ens' },
  { ...valid, stacks_change: 'halve' },
  { ...valid, maxStacks: 0 },
  { ...valid, max_stacks: 8 },
  { ...valid, triggers: { turn_end: { damage: 1 } } },
  { ...valid, triggers: { tick: 'ME.hp - stacks' } },
  { ...valid, stun: 'yes' },
]) assert.equal(definitions.normalizeRuntimeStatusDefinition(invalid), null);

const managerSource = readFileSync(resolve('src/fish/combat/dynamicStatusManager.ts'), 'utf8');
assert.match(managerSource, /new StatusDefinitionRegistry\(\)/);
assert.doesNotMatch(managerSource, /insertOrAssignCurrentMessageVariables|saveToMVU|Date\.now|createdAt/);

console.log('Dynamic status definitions keep one modern program registry.');
