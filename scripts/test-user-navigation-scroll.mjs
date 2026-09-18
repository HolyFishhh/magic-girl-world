import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const requireRules = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
requireRules('ts-node/register/transpile-only');
const {
  scrollUserNavigationTargetIntoView,
} = requireRules(resolve('src/common/userNavigationScroll.ts'));

const target = ({ top, bottom, height = bottom - top }) => {
  const calls = [];
  return {
    calls,
    element: {
      getBoundingClientRect: () => ({ top, bottom, height }),
      scrollIntoView: options => calls.push(options),
    },
  };
};

{
  const { element, calls } = target({ top: 120, bottom: 420 });
  assert.equal(scrollUserNavigationTargetIntoView(element, 800), false);
  assert.deepEqual(calls, [], 'an already visible explicit destination must retain the reader position');
}

for (const rect of [{ top: 900, bottom: 1040 }, { top: -180, bottom: -40 }]) {
  const { element, calls } = target(rect);
  assert.equal(scrollUserNavigationTargetIntoView(element, 800), true);
  assert.deepEqual(calls, [{ behavior: 'smooth', block: 'nearest', inline: 'nearest' }]);
}

{
  const { element, calls } = target({ top: -320, bottom: 1450, height: 1770 });
  assert.equal(scrollUserNavigationTargetIntoView(element, 800), true);
  assert.deepEqual(
    calls,
    [{ behavior: 'smooth', block: 'start', inline: 'nearest' }],
    'a long story/choice block must navigate to its start, never its unreadable middle',
  );
}

const indexSource = await readFile(resolve('src/common/index.ts'), 'utf8');
assert.match(indexSource, /import \{ documentViewportHeight, scrollUserNavigationTargetIntoView \} from '\.\/userNavigationScroll';/);
assert.equal((indexSource.match(/scrollUserNavigationTargetIntoView\(/g) || []).length, 1, 'legacy explicit navigation shares the policy; queued destinations use navigationFocus');
assert.doesNotMatch(indexSource, /scrollIntoView\(/, 'common index must not restore ad hoc centered scrolling');
assert.match(indexSource, /function requestUserFocus[\s\S]*?__PENDING_USER_FOCUS = selector;/, 'only explicit actions queue a post-render destination');

const shopSource = await readFile(resolve('src/common/shopMarket.ts'), 'utf8');
assert.match(shopSource, /import \{ pinSelectionToVisibleViewport \} from '\.\/fixedSelectionViewport';/);
assert.doesNotMatch(shopSource, /scrollIntoView\(/, 'shop dialogs must not independently center the host reader');
assert.match(shopSource, /opener\?\.focus\(\{ preventScroll: true \}\);/);
assert.match(shopSource, /closeButton\?\.focus\(\{ preventScroll: true \}\);/);
assert.match(shopSource, /next\?\.focus\(\{ preventScroll: true \}\);/, 'modal tab trapping must not scroll the background');
assert.doesNotMatch(shopSource, /scrollUserNavigationTargetIntoView\(/, 'fixed removal dialogs must preserve parent scroll on open and close');

console.log('user navigation scroll policy tests passed');
