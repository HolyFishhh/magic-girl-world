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
assert.match(viewer, /\.deck-stat\[data-pile="draw"\]/);
assert.match(viewer, /\.deck-stat\[data-pile="discard"\]/);
assert.match(viewer, /\.deck-stat\[data-pile="exhaust"\]/);
assert.match(viewer, /pile-viewer-overlay/);
assert.match(viewer, /牌堆为空/);
assert.match(viewer, /card\.innate/);

const battleUi = await readFile(resolve('src/fish/ui/battleUI.ts'), 'utf8');
assert.match(battleUi, /cardData\.innate/);
assert.match(battleUi, /固有/);

const styles = await readFile(resolve('src/fish/index.scss'), 'utf8');
assert.match(styles, /\.card-keywords/);
assert.match(styles, /&\.innate/);

const html = await readFile(resolve('src/fish/index.html'), 'utf8');
assert.doesNotMatch(html, /id="pile-viewer"|onclick="closePileViewer\(\)"/);

console.log('Pile viewer buttons are wired to the existing modal viewer.');
