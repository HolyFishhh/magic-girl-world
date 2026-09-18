import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const selection = require(resolve('src/game-core/cardSelection.ts'));
const selectorRuntime = require(resolve('src/game-core/cardSelectorRuntime.ts'));
const { compileCompactEffectList } = require(resolve('src/game-core/compactEffectDsl.ts'));

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

assert.deepEqual(
  selection.planCardSelection({
    candidateIds: ['only'],
    mode: 'leftmost',
    minimum: 2,
    maximum: 2,
    allowCancel: false,
  }),
  {
    ok: false,
    code: 'INSUFFICIENT_CANDIDATES',
    requestedMinimum: 2,
    availableCount: 1,
  },
  'minimum target shortage must not be silently clamped',
);

const sameName = compileCompactEffectList({
  exhaust: 1,
  from: 'hand',
  pick: 'choose',
  name: '同名牌',
});
assert.equal(sameName.ok, true, sameName.ok ? '' : JSON.stringify(sameName.issues));
assert.deepEqual(sameName.value.steps[0].selector.filter, { name: '同名牌' });
const cards = [
  { id: 'a', name: '同名牌', templateId: 'template_a' },
  { id: 'b', name: '同名牌', templateId: 'template_b' },
  { id: 'c', name: '另一张', templateId: 'template_a' },
];
assert.deepEqual(
  cards.filter(card => selectorRuntime.cardMatchesSelectorFilter(card, { name: '同名牌' })).map(card => card.id),
  ['a', 'b'],
  'name filter selects same visible names across distinct templates',
);
assert.deepEqual(
  cards.filter(card => selectorRuntime.cardMatchesSelectorFilter(card, { templateId: 'template_a' })).map(card => card.id),
  ['a', 'c'],
  'template filter remains distinct from same-name selection',
);

const keywordRecovery = compileCompactEffectList({
  recover: 1,
  from: 'discard',
  pick: 'choose',
  keyword: 'exhaust',
  exclude_keyword: 'ethereal',
});
assert.equal(keywordRecovery.ok, true, keywordRecovery.ok ? '' : JSON.stringify(keywordRecovery.issues));
assert.deepEqual(keywordRecovery.value.steps[0].filter, {
  keywords: ['exhaust'],
  excludedKeywords: ['ethereal'],
});
const keywordCards = [
  { id: 'exhaust-only', exhaust: true },
  { id: 'exhaust-ethereal', exhaust: true, ethereal: true },
  { id: 'plain' },
];
assert.deepEqual(
  keywordCards
    .filter(card => selectorRuntime.cardMatchesSelectorFilter(card, keywordRecovery.value.steps[0].filter))
    .map(card => card.id),
  ['exhaust-only'],
  'intrinsic card keywords are reusable selector filters instead of prose-only promises',
);

console.log('Typed card selection plans passed.');
