import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const selection = require(resolve('src/game-core/cardSelection.ts'));

const interactive = selection.planCardSelection({
  candidateIds: ['a', 'b', 'c'],
  mode: 'choose',
  minimum: 1,
  maximum: 2,
  allowCancel: false,
});
assert.equal(interactive.kind, 'interactive');
assert.deepEqual(selection.resolveCardSelection(interactive, ['c', 'a']), {
  status: 'selected',
  selectedIds: ['a', 'c'],
});

const automatic = selection.planCardSelection({
  candidateIds: ['a', 'b', 'c'],
  mode: 'rightmost',
  minimum: 0,
  maximum: 2,
  allowCancel: true,
});
assert.deepEqual(automatic.selectedIds, ['b', 'c']);
assert.equal(
  selection.planCardSelection({ candidateIds: ['a', 'a'], mode: 'all', minimum: 0, maximum: 2, allowCancel: true }).code,
  'DUPLICATE_CANDIDATE_ID',
);

console.log('Typed card selection plans passed.');
