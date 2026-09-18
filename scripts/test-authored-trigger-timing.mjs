import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {diagnoseExplicitTriggerTiming,collectInitialTriggerTimingIssues,formatAuthoredMechanicDescriptionContract}=require('../src/game-core/authoredTriggerTiming.ts');
const {formatCompactEffectAuthoringContract,createTowerInitialSlotRepairJsonSchema,TOWER_INITIAL_SLOT_REPAIR_SPEC}=require('../src/game-core/towerRequest.ts');
const {extractTowerInitialRepairSlotTargets,parseTowerInitialSlotRepairResponse,mergeTowerInitialSlotRepair}=require('../src/sillytavern-extension/controller.ts');
const artifact={id:'pressure_pointer',name:'压力指针',rarity:'Common',description:'每回合开始时，若你拥有压力资源，获得1点格挡。',
  trigger:{on:'battle_start',effects:{block:1,when:'self.resource.pressure.current >= 1'}}};
const initial={narrative:'preset已确定剧情',status:{time:'黄昏'},player:{artifacts:[artifact],cards:[{id:'unchanged',effects:{damage:6}}]},
  opening:{choices:[{id:'gift',outcome:{reward:{artifacts:[structuredClone(artifact)]}}}]}};
const before=structuredClone(initial),issues=collectInitialTriggerTimingIssues(initial);
assert.deepEqual(issues.map(x=>[x.path,x.actualTrigger,x.describedTrigger]),[
  ['player.artifacts[0].trigger.on','battle_start','turn_start'],
  ['opening.choices[0].outcome.reward.artifacts[0].trigger.on','battle_start','turn_start'],
]);
assert.deepEqual(initial,before,'audit never performs a prose-driven mutation');
for(const [description,actual,expected] of [
  ['每回合结束时，获得1点格挡。','turn_start','turn_end'],
  ['战斗开始时，获得1点格挡。','turn_end','battle_start'],
  ['在每个我方回合开始时获得1点格挡。','attack_played','turn_start'],
]) assert.equal(diagnoseExplicitTriggerTiming({...artifact,description,trigger:{...artifact.trigger,on:actual}},'x')[0]?.describedTrigger,expected);
for(const description of [
  '每回合开始时，塔壁的风铃响起。', '据说每回合开始时，获得1点格挡。',
  '不是每回合开始时获得1点格挡。', '“每回合开始时获得1点格挡”是传闻。',
  '每回合开始时，可能获得1点格挡。', '每回合开始时，不获得1点格挡。',
  '每回合开始时，获得1点格挡只是传闻。',
  '每回合开始时的回忆：获得1点格挡。', '每回合开始时，获得1点格挡，战斗开始时也会获得1点格挡。',
  '每回合开始时，获得2点格挡。', // numeric mismatch is a different audit, not proof of this timing clause
]) assert.deepEqual(diagnoseExplicitTriggerTiming({...artifact,description},'x'),[],description);
assert.deepEqual(diagnoseExplicitTriggerTiming({...artifact,trigger:{...artifact.trigger,on:'turn_start'}},'x'),[]);
assert.deepEqual(diagnoseExplicitTriggerTiming({...artifact,effects:{draw:1}},'x'),[],'mixed immediate/future summary is not selected by a heuristic');
assert.deepEqual(diagnoseExplicitTriggerTiming({...artifact,trigger:{on:'passive',effects:{modify:'block',add:1}}},'x'),[]);
assert.deepEqual(diagnoseExplicitTriggerTiming({...artifact,trigger:{...artifact.trigger,effects:{block:'self.energy'}}},'x'),[]);
assert.deepEqual(diagnoseExplicitTriggerTiming({...artifact,trigger:{...artifact.trigger,effects:[{block:1},{block:1}]}},'x'),[]);
const cycle={};cycle.loop=cycle;
assert.equal(collectInitialTriggerTimingIssues({player:cycle,opening:{}})[0].code,'TRIGGER_CLAIM_AUDIT_LIMIT');
const errors=issues.map(x=>`${x.path}：[${x.code}] ${x.message.replaceAll('；','，')}`).join('；');
const targets=extractTowerInitialRepairSlotTargets(initial,errors);
assert.equal(targets.length,2);
assert.deepEqual(targets.flatMap(r=>r.slots.map(s=>[s.kind,s.path])).sort((a,b)=>a[1].localeCompare(b[1])),
  issues.map(x=>['trigger_on',x.path]).sort((a,b)=>a[1].localeCompare(b[1])));
const response={spec:TOWER_INITIAL_SLOT_REPAIR_SPEC,roots:Object.fromEntries(targets.map(root=>[root.token,{slots:
  Object.fromEntries(root.slots.map(slot=>[slot.token,{action:slot.action,value:'turn_start'}]))}])),support_statuses:[],support_resources:[]};
const validator=new Ajv2020({strict:false}).compile(createTowerInitialSlotRepairJsonSchema(targets).value);
assert.equal(validator(response),true,JSON.stringify(validator.errors));
const merged=mergeTowerInitialSlotRepair(initial,targets,parseTowerInitialSlotRepairResponse(response,targets));
const expected=structuredClone(initial);expected.player.artifacts[0].trigger.on='turn_start';expected.opening.choices[0].outcome.reward.artifacts[0].trigger.on='turn_start';
assert.deepEqual(merged,expected,'only model-selected timing enum changes; condition/value/description/gifts/narrative locked');
assert.deepEqual(collectInitialTriggerTimingIssues(merged),[]);
const unchanged=structuredClone(response);for(const root of targets)for(const slot of root.slots)unchanged.roots[root.token].slots[slot.token].value='battle_start';
assert.equal(collectInitialTriggerTimingIssues(mergeTowerInitialSlotRepair(initial,targets,parseTowerInitialSlotRepairResponse(unchanged,targets))).length,2,'valid JSON cannot bypass semantic recheck');
const extra=structuredClone(response);extra.roots[targets[0].token].description='空白机制';assert.throws(()=>parseTowerInitialSlotRepairResponse(extra,targets));
assert.ok(formatCompactEffectAuthoringContract().includes(formatAuthoredMechanicDescriptionContract()));
console.log('PASS exact trigger claim audit: fresh content only, literal mechanical evidence, conservative prose skips, nested reward paths, strict timing-only repair and recheck.');
