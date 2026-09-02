import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const {
  InitialContentCandidateRejectedError,
  runInitialContentRepairLoop,
} = require(resolve('src/common/initialContentRepairLoop.ts'));

const calls = [];
const recovered = await runInitialContentRepairLoop(2, async attempt => {
  calls.push(attempt);
  if (attempt === 1) {
    throw new InitialContentCandidateRejectedError(
      'battle.cards[2].effects[1].discard：弃牌规则不能放在浅层效果项',
    );
  }
});
assert.deepEqual(calls, [1, 2], 'an invalid first candidate must not consume the second candidate');
assert.deepEqual(recovered, { repaired: true, attempts: 2, error: null });

const crossBoundaryCalls = [];
const crossBoundary = await runInitialContentRepairLoop(2, async attempt => {
  crossBoundaryCalls.push(attempt);
  if (attempt === 1) {
    const serializedError = new Error('candidate rejected after Tavern Helper callback');
    serializedError.name = 'InitialContentCandidateRejectedError';
    throw serializedError;
  }
});
assert.deepEqual(
  crossBoundaryCalls,
  [1, 2],
  'the stable error name must preserve the retry after an iframe/event boundary loses instanceof identity',
);
assert.equal(crossBoundary.repaired, true);

let terminalCalls = 0;
const terminal = await runInitialContentRepairLoop(2, async () => {
  terminalCalls += 1;
  throw new Error('酒馆助手不可用');
});
assert.equal(terminalCalls, 1, 'non-candidate infrastructure failures must not be retried blindly');
assert.equal(terminal.repaired, false);
assert.equal(terminal.attempts, 1);
assert.match(String(terminal.error), /酒馆助手不可用/);

console.log('Initial content repair keeps a local two-candidate budget and stops on infrastructure failures.');
