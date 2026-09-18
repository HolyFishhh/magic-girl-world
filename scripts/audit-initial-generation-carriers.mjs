import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {auditInitialSemanticStructure:audit}=require('../src/game-core/initialSemanticAudit.ts');
for(const n of [93,97]){
 const path=`tmp/initial${n}-final-browser-v176.json`,bytes=readFileSync(path),capture=JSON.parse(bytes);
 const draft=JSON.parse(capture.evidence.find(e=>e.stage==='normalized-draft').text),report=audit(draft);
 assert.equal(report.truncated,false);
 const generation=report.facts.filter(f=>f.kind==='card_generation');
 const statusGeneration=generation.filter(f=>f.path[0]==='registry'&&f.path[1]==='statuses');
 assert.ok(generation.length>0);
 assert.equal(statusGeneration.length>0,n===97,'actual status generation differs from artifact generation');
 assert.deepEqual(readFileSync(path),bytes);
 console.log(JSON.stringify({sample:n,generation,statusListeners:report.facts.filter(f=>f.kind==='status_listener'),
  disclaimer:'Potential referenced structures only; not reachability, cycle completion or requirement satisfaction.'}));
}
