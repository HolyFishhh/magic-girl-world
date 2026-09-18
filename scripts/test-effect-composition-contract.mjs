import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { compileCompactEffectList } = require('../src/game-core/compactEffectDsl.ts');
const { effectCompositionContract } = require('../src/game-core/effectCompositionContract.ts');
const { formatCompactEffectAuthoringContract } = require('../src/game-core/towerRequest.ts');
const compile = value => {
  const result = compileCompactEffectList(value);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  return result.value.steps;
};
const condition = 'self.hp > 10';
const bundled = compile({ damage: 9, apply_status: 'echo', stacks: 1, to: 'self', when: condition });
assert.equal(bundled.length, 1);
assert.equal(bundled[0].op, 'if');
assert.equal(bundled[0].then.length, 2);
assert.deepEqual(bundled[0].then.map(x => x.target), ['self', 'self']);
const split = compile([{ damage: 9 }, { apply_status: 'echo', stacks: 1, to: 'self', when: condition }]);
assert.equal(split.length, 2);
assert.equal(split[0].op, 'damage');
assert.equal(split[0].target, 'opponent');
assert.equal(split[1].op, 'if');
assert.equal(split[1].then[0].target, 'self');
assert.deepEqual(compile({ damage: 9, block: 3 }).map(x => x.target), ['opponent', 'self']);
assert.deepEqual(compile({ block: 3, damage: 9 }), compile({ damage: 9, block: 3 }), 'object key order does not schedule effects');
assert.deepEqual(compile([{ block: 3 }, { damage: 9 }]).map(x => x.op), ['gain_block', 'damage']);
assert.equal(compileCompactEffectList({ damage: 9, block: 3, hits: 2 }).ok, false);
assert.equal(compile({ damage: 9, hits: 2 }).length, 2);
// A repeated guard is two evaluations; it is not a single conditional transaction.
const paymentGuard = 'self.resource.pressure.current >= 2';
const paymentChain = compile([
  { resource: { id: 'pressure', amount: -2 }, to: 'self', when: paymentGuard },
  { draw: 1, when: paymentGuard },
]);
assert.deepEqual(paymentChain.map(x => x.op), ['if', 'if']);
assert.equal(compileCompactEffectList({ resource: { id: 'pressure', amount: -2 }, draw: 1, when: paymentGuard }).ok, false,
  'resource is not a supported bundle operation; do not promise this as a working conditional group');
assert.equal(compileCompactEffectList({ when: paymentGuard, effects: [{ resource: { id: 'pressure', amount: -2 } }, { draw: 1 }] }).ok, false,
  'a guarded sequential group is currently unavailable in the authored protocol');
const shared = effectCompositionContract();
const worldbook = readFileSync('worldbook_new/2战斗内容生成要求.md', 'utf8').replaceAll('\r\n', '\n');
assert.equal(worldbook.split('<!-- shared:effect-composition -->\n')[1].split('\n<!-- /shared:effect-composition -->')[0], shared);
for (const placement of ['runtime', 'initial-draft']) {
  assert.equal(formatCompactEffectAuthoringContract(placement).split(shared).length, 2);
}
console.log('PASS actual compiler: grouped condition/target, independent defaults, object vs array order, hits boundary; shared worldbook/request contract.');
