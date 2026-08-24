import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { countCardOwnership, getCardSourceId } = require(resolve('src/game-core/cardRules.ts'));

const played = { id: 'strike_runtime', originalId: 'strike', name: 'Strike' };
assert.equal(getCardSourceId(played), 'strike');
assert.deepEqual(
  Object.fromEntries(countCardOwnership([], new Map([['strike', 1]]))),
  { strike: 1 },
  'an in-flight card must not look missing to MUV synchronization',
);
assert.deepEqual(
  Object.fromEntries(
    countCardOwnership(
      [played, { id: 'guard_runtime', originalId: 'guard', name: 'Guard' }],
      new Map([
        ['strike', 1],
        ['guard', 0],
      ]),
    ),
  ),
  { strike: 2, guard: 1 },
);

console.log('Persistent piles and in-flight card reservations share one ownership count.');
