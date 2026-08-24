import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { diagnoseDescriptionEffects } = require(resolve('src/game-core/index.ts'));

assert.deepEqual(
  diagnoseDescriptionEffects({ description: '造成8点伤害，获得3点格挡。', effects: [{ damage: 6 }, { block: 3 }] }),
  [{ field: 'damage', described: 8, actual: 6, message: '描述写8点伤害，但 effects.damage 为 6' }],
);
assert.equal(
  diagnoseDescriptionEffects({ description: '抽2张牌并获得1点能量。', effects: [{ draw: 2 }, { energy: 2 }] })[0].field,
  'energy',
);
assert.deepEqual(
  diagnoseDescriptionEffects({ description: '根据能量造成伤害。', effects: [{ damage: 'spent_energy * 4' }] }),
  [],
  'formula-driven prose must not be guessed',
);
assert.deepEqual(
  diagnoseDescriptionEffects({ description: '造成3点伤害两次。', effects: [{ damage: 3 }, { damage: 3 }] }),
  [],
  'repeated operations are intentionally ambiguous',
);
assert.deepEqual(diagnoseDescriptionEffects({ description: '造成8点伤害。' }), []);

console.log('Description diagnostics warn only on unambiguous shallow literal mismatches.');
