import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const coordinator = await readFile(resolve('src/fish/index.ts'), 'utf8');
const shellPresenter = await readFile(resolve('src/fish/ui/battleShellPresenter.ts'), 'utf8');
assert.match(shellPresenter, /this\.pileViewer\.setupPileClickEvents\(\)/);
assert.match(shellPresenter, /this\.pileViewer\.showPileByType\(pileType, this\.gameStateManager\)/);
assert.doesNotMatch(shellPresenter, /TODO: 实现牌堆查看功能/);
assert.doesNotMatch(coordinator, /PileViewer|requestPileData/);

const viewer = await readFile(resolve('src/fish/ui/pileViewer.ts'), 'utf8');
assert.match(viewer, /showPileByType\(pileType/);
assert.match(viewer, /\.deck-stat\[data-pile="deck"\]/);
assert.match(viewer, /\.deck-stat\[data-pile="draw"\]/);
assert.match(viewer, /\.deck-stat\[data-pile="discard"\]/);
assert.match(viewer, /\.deck-stat\[data-pile="exhaust"\]/);
assert.match(viewer, /pile-viewer-overlay/);
assert.match(viewer, /牌堆为空/);
assert.match(viewer, /renderCardFace\(card,/);

const battleUi = await readFile(resolve('src/fish/ui/battleUI.ts'), 'utf8');
assert.match(battleUi, /renderCardFace\(cardData,/);
const face = await readFile(resolve('src/shared/cardFace.ts'), 'utf8');
const traits = await readFile(resolve('src/shared/cardTraits.ts'), 'utf8');
const lifecycle = await readFile(resolve('src/game-core/cardLifecycle.ts'), 'utf8');
assert.match(face, /renderCardTraits\(cardData,/);
assert.match(traits, /describeCardTraits\(card\)/);
assert.match(lifecycle, /card\.innate/);
assert.match(lifecycle, /固有/);
assert.match(traits, /card\.discardEffectProgram/);
assert.match(traits, /主动或效果弃置/);

const styles = await readFile(resolve('src/fish/index.scss'), 'utf8');
const pileStyles = await readFile(resolve('src/shared/_pileCards.scss'), 'utf8');
const cardStyles = await readFile(resolve('src/shared/_unifiedCard.scss'), 'utf8');
assert.match(styles, /@use '..\/shared\/pileCards' as pile-cards/);
assert.match(pileStyles, /@use '.\/unifiedCard'/);
assert.match(cardStyles, /\.card-type-row[\s\S]*height:\s*25px/);
assert.match(cardStyles, /\.pile-viewer-body[\s\S]*grid-template-columns:\s*repeat\(auto-fill/);
assert.match(cardStyles, /\.pile-viewer[\s\S]*\.enhanced-card[\s\S]*position:\s*relative/);

const html = await readFile(resolve('src/fish/index.html'), 'utf8');
assert.doesNotMatch(html, /id="pile-viewer"|onclick="closePileViewer\(\)"/);
for (const label of ['弃牌堆', '消耗牌堆', '抽牌堆']) assert.match(html, new RegExp(`class="pile-label">${label}<`));

console.log('Pile viewer buttons are wired to the existing modal viewer.');

assert.doesNotMatch(html,/id="deck-pile-btn"/);
