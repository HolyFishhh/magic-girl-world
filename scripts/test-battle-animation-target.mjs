import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { resolveCombatAnimationTarget } = require(resolve('src/fish/ui/animationManager.ts'));

const program = steps => ({ spec: 'mwg.effect/v1', steps });

assert.equal(resolveCombatAnimationTarget(program([{ op: 'damage', target: 'opponent', amount: 6 }]), 'attack'), 'opponent');
assert.equal(resolveCombatAnimationTarget(program([{ op: 'gain_block', target: 'self', amount: 5 }]), 'skill'), 'self');
assert.equal(resolveCombatAnimationTarget(program([{ op: 'apply_status', target: 'opponent', status: 'x', stacks: 1 }]), 'skill'), 'opponent');
assert.equal(resolveCombatAnimationTarget(program([{ op: 'draw_cards', amount: 1 }]), 'skill'), 'self');
assert.equal(
  resolveCombatAnimationTarget(
    program([{ op: 'if', condition: { op: 'compare', relation: 'gt', left: 1, right: 0 }, then: [{ op: 'gain_lust', target: 'opponent', amount: 2 }] }]),
    'power',
  ),
  'opponent',
);

console.log('Battle theater resolves self and opponent animation anchors from the shared effect program.');
