import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { createRunState, enterRunNode, completeRunNode, validateRunState } = require('../src/game-core/runState.ts');
const { consumeTowerOpening } = require('../src/game-core/towerOpeningState.ts');
const { queueTowerOpeningInStat, claimTowerOpeningInStat, commitTowerOpeningInStat } = require('../src/runtime/towerOpeningAdapter.ts');
const { TOWER_INITIAL_COMMIT_KEY: key, readTowerInitialCommitReceipt: read, canRestoreInitialPresentation: canRestore, towerInitialStateDigest } = require('../src/sillytavern-extension/towerInitialCommit.ts');

// Entirely synthetic run and local adapter mutations: no private snapshot or host/model.
const root = { stat_data: { run: createRunState({ seed: 20260918, routeMode: 'map' }) } };
function prepareOpening() {
  queueTowerOpeningInStat(root.stat_data);
  const { request } = claimTowerOpeningInStat(root.stat_data);
  commitTowerOpeningInStat(root.stat_data, {
    request_id: request.requestId, based_on_revision: request.revision,
    title: '合成馈赠', narrative: '离线合成剧情', choices: [
      { id: 'gold', label: '钱袋', outcome: { gold: 1 } },
    ],
  });
}
prepareOpening();
const run = root.stat_data.run;
root[key] = {
  spec: 'mwg.tower-initial-commit/v1', chatId: 'synthetic', messageId: 0,
  generationId: 'initial-local', narrative: '第一幕合成剧情', openingRequestId: run.opening.requestId,
  runSeed: run.seed, revision: run.stateRevision, cardQuantity: 1,
  stateDigest: await towerInitialStateDigest(root.stat_data),
};
const receipt = structuredClone(root[key]);
const initial = structuredClone(root);
assert.deepEqual(read(root, 'synthetic', 0), receipt);
assert.equal(canRestore(root, receipt), true);
root.stat_data.run.opening = consumeTowerOpening(run.opening).opening;
let cleared = 0;
while (root.stat_data.run.act === 1) {
  const current = root.stat_data.run;
  assert.ok(current.choices.length);
  root.stat_data.run = completeRunNode(enterRunNode(current, current.choices[0].id), { outcome: 'cleared' });
  assert.equal(validateRunState(root.stat_data.run).ok, true);
  assert.deepEqual(read(root, 'synthetic', 0), receipt);
  assert.ok(++cleared < 100, 'bounded first-act traversal');
}
assert.equal(root.stat_data.run.act, 2);
assert.equal(root.stat_data.run.opening.requestId, null, 'real boss transition clears Act 1 request');
assert.equal(canRestore(root, receipt), false);
const pending = structuredClone(root);
prepareOpening();
assert.notEqual(root.stat_data.run.opening.requestId, receipt.openingRequestId);
assert.deepEqual(read(root, 'synthetic', 0), receipt);
assert.equal(canRestore(root, receipt), false, 'ready Act 2 cannot restore Act 1 presentation');
assert.deepEqual(read(JSON.parse(JSON.stringify(root)), 'synthetic', 0), receipt, 'save/reload');

let rejected = 0;
function reject(base, mutate, chat = 'synthetic', message = 0) {
  const candidate = structuredClone(base); mutate(candidate);
  const before = structuredClone(candidate);
  assert.throws(() => read(candidate, chat, message), /凭据损坏或与当前存档不一致/);
  assert.deepEqual(candidate, before, 'validation never repairs/overwrites state');
  rejected++;
}
reject(initial, r => { r.stat_data.run.opening.requestId = 'wrong-first-act'; });
reject(initial, r => { r.stat_data.run.opening.requestId = null; });
reject(initial, r => { r.stat_data.run.stateRevision++; r.stat_data.run.opening.requestId = 'wrong-advanced-first-act'; });
for (const base of [pending, root]) {
  reject(base, () => {}, 'different-chat');
  reject(base, () => {}, 'synthetic', 1);
  reject(base, r => { r[key] = null; });
  reject(base, r => { r[key].generationId = ''; });
  reject(base, r => { r[key].openingRequestId = ''; });
  reject(base, r => { r[key].stateDigest = 'damaged'; });
  reject(base, r => { r[key].runSeed++; });
  reject(base, r => { r[key].revision = r.stat_data.run.stateRevision + 1; });
  reject(base, r => { r.stat_data.run.stateRevision = r[key].revision; });
  reject(base, r => { r.stat_data.run.act = 99; });
  reject(base, r => { r.stat_data.run.map = null; });
}
assert.throws(() => read(pending, 'different-chat', 0), /act-receipt-v2：聊天绑定/);
assert.throws(() => read(pending, 'synthetic', 1), /act-receipt-v2：楼层绑定/);
const wrongOpening = structuredClone(initial); wrongOpening.stat_data.run.opening.requestId = null;
assert.throws(() => read(wrongOpening, 'synthetic', 0), /act-receipt-v2：幕间开局绑定/);
assert.deepEqual(root[key], receipt, 'later openings never rewrite initial receipt');
console.log(JSON.stringify({ test: 'initial-receipt-act2', cleared, act: root.stat_data.run.act,
  oldRequest: receipt.openingRequestId, newRequest: root.stat_data.run.opening.requestId,
  pendingAndReadyAccepted: true, initialRestoreBlockedAfterProgress: true, rejectedCorruptions: rejected }));
