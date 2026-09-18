// Read-only measurements of the assembled protocol, not a second rule source.
// Historical clause mapping is retained in tmp/generation-contract-inventory.json.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {compactEffectProtocolSections}=require(resolve('src/game-core/authoredEffectProtocol.ts'));
const {formatCompactEffectAuthoringContract}=require(resolve('src/game-core/towerRequest.ts'));
const {initialDraftAuthoringPrompt}=require(resolve('src/sillytavern-extension/initialDraftPrompt.ts'));
const sections=compactEffectProtocolSections('initial-draft');
assert.equal(new Set(sections.map(s=>s.id)).size,sections.length);
assert.ok(sections.every(s=>s.clauses.length&&s.clauses.every(c=>typeof c==='string'&&c.length)));
const contract=formatCompactEffectAuthoringContract('initial-draft');
const prompt=initialDraftAuthoringPrompt({startPrompt:'审计输入',config:{card:'机制需求',towerRequirements:'高塔需求'},narrative:'已成立正文',currentStat:{},designGuidance:null});
console.log(JSON.stringify({
  measurement:'UTF-16 characters, not tokenizer tokens; local assembly only, not final provider wire',
  lengths:{publicDraftContract:contract.length,initialPrompt:prompt.length},
  sections:sections.map(s=>({id:s.id,title:s.title,clauses:s.clauses.length,characters:s.clauses.join('\n').length,
    longestClause:Math.max(...s.clauses.map(c=>c.length))})),
  // Measure paragraph density separately from total bytes. Do not print full
  // instructions or request values; this is a prioritization aid, not a gate.
  denseClauses:sections.flatMap(s=>s.clauses.map((c,index)=>({section:s.id,index,characters:c.length})))
    .filter(c=>c.characters>600).sort((a,b)=>b.characters-a.characters),
},null,2));
