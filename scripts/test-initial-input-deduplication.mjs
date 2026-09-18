import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const shared=require('../src/game-core/characterStartRequest.ts');
const ui=require('../src/start/core/promptGenerator.ts');
const {initialDraftAuthoringPrompt:author,initialDraftNarrativePrompt:story}=require('../src/sillytavern-extension/initialDraftPrompt.ts');
assert.equal(ui.createCharacterStartMessage,shared.createCharacterStartMessage);
assert.equal(ui.createCharacterStartMessage({mode:'tower',name:' 玩家 ',profession:' 工匠 ',card:' 条件收益 '}),
 '[角色创建]\n{"mode":"tower","name":"玩家","identity":"工匠","card":"条件收益"}\n[爬塔模式]\n[开始游戏]');
assert.match(ui.createCharacterStartMessage({mode:'expedition'}),/爬塔模式/);
assert.match(ui.createCharacterStartMessage({mode:'story'}),/剧情模式/);
const plan=JSON.parse(readFileSync('tmp/live-initial-v211-plan.json','utf8'));
const measurements=[];
for(const scenario of plan.scenarios){
 const {number,id,...fields}=scenario;
 const config={mode:'tower',...fields};
 const startPrompt=ui.createCharacterStartMessage(config),snapshot=structuredClone(config);
 const input={config,startPrompt,narrative:'已成立正文保持不变',currentStat:{},designGuidance:null};
 const prompt=author(input),narrativePrompt=story(input);
 assert.equal(shared.isCanonicalTowerStartRequest(startPrompt,config),true);
 assert.ok(!prompt.includes('START_REQUEST='));
 assert.equal(prompt.split(`REQUESTED_CARD_DESIGN=${JSON.stringify(config.card)}`).length,2);
 assert.equal(prompt.split(`REQUESTED_TOWER_RULES=${JSON.stringify(config.towerRequirements)}`).length,2);
 const {card,towerRequirements,...profile}=config;
 assert.ok(prompt.includes(`PLAYER_CONFIG=${JSON.stringify(profile)}`));
 assert.ok(prompt.includes(`ESTABLISHED_NARRATIVE=${JSON.stringify(input.narrative)}`));
 assert.ok(narrativePrompt.includes(`PLAYER_CONFIG=${JSON.stringify(config)}`));
 assert.ok(!narrativePrompt.includes('[角色创建]'));
 for(const request of [startPrompt+'\n额外要求必须保留',startPrompt.replace('[开始游戏]','[自定义]'),'任意用户请求',startPrompt.replace('"mode":"tower"','"mode":"story"')]){
  assert.equal(shared.isCanonicalTowerStartRequest(request,config),false);
  assert.ok(author({...input,startPrompt:request}).includes(`START_REQUEST=${JSON.stringify(request)}`));
  assert.ok(story({...input,startPrompt:request}).includes(request));
 }
 assert.equal(shared.isCanonicalTowerStartRequest(startPrompt,{...config,card:config.card+'另外条件'}),false);
 assert.equal(shared.isCanonicalTowerStartRequest(startPrompt,{...config,mode:'story'}),false);
 assert.deepEqual(config,snapshot);
 measurements.push({sample:number,mechanismCharactersRemoved:`START_REQUEST=${JSON.stringify(startPrompt)}\n`.length,narrativeCharactersRemoved:startPrompt.length+1});
}
console.log(JSON.stringify({passed:true,measurements,scope:'Exact owned UI envelope only; custom input and all semantic reference unchanged; no generation or save mutation.'}));
