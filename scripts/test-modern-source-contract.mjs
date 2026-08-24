import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const read = path => readFile(resolve(path), 'utf8');
const [
  battleState,
  cardPlay,
  session,
  cardSystem,
  mvuAdapter,
  fishEntry,
  commonEntry,
  commonHtml,
  battleUi,
  startHtml,
  startScss,
] =
  await Promise.all([
    read('src/game-core/battleState.ts'),
    read('src/game-core/cardPlayTransaction.ts'),
    read('src/game-core/battleSessionCoordinator.ts'),
    read('src/fish/combat/cardSystem.ts'),
    read('src/fish/core/mvuBattleAdapter.ts'),
    read('src/fish/index.ts'),
    read('src/common/index.ts'),
    read('src/common/index.html'),
    read('src/fish/ui/battleUI.ts'),
    read('src/start/index.html'),
    read('src/start/index.scss'),
  ]);

for (const source of [battleState, cardPlay, session, cardSystem]) {
  assert.doesNotMatch(source, /discard_requirement|discardRequirement|discardCandidateIds|discardCardForPayment/);
}
assert.doesNotMatch(battleState, /\bisBoss\b|\bgender\b|\bcorruption\b|type:[^;\n]*'Corrupt'/);
assert.doesNotMatch(mvuAdapter, /\bis_boss\b|\bisBoss\b/);
assert.doesNotMatch(battleUi, /\bCorrupted\b/);

for (const name of [
  'playCardWithMVU',
  'endTurnWithMVU',
  'exitBattleWithMVU',
  'drawCardsWithMVU',
  'refreshBattleUI',
]) {
  assert.equal(fishEntry.includes(name), false, `unused fish global must stay removed: ${name}`);
}
assert.doesNotMatch(commonEntry, /\(window as any\)|toggleNPCTracking|gainExperience/);
assert.doesNotMatch(commonHtml, /\bonclick\s*=/i);
assert.equal(startHtml.match(/<html\b/gi)?.length, 1);
assert.equal(startHtml.match(/<body\b/gi)?.length, 1);
assert.doesNotMatch(startHtml, /result-section|regenerate-btn|save-character-btn|start-game-btn|background-effects/);
assert.doesNotMatch(
  startScss,
  /gender-options|gender-option|result-section|result-actions|background-effects|location-container|city-selector/,
);

console.log('Modern source contract contains no removed compatibility paths or orphaned start-result UI.');
