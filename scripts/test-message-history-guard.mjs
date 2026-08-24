import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

let currentMessageId = 2;
let lastMessageId = 2;
globalThis.getVariables = () => ({});
globalThis.replaceVariables = () => undefined;
globalThis.updateVariablesWith = updater => updater({});
globalThis.insertOrAssignVariables = () => undefined;
globalThis.getCurrentMessageId = () => currentMessageId;
globalThis.getLastMessageId = () => lastMessageId;
const refreshedMessages = [];
globalThis.refreshOneMessage = async messageId => refreshedMessages.push(messageId);

const runtime = require(resolve('src/runtime/messageVariables.ts'));
assert.equal(runtime.isCurrentMessageLatest(), true);

let transitions = 0;
const stop = runtime.watchCurrentMessageUntilHistorical(() => {
  transitions += 1;
}, 100);
lastMessageId = 3;
await new Promise(resolveWait => setTimeout(resolveWait, 180));
assert.equal(transitions, 1, 'a current iframe becomes historical exactly once');
await new Promise(resolveWait => setTimeout(resolveWait, 140));
assert.equal(transitions, 1, 'the watcher stops after the historical transition');
stop();

currentMessageId = 1;
lastMessageId = 3;
let immediate = 0;
runtime.watchCurrentMessageUntilHistorical(() => {
  immediate += 1;
});
assert.equal(immediate, 1, 'an already-historical iframe is locked immediately');
assert.equal(await runtime.rerenderHistoricalMessageForDepth(), true);
assert.deepEqual(refreshedMessages, [1], 'historical views must ask Tavern Helper to reapply regex depth');
currentMessageId = lastMessageId;
assert.equal(await runtime.rerenderHistoricalMessageForDepth(), false, 'the latest view must never rerender itself');

currentMessageId = 10;
lastMessageId = 10;
let historicalWithinWindow = 0;
let outsideRecentWindow = 0;
const stopDepthGuard = runtime.watchCurrentMessageDepth(
  {
    onHistorical: () => { historicalWithinWindow += 1; },
    onOutOfRange: () => { outsideRecentWindow += 1; },
  },
  2,
  100,
);
lastMessageId = 11;
await new Promise(resolveWait => setTimeout(resolveWait, 140));
assert.equal(historicalWithinWindow, 1, 'the first historical transition must switch common to read-only');
assert.equal(outsideRecentWindow, 0, 'depth one must stay rendered');
lastMessageId = 12;
await new Promise(resolveWait => setTimeout(resolveWait, 140));
assert.equal(outsideRecentWindow, 0, 'depth two must stay rendered');
lastMessageId = 13;
await new Promise(resolveWait => setTimeout(resolveWait, 140));
assert.equal(outsideRecentWindow, 1, 'depth three must leave the recent-three window');
stopDepthGuard();

const startSource = await readFile(resolve('src/start/core/characterCreator.ts'), 'utf8');
assert.match(startSource, /watchCurrentMessageUntilHistorical/);
assert.match(startSource, /this\.lockHistoricalForm\(\)/);
assert.match(startSource, /rerenderHistoricalMessageForDepth\(\)/);
assert.match(startSource, /if \(!isCurrentMessageLatest\(\)\)/);
assert.match(startSource, /private isCreating = false/);
assert.match(startSource, /if \(this\.isCreating\) return/);
assert.doesNotMatch(startSource, /private buildUserDescription/);

console.log('Message-history guard locks old iframes once and stops its shared timer.');
