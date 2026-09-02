import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const {
  createTowerArchiveStore,
  readTowerArchiveStore,
} = require(resolve('src/sillytavern-extension/towerArchiveStore.ts'));

const record = {
  spec: 'mwg.tower-archive-record/v1',
  chatId: 'chat-a',
  nodeId: 'act-1-floor-1-col-2',
  requestId: 'request-7',
  prompt: '生成节点',
  response: '节点结果',
  generationId: 'generation-7',
};

const store = createTowerArchiveStore('chat-a', [record, structuredClone(record)]);
assert.equal(store.spec, 'mwg.tower-archive-store/v1');
assert.equal(store.records.length, 1, 'duplicate request keys are collapsed');
assert.deepEqual(readTowerArchiveStore(store, 'chat-a'), [record]);
assert.deepEqual(readTowerArchiveStore(store, 'chat-b'), [], 'another chat cannot restore the queue');
assert.deepEqual(readTowerArchiveStore({ ...store, spec: 'unknown' }, 'chat-a'), []);
assert.deepEqual(
  readTowerArchiveStore({ ...store, records: [...store.records, { ...record, response: '' }] }, 'chat-a'),
  [record],
  'malformed records are ignored without poisoning valid records',
);

console.log('Tower pending archive metadata is bounded, scoped, serializable, and reload-safe.');
