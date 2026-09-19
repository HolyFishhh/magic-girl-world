import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { DesignAssistantController } = require('../src/sillytavern-extension/controller.ts');
const { normalizeDesignAssistantSettings } = require('../src/sillytavern-extension/designEngine.ts');
const { buildTowerSemanticMvuContext } = require('../src/sillytavern-extension/towerCoordinator.ts');
const { TowerGenerationHost } = require('../src/sillytavern-extension/towerGenerationHost.ts');
const tick = () => new Promise(r=>setTimeout(r,0));
function setup({enabled=true,generate}={}) {
  const h={chat:'a', calls:0, vars:{stat_data:{game_mode:'tower',run:{seed:7,phase:'awaiting_choice'},tower_battle_stories:[{seed:7,nodeId:'battle',phase:'pending',summary:'第二回合：星火造成6点伤害；胜利',narrative:''}]}}};
  const c=Object.create(DesignAssistantController.prototype);
  Object.assign(c,{active:true,towerNarrativePromises:new Map(),currentChatId:()=>h.chat,latestMessageId:()=>0,isTowerLockedScope:()=>true,
    readLatestMvuData:()=>structuredClone(h.vars),replaceLatestMvuData:async v=>{h.vars=structuredClone(v)},saveTowerArchiveMetadata(){},
    getSettings:()=>({towerBattleNarrative:enabled}),debug(){},towerGenerationHost:{
      async generateNarrative(request,independent){h.calls++;assert.equal(independent,true);assert.match(request.prompt,/第二回合/);return {response:await (generate?.(h) ?? '魔偶倒下，星火照亮前路。')};},forgetTerminalRecord(){},
    }});
  return Object.assign(h,{controller:c,run:()=>c.scheduleTowerBattleNarrative()});
}
assert.equal(normalizeDesignAssistantSettings({}).towerBattleNarrative,true);
assert.equal(normalizeDesignAssistantSettings({towerBattleNarrative:false}).towerBattleNarrative,false);
{
  const h=setup();const run=structuredClone(h.vars.stat_data.run);await h.run();await h.run();
  assert.equal(h.calls,1);assert.deepEqual(h.vars.stat_data.run,run);
  assert.equal(h.vars.stat_data.tower_battle_stories[0].phase,'ready');
  const restored=JSON.parse(JSON.stringify(h.vars));
  const context=buildTowerSemanticMvuContext(restored);
  assert.match(JSON.stringify(context),/魔偶倒下/);assert.ok(!JSON.stringify(context).includes('第二回合'));
}
{
  const h=setup({enabled:false});await h.run();assert.equal(h.calls,0);assert.equal(h.vars.stat_data.tower_battle_stories[0].phase,'skipped');
}
{
  const h=setup({generate:()=>{throw Error('model unavailable')}});await h.run();assert.equal(h.vars.stat_data.tower_battle_stories[0].phase,'failed');assert.equal(h.vars.stat_data.run.phase,'awaiting_choice');
}
{
  let resolve;const h=setup({generate:()=>new Promise(r=>resolve=r)});const running=h.run();await tick();await h.run();assert.equal(h.calls,1);
  h.vars.stat_data.run.phase='in_node';h.vars.stat_data.run.currentNode={id:'next'};
  resolve('上一战的完整剧情');await running;assert.equal(h.vars.stat_data.run.currentNode.id,'next');assert.equal(h.vars.stat_data.tower_battle_stories[0].narrative,'上一战的完整剧情');
}
{
  let resolve;const h=setup({generate:()=>new Promise(r=>resolve=r)});const running=h.run();await tick();h.chat='another';resolve('不应写入');await running;assert.equal(h.vars.stat_data.tower_battle_stories[0].narrative,'');
}
{
  const h=setup();h.vars.stat_data.tower_battle_stories[0].phase='generating';await h.run();assert.equal(h.vars.stat_data.tower_battle_stories[0].phase,'ready','reload resumes saved pending work');
}
// Actual generation host: a hanging post-battle preset cannot hold the node lane.
{
  let resolveStory;let nodes=0;
  const host=new TowerGenerationHost({currentChatId:()=> 'a',createChatMessages:async()=>assert.fail('must not create chat floors'),
    generate:async()=>{nodes++;return '{"node":"ready"}'},generateNarrative:()=>new Promise(r=>resolveStory=r),stopGenerationById:()=>true,emitInternalEvent:async()=>{}});
  const req={chatId:'a',nodeId:'battle',requestId:'post',runScope:'seed:7',prompt:'战后日志',maxAttempts:1};
  const prose=host.generateNarrative(req,true);await tick();
  const node=await host.generateNode({...req,nodeId:'next',requestId:'next'});assert.equal(nodes,1);assert.match(node.response,/ready/);
  resolveStory('战后正文');await prose;assert.equal(host.forgetTerminalRecord(req),true);
  assert.equal(host.battleNarrativeQueue.getStatus(req),null,'release completed prose queue payload');
}
console.log('PASS post-battle setting, dedupe, failure, restore, scoped writes, continuity and independent node generation');
