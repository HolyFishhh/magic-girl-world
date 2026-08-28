import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const identity = require(resolve('src/game-core/cardIdentity.ts'));

const first = identity.ensureCardIdentity(
  { id: 'strike__1', originalId: 'strike' },
  { existingRunIds: new Set(), existingCombatIds: new Set(), origin: 'deck' },
);
assert.equal(first.templateId, 'strike');
assert.equal(first.runInstanceId, 'strike__run__1');
assert.equal(first.combatInstanceId, 'strike__1');
assert.equal(first.id, first.combatInstanceId);
assert.equal(first.originalId, first.templateId);

const migratedAgain = identity.ensureCardIdentity(first, {
  existingRunIds: new Set([first.runInstanceId]),
  existingCombatIds: new Set([first.combatInstanceId]),
});
assert.deepEqual(migratedAgain, first, 'save migration must be idempotent');

const temporaryCopy = identity.createCardCopyIdentity(first, {
  temporaryCombatCopy: true,
  existingCombatIds: new Set([first.combatInstanceId]),
  existingRunIds: new Set([first.runInstanceId]),
});
assert.equal(temporaryCopy.templateId, first.templateId);
assert.equal(temporaryCopy.runInstanceId, first.runInstanceId);
assert.notEqual(temporaryCopy.combatInstanceId, first.combatInstanceId);
assert.equal(temporaryCopy.parentCombatInstanceId, first.combatInstanceId);
assert.equal(temporaryCopy.origin, 'copied');

const persistentCopy = identity.createCardCopyIdentity(first, {
  temporaryCombatCopy: false,
  existingCombatIds: new Set([first.combatInstanceId]),
  existingRunIds: new Set([first.runInstanceId]),
});
assert.notEqual(persistentCopy.runInstanceId, first.runInstanceId);
assert.equal(identity.cardsShareIdentity(first, persistentCopy, 'template'), true);
assert.equal(identity.cardsShareIdentity(first, persistentCopy, 'run_instance'), false);
assert.equal(identity.cardsShareIdentity(first, temporaryCopy, 'lineage'), true);

const persisted = identity.persistentCardIdentity(persistentCopy);
assert.equal('combatInstanceId' in persisted, false);
assert.equal(persisted.runInstanceId, persistentCopy.runInstanceId);

console.log('Card identity migration, copy lineage, and persistence boundaries passed.');
