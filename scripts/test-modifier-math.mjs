import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const modifier = require(resolve('src/game-core/modifierMath.ts'));

assert.equal(modifier.applyModifierOperation(10, { operator: '+', value: 2 }), 12);
assert.equal(modifier.applyModifierOperation(10, { operator: '/', value: 0 }), 10);

const breakdown = { add: 0, mul: 1 };
modifier.addModifierOperation(breakdown, { operator: '+', value: 2 });
modifier.addModifierOperation(breakdown, { operator: '-', value: 0.5 });
modifier.addModifierOperation(breakdown, { operator: '*', value: 1.5 });
modifier.addModifierOperation(breakdown, { operator: '/', value: 2 });
modifier.addModifierOperation(breakdown, { operator: '=', value: 99 });
assert.deepEqual(modifier.roundModifierBreakdown(breakdown), { add: 1.5, mul: 0.8 });

const state = {
  self: { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 2 },
  opponent: { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  cardsPlayedThisTurn: 0,
};
assert.deepEqual(
  modifier.resolveEffectProgramModifiers(
    {
      spec: 'mwg.effect/v1',
      steps: [
        { op: 'modify', target: 'self', stat: 'damage', operator: 'add', value: 2 },
        {
          op: 'if',
          condition: { op: 'compare', relation: 'gte', left: { op: 'var', path: 'self.block' }, right: 2 },
          then: [
            {
              op: 'modify',
              target: 'opponent',
              stat: 'block',
              operator: 'multiply',
              value: { op: 'var', path: 'context.status_stacks' },
            },
          ],
        },
      ],
    },
    state,
    { spentEnergy: 0, statusStacks: 3 },
  ),
  [
    { target: 'self', stat: 'damage', operation: { operator: '+', value: 2 } },
    { target: 'opponent', stat: 'block', operation: { operator: '*', value: 3 } },
  ],
);

console.log('Typed modifier programs and aggregation passed.');
