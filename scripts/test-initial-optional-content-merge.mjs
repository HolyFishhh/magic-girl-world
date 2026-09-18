import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {buildInitialPlayerBattle}=require('../src/sillytavern-extension/initialPlayerBattle.ts');
const {normalizeMvuPlayerAuthoredContent,normalizeMvuBattleContent}=require('../src/runtime/mvuBattleContentNormalizer.ts');
const {createContentPackFromMvuBattle}=require('../src/runtime/contentPackAdapter.ts');
const {assessInitialPlayerContent}=require('../src/game-core/playerContentReadiness.ts');
const template={player_lust_effect:{$meta:{extensible:true},name:'',description:''},unrelated_runtime_flag:73};
for(const value of [{}, {player_lust_effect:undefined}]) {
 const first=buildInitialPlayerBattle(template,value);
 const retry=buildInitialPlayerBattle(template,normalizeMvuPlayerAuthoredContent(value));
 assert.equal(Object.hasOwn(first,'player_lust_effect'),false);
 assert.equal(Object.hasOwn(retry,'player_lust_effect'),false);
 assert.equal(retry.unrelated_runtime_flag,73);
}
const authored={name:'保留原设计',effects:[{damage:50}]};
assert.deepEqual(buildInitialPlayerBattle(template,{player_lust_effect:authored}).player_lust_effect,authored);
assert.deepEqual(buildInitialPlayerBattle(template,{player_lust_effect:{name:'明确的坏输入'}}).player_lust_effect,{name:'明确的坏输入'});
assert.equal(Object.hasOwn(buildInitialPlayerBattle({player_lust_effect:authored},{}),'player_lust_effect'),false);

if(process.argv[2]) {
 const archive=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const records=archive.run.records;
 const stage=name=>JSON.parse(records.find(record=>record.stage===name).text);
 const compiled=stage('compiled-result');
 const targets=stage('repair-slot-plan').targets;
 const {parseTowerInitialSlotRepairResponse,mergeTowerInitialSlotRepair}=require('../src/sillytavern-extension/controller.ts');
 const {validateTowerOpeningRewardCandidates}=require('../src/game-core/towerOpeningOutcome.ts');
 const initial={narrative:compiled.narrative,status:compiled.player.status,
  player:normalizeMvuPlayerAuthoredContent(compiled.player),opening:normalizeMvuPlayerAuthoredContent(compiled.opening)};
 assert.throws(()=>validateTowerOpeningRewardCandidates(initial.opening.choices,initial.player),/Power/);
 const repair=parseTowerInitialSlotRepairResponse(stage('repair-final'),targets);
 const fixed=mergeTowerInitialSlotRepair(initial,targets,repair);
 // Reproduce the old merge leaking the initializer shell only after normalization.
 const old=normalizeMvuBattleContent({...structuredClone(template),...structuredClone(fixed.player)});
 const inspect=b=>assessInitialPlayerContent(createContentPackFromMvuBattle(b),{
  emoji:b.core.emoji,hp:b.core.hp,maxHp:b.core.max_hp,lust:b.core.lust,maxLust:b.core.max_lust,level:b.level??1,exp:b.exp??0});
 assert.equal(inspect(old).ok,false,'recorded secondary failure must reproduce before correction');
 const next=normalizeMvuBattleContent(buildInitialPlayerBattle(template,fixed.player));
 const checked=inspect(next);
 assert.equal(checked.ok,true,JSON.stringify(checked.issues));
 validateTowerOpeningRewardCandidates(fixed.opening.choices,next);
 assert.equal(Object.hasOwn(next,'player_lust_effect'),false);
 console.log('PASS archived failure replay: same Skill repair now passes player and opening reward validation without a model call.');
}
console.log('PASS initial optional omission cannot inherit template or previous-build desire effects.');
