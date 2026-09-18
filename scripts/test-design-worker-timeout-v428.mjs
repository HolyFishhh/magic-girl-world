import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {DesignWorkerClient}=require('../src/sillytavern-extension/workerClient.ts');
const saved={Worker:globalThis.Worker,location:globalThis.location,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
let timer,terminated=0,fallbackCalls=0;
try {
 globalThis.Worker=class {postMessage(){} terminate(){terminated++;}};
 globalThis.location={origin:'http://offline.invalid'};
 globalThis.setTimeout=fn=>{timer=fn;return 1;};globalThis.clearTimeout=()=>{};
 const client=new DesignWorkerClient({createSnapshot(){fallbackCalls++;throw Error('must not freeze UI with synchronous retry');}});
 const pending=client.createSnapshot({}, {}, {});timer();assert.equal(await pending,null);
 assert.equal(await client.createSnapshot({}, {}, {}),null);assert.equal(fallbackCalls,0);assert.equal(terminated,1);client.dispose();
} finally {Object.assign(globalThis,saved);}
console.log('PASS timed-out Worker simulation never retries the same workload on the rendering thread, including later snapshots.');
