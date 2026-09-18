import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = [
  'src/fish/ui/battleUI.ts',
  'src/fish/ui/cardInteractionPresenter.ts',
  'src/fish/ui/effectChoicePresenter.ts',
  'src/fish/ui/summonChoicePresenter.ts',
  'src/fish/ui/battleEffectPresenter.ts',
  'src/fish/ui/statusDetailViewer.ts',
  'src/fish/ui/lustOverflowDisplay.ts',
  'src/fish/ui/modifierDisplay.ts',
  'src/fish/modules/battleLog.ts',
  'src/fish/ui/animationManager.ts',
];
const source = Object.fromEntries(files.map(file => [file, fs.readFileSync(file, 'utf8')]));
for (const [file, text] of Object.entries(source)) {
  assert.match(text, /#battle-scene/, `${file} must resolve the battle-scene host`);
}
for (const marker of [
  "(host.length ? host : $('body')).append(popover)",
  "(host.length ? host : $('body')).append(tooltip)",
  "(host.length ? host : $('body')).append(modal)",
]) {
  assert.match(source['src/fish/ui/battleUI.ts'], new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
const styles = fs.readFileSync('src/fish/index.scss', 'utf8');
assert.match(styles, /#battle-scene\s*\{\s*position:\s*relative;/s);
assert.match(styles, /#battle-scene\s*>\s*\.card-selection-modal/);
assert.match(styles, /#battle-scene\s*>\s*\.status-detail-modal/);
console.log('PASS battle dialogs and detail popovers resolve inside #battle-scene');
