import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { TowerGenerationEvidence } = require(resolve('src/sillytavern-extension/towerGenerationEvidence.ts'));
const { TowerGenerationHost } = require(resolve('src/sillytavern-extension/towerGenerationHost.ts'));
const { formatTowerNodeStructureRepairPrompt, formatTowerNodeBatchStructureRepairPrompt } = require(resolve('src/game-core/towerRequest.ts'));

const evidence = new TowerGenerationEvidence();
evidence.retainChat('chat-6');
evidence.append({ chatId: 'chat-6', nodeId: 'n6', requestId: 'parent', stage: 'request', prompt: 'parent prompt' });
evidence.append({ chatId: 'chat-6', nodeId: 'n6', requestId: 'parent', stage: 'response', generationId: 'g1', response: '{"reward":[]}' });
evidence.append({ chatId: 'chat-6', nodeId: 'n6', requestId: 'parent__structure_repair_1', parentRequestId: 'parent', stage: 'request', prompt: 'repair only reward' });
evidence.append({ chatId: 'chat-6', nodeId: 'n6', requestId: 'parent__structure_repair_1', parentRequestId: 'parent', stage: 'response', generationId: 'g2', response: '{"reward":{"card":[]}}' });
evidence.append({ chatId: 'chat-6', nodeId: 'n6', requestId: 'parent', stage: 'outcome', parsedResult: { reward: { card: [] } }, outcome: { outcome: 'complete' }, beforeMvuData: { marker: 'before' }, afterMvuData: { marker: 'after' } });
const snapshot = (await evidence.snapshot('chat-6'));
assert.equal(snapshot.records.length, 5);
assert.equal(snapshot.records[3].parentRequestId, 'parent');
assert.equal(snapshot.records[4].afterMvuData.marker, 'after');
assert.equal((await evidence.snapshot('other-chat')), null);
// A late callback from an old chat is ignored before it can pollute memory.
evidence.append({ chatId: 'old-chat', nodeId: 'n-old', requestId: 'late', stage: 'response', response: 'old response' });
assert.equal((await evidence.snapshot('chat-6')).records.some(record => record.requestId === 'late'), false);
const retained = new TowerGenerationEvidence();
retained.retainChat('chat-retention');
for (let index = 0; index < 70; index += 1) {
  retained.append({ chatId: 'chat-retention', nodeId: 'n', requestId: `r-${index}`, stage: 'request', prompt: `prompt-${index}` });
  retained.append({ chatId: 'chat-retention', nodeId: 'n', requestId: `r-${index}`, stage: 'response', response: `response-${index}` });
  retained.append({ chatId: 'chat-retention', nodeId: 'n', requestId: `r-${index}`, stage: 'outcome', outcome: { index } });
}
const retainedSnapshot = (await retained.snapshot('chat-retention'));
assert.ok(retainedSnapshot.retention.droppedRecords === 0);
for (const requestId of new Set(retainedSnapshot.records.map(record => record.requestId))) {
  assert.equal(retainedSnapshot.records.filter(record => record.requestId === requestId).length, 3, `request group ${requestId} must remain complete`);
}
const restored = new TowerGenerationEvidence();
restored.retainChat('chat-6', snapshot);
assert.deepEqual((await restored.snapshot('chat-6')), snapshot);


const callbacks = [];
const host = new TowerGenerationHost({
  currentChatId: () => 'chat-6',
  createChatMessages: async () => { throw new Error('hidden chat archive must not be called'); },
  generate: async config => JSON.stringify({ ok: true, requestId: config.generation_id }),
  stopGenerationById: () => true,
  emitInternalEvent: async () => undefined,
}, { onGenerationRequested: request => callbacks.push(['request', request.requestId]), onGenerationCompleted: (request, result) => callbacks.push(['response', request.requestId, result.response]), onGenerationFailed: (request, error) => callbacks.push(['failure', request.requestId, String(error)]) });
await host.generateNode({ chatId: 'chat-6', nodeId: 'n6', requestId: 'host-1', prompt: 'host prompt', maxAttempts: 1 });
assert.deepEqual(callbacks.map(entry => entry[0]), ['request', 'response']);
assert.equal(host.listPendingArchiveKeys('chat-6').length, 1);

// Late completion after a chat switch must not enter the new chat's memory.
let resolveLate;
const lateHost = new TowerGenerationHost({
  currentChatId: () => 'chat-old',
  createChatMessages: async () => { throw new Error('hidden chat archive must not be called'); },
  generate: async () => new Promise(resolve => { resolveLate = resolve; }),
  stopGenerationById: () => true,
  emitInternalEvent: async () => undefined,
}, {
  onGenerationCompleted: (request, result) => evidence.append({
    chatId: request.chatId, nodeId: request.nodeId, requestId: request.requestId, stage: 'response',
    response: result.response, generationId: result.generationId,
  }),
});
const late = lateHost.generateNode({ chatId: 'chat-old', nodeId: 'n-late', requestId: 'late-host', prompt: 'late prompt', maxAttempts: 1 });
evidence.retainChat('chat-new');
await new Promise(resolve => setTimeout(resolve, 0));
resolveLate(JSON.stringify({ late: true }));
await late;
assert.equal((await evidence.snapshot('chat-new')).records.some(record => record.requestId === 'late-host'), false);

const job = { nodeId: 'n6', requestId: 'req-6', basedOnRevision: 2, kind: 'battle', act: 1, floor: 6 };
const nodePrompt = formatTowerNodeStructureRepairPrompt(job, '{"reward":[]}', new Error('tower battle reward must be an object'));
assert.match(nodePrompt, /不得把数组或标量盲目包装/);
assert.match(nodePrompt, /不得凭空造奖励/);
const batchPrompt = formatTowerNodeBatchStructureRepairPrompt('b6', [job, { ...job, nodeId: 'sibling', requestId: 'req-sibling', kind: 'event' }], '{"results":[]}', new Error('n6: tower battle reward must be an object'));
assert.match(batchPrompt, /不得改写未报错 sibling/);
assert.match(batchPrompt, /无法无损判断时让该节点失败/);
console.log('tower generation evidence + reward repair contract: ok');
evidence.retainChat('manual');
evidence.append({chatId:'manual',nodeId:'manual-variable-repair',requestId:'manual-1',stage:'request',prompt:'把时间改为第二天'});
evidence.append({chatId:'manual',nodeId:'manual-variable-repair',requestId:'manual-1',stage:'response',response:'原文'.repeat(20000)});
const recent=await evidence.recent('manual',1);assert.equal(recent.total,2);assert.equal(recent.records.length,1);assert.equal(recent.records[0].kind,'自然语言修改');assert.equal((await evidence.loadRecord('manual',recent.records[0].key)).response.length,40000);assert.equal((await evidence.snapshot('manual')).records.length,2);
