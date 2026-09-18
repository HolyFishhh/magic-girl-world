import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module:'CommonJS', moduleResolution:'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { DesignAssistantController } = require(resolve('src/sillytavern-extension/controller.ts'));
const { inspectTowerNodeBatchResult, parseTowerNodeBatchResult } = require(resolve('src/game-core/towerRequest.ts'));
const { createRunState } = require(resolve('src/game-core/runState.ts'));
const { runMapContentKind } = require(resolve('src/game-core/runMap.ts'));
const { createTowerEncounterPlan } = require(resolve('src/game-core/towerEncounterPlan.ts'));
const { recommendTowerBattleRewardBudget } = require(resolve('src/game-core/contentBudget.ts'));
const content = require(resolve('src/game-core/towerContentState.ts'));
const tower = require(resolve('src/runtime/towerStateAdapter.ts'));
const { DESIGN_ASSISTANT_CARD_SCOPE, DESIGN_ASSISTANT_EXTENSION_ID, DEFAULT_DESIGN_ASSISTANT_SETTINGS } = require(resolve('src/sillytavern-extension/types.ts'));
const { TowerGenerationCancelledError } = require(resolve('src/sillytavern-extension/towerGenerationQueue.ts'));
const { createGlobalTowerGenerationPorts } = require(resolve('src/sillytavern-extension/towerGenerationHost.ts'));

function harness(options = {}) {
  let variables = { stat_data:{ game_mode:'tower', game_mode_lock:{schemaVersion:1,mode:'tower'},
    battle:{core:{emoji:'🪡',hp:28,max_hp:30,lust:0,max_lust:100},
      cards:[{id:'strike',name:'刺击',type:'Attack',rarity:'Common',cost:1,quantity:5,effects:{damage:6}}],
      statuses:[],artifacts:[],items:[],player_abilities:[],player_status_effects:[],enemy:null,enemies:[]},
    run:createRunState({seed:4401}) }, __magic_girl_world:{battle_session:{state:{marker:'live battle',turn:3}}} };
  const selected = ['battle','event'].map(kind=>variables.stat_data.run.map.nodes.find(n=>runMapContentKind(n)===kind));
  assert.ok(selected.every(Boolean));
  const jobs = selected.map(node=>{
    const queued=content.queueTowerNodeContent(variables.stat_data.run.nodeContent,node.id,variables.stat_data.run.stateRevision);
    variables.stat_data.run.nodeContent=queued.store;
    return tower.claimTowerGenerationInStat(variables.stat_data,node.id,queued.envelope.requestId).request;
  });
  const calls=[], writes=[], writeAttempts=[], events=[];
  const context={chatId:'batch-chat',chat:[{mes:'kept story'}],characterId:0,groupId:null,
    characters:[{data:{extensions:{magic_girl_world:{design_assistant_scope:DESIGN_ASSISTANT_CARD_SCOPE}}}}],
    extensionSettings:{[DESIGN_ASSISTANT_EXTENSION_ID]:{...DEFAULT_DESIGN_ASSISTANT_SETTINGS,enabled:false}},
    chatMetadata:{},saveMetadataDebounced(){},saveSettingsDebounced(){},
    eventSource:{on(){},removeListener(){}},eventTypes:{}};
  const response = () => ({spec:'mwg.tower-node-batch-result/v1',batch_id:'batch-44',based_on_revision:jobs[0].revision,
    results:jobs.map(job=>({spec:'mwg.tower-node-result/v1',node_id:job.nodeId,request_id:job.requestId,
      based_on_revision:job.revision,kind:job.kind,title:'原作者标题',narrative:'原作者叙事',
      ...(job.kind==='battle'?{payload:{battle:{enemies:Array.from({length:createTowerEncounterPlan(job).enemyCount},(_,i)=>({id:`moth_${i}`,name:'书蛾',emoji:'🦋',hp:40,max_hp:40,lust:0,max_lust:100,
        actions:[{id:'hit',name:'振翅',effects:{damage:5}}]})),statuses:[{id:'retain',name:'保留',type:'buff',
          triggers:{hold:{card_rule:'retain_hand',limit:1}}}]}},
        reward:{card:[0,1,2].map(i=>({id:`reward_${i}`,name:`奖励${i}`,type:'Attack',rarity:recommendTowerBattleRewardBudget(job).cards.slotRarities[i],cost:1,effects:{damage:8}})),
          item:[{id:'potion',name:'药膏',count:1,effects:{heal:6}}],artifact:[]}}
        :{payload:{event:{choices:[{id:'accept',label:'接受',outcome:{gold:5}},{id:'leave',label:'离开',outcome:{}}]}}})}))});
  const host={context:()=>context,mvu:()=>({getMvuData:()=>variables,replaceMvuData:async next=>{
    writeAttempts.push(structuredClone(next));
    if(options.writeError)throw Error('injected write failure');
    writes.push(structuredClone(next));variables=structuredClone(next);
  }}),now:()=>44,notify(){}};
  const ports = {
    currentChatId:()=>context.chatId,createChatMessages:async()=>{throw Error('no archive floor');},
    generate:async config=>{calls.push(config);return options.generate
      ? options.generate({index:calls.length,config,response:response(),variables,context,jobs})
      : JSON.stringify(response());},
    stopGenerationById:()=>true,emitInternalEvent:async(name,payload)=>{events.push({name,payload});if(options.eventError)throw Error('injected event failure');},
  };
  if (options.textDelivery) {
    context.chatCompletionSettings={chat_completion_source:'custom',custom_model:'aux-fixture',custom_url:'https://fixture.invalid/v1'};
    let authored;
    const fetchHost={location:{href:'http://127.0.0.1:8012/'},fetch:async()=>new Response(JSON.stringify({choices:[{
      index:0,finish_reason:'stop',message:{role:'assistant',content:options.reasoningOnly?'':authored,
        reasoning_content:options.reasoningOnly?authored:'PRIVATE_REASONING_NOT_GAME_DATA'},
    }]}),{headers:{'Content-Type':'application/json'}})};
    const generate=ports.generate;
    const native=createGlobalTowerGenerationPorts({generateRaw:async config=>{
      for(const key of ['json_schema','tools','tool_choice','custom_api','deepseek_thinking_mode'])
        assert.equal(Object.hasOwn(config,key),false,`ordinary node request contains ${key}`);
      assert.ok(config.ordered_prompts.some(p=>typeof p==='object'&&p.content.includes('[MWG_SCHEMA_COMPATIBILITY/v1]')));
      authored=await generate(config);
      const response=await fetchHost.fetch('/api/backends/chat-completions/generate',{method:'POST',body:JSON.stringify({
        messages:config.ordered_prompts.filter(x=>typeof x==='object'),stream:false,chat_completion_source:'custom',
        model:context.chatCompletionSettings.custom_model,custom_url:context.chatCompletionSettings.custom_url,
      })});
      return (await response.json()).choices[0].message.content;
    },stopGenerationById:()=>true},()=>context,fetchHost);
    ports.generate=native.generate;ports.takeStructuredResponseDelivery=native.takeStructuredResponseDelivery;
    ports.stopGenerationById=native.stopGenerationById;
  }
  const controller = new DesignAssistantController(host,undefined,ports,{towerCoordinator:false});
  controller.activate();
  const request={generationType:'batch',batchId:'batch-44',requestId:'batch-44',basedOnRevision:jobs[0].revision,
    jobs,prompt:'生成两个独立闭合节点',maxAttempts:1};
  return {controller,request,jobs,calls,writes,writeAttempts,events,context,response,variables:()=>variables};
}
const h=harness();
const original=structuredClone(h.variables());
await h.controller.requestTowerGeneration(h.request);
assert.equal(h.calls.length,2,'one authoring plus one bounded repair, never per-node extra calls');
assert.deepEqual(h.calls.map(config=>config.empty_json_fallback),[false,false], 'ordinary nonempty batch repair keeps its original transport');
assert.equal(h.writes.length,1,'ready and failed envelopes persist atomically');
const store=h.variables().stat_data.run.nodeContent;
assert.equal(store[h.jobs[0].nodeId].phase,'failed');
assert.match(store[h.jobs[0].nodeId].error,/this card_rule does not accept limit/);
assert.equal(Object.hasOwn(store[h.jobs[0].nodeId],'content'),false,'failed node must not publish the invalid candidate');
assert.equal(Object.hasOwn(store[h.jobs[0].nodeId],'reward'),false,'failed node must not publish candidate rewards');
assert.equal(store[h.jobs[1].nodeId].phase,'ready','independently valid event survives invalid battle');
assert.deepEqual(h.variables().stat_data.battle,original.stat_data.battle);
assert.deepEqual(h.variables().__magic_girl_world,original.__magic_girl_world);
assert.equal(h.variables().stat_data.run.stateRevision,original.stat_data.run.stateRevision);
assert.equal(h.events.length,1);
assert.equal(h.events[0].payload.batchOutcome.outcome,'partial');
assert.deepEqual(h.events[0].payload.batchOutcome.readyNodeIds,[h.jobs[1].nodeId]);
assert.deepEqual(h.events[0].payload.batchOutcome.failedNodeIds,[h.jobs[0].nodeId]);
assert.equal(h.events[0].payload.parsedResult.spec,'mwg.tower-node-batch-commit/v1','partial completion must not masquerade as a complete wire batch');
assert.equal(h.events[0].payload.parsedResult.results.length,1);
const callsBefore=h.calls.length;
await h.controller.requestTowerGeneration(h.request);
assert.equal(h.calls.length,callsBefore,'duplicate request does not reroll partial success');
h.controller.deactivate();

// Content-only partitioning must not weaken the existing strict parser.
const shape=harness();
const descriptors=shape.jobs.map(j=>({...j,basedOnRevision:j.revision}));
const invalid=shape.response();invalid.results[0].payload.battle.enemies[0].actions=[];
assert.throws(()=>parseTowerNodeBatchResult(JSON.stringify(invalid),'batch-44',descriptors));
const assessment=inspectTowerNodeBatchResult(JSON.stringify(invalid),'batch-44',descriptors);
assert.equal(assessment.entries[0].ok,false);assert.equal(assessment.entries[1].ok,true);
for (const mutate of [
  d=>d.batch_id='wrong',d=>d.based_on_revision++,d=>d.results.reverse().pop(),
  d=>d.results[1].node_id=d.results[0].node_id,d=>d.results[1].node_id='unknown',
  d=>d.results[1].request_id='wrong',d=>d.results[1].based_on_revision++,d=>d.results[1].kind='rest',
  d=>d.results[1].spec='wrong',
]){const candidate=structuredClone(invalid);mutate(candidate);assert.throws(()=>inspectTowerNodeBatchResult(JSON.stringify(candidate),'batch-44',descriptors));}
shape.controller.deactivate();

const fixBattle = response => { delete response.results[0].payload.battle.statuses[0].triggers.hold.limit; return response; };
// A structurally valid reward must not publish a definite delayed-damage claim
// whose effects only do immediate damage. The AI, not a program default, repairs it.
for (const mode of ['fixed', 'unchanged', 'prose-erased', 'prose-reworded', 'condition-evasion']) {
  const semantic = harness({ generate: ({ index, response }) => {
    fixBattle(response);
    response.results[0].reward.card[0] = { id: 'literal_delay', name: '延迟测试', type: 'Attack', rarity: 'Common', cost: 1,
      description: '造成5点伤害；下一回合开始时，对该敌人再造成5点伤害。',
      effects: [{ damage: 5, to: 'opponent' }] };
    if (index === 2 && mode === 'fixed') response.results[0].reward.card[0].effects.push({ schedule: 1, phase: 'turn_start', effects: { damage: 5, to: 'opponent' } });
    if (index === 2 && mode === 'prose-erased') delete response.results[0].reward.card[0].description;
    if (index === 2 && mode === 'prose-reworded') response.results[0].reward.card[0].description = '钟声回荡。';
    if (index === 2 && mode === 'condition-evasion') response.results[0].reward.card[0].effects[0].when = 'turn_number > 0';
    return JSON.stringify(response);
  } });
  const original = structuredClone(semantic.variables());
  await semantic.controller.requestTowerGeneration(semantic.request);
  assert.equal(semantic.calls.length, 2, 'explicit delayed claim must enter the existing single repair budget');
  const store = semantic.variables().stat_data.run.nodeContent;
  assert.equal(store[semantic.jobs[0].nodeId].phase, mode === 'fixed' ? 'ready' : 'failed');
  assert.equal(store[semantic.jobs[1].nodeId].phase, 'ready');
  assert.equal(semantic.writes.length, 1);
  assert.deepEqual(semantic.variables().stat_data.battle, original.stat_data.battle);
  assert.deepEqual(semantic.variables().__magic_girl_world, original.__magic_girl_world);
  semantic.controller.deactivate();
}
// Real transport/host/controller chain with a synthetic ordinary text response.
// Text delivery must still spend the SAME single structural repair, preserve the
// valid sibling and live player state, then publish exactly one atomic write.
for(const repairMode of ['fixed','still-invalid','wrong-scope']) {
  const aux=harness({textDelivery:true,generate:({index,response})=>{
    if(index===2&&repairMode==='fixed')fixBattle(response);
    if(index===2&&repairMode==='wrong-scope')response.batch_id='unrelated';
    return JSON.stringify(response);
  }});
  const before=structuredClone(aux.variables());
  await aux.controller.requestTowerGeneration(aux.request);
  assert.equal(aux.calls.length,2,'one authoring plus one repair; no transport-local retry');
  assert.equal(aux.writes.length,1,'partial or complete results are committed atomically');
  assert.deepEqual(aux.variables().stat_data.battle,before.stat_data.battle);
  assert.deepEqual(aux.variables().__magic_girl_world,before.__magic_girl_world);
  const store=aux.variables().stat_data.run.nodeContent;
  assert.equal(store[aux.jobs[0].nodeId].phase,repairMode==='fixed'?'ready':'failed');
  assert.equal(store[aux.jobs[1].nodeId].phase,'ready');
  assert.deepEqual(store[aux.jobs[1].nodeId].content,aux.response().results[1]);
  await aux.controller.requestTowerGeneration(aux.request);assert.equal(aux.calls.length,2,'repeat callback does not generate again');
  aux.controller.deactivate();
}
// A provider's private reasoning cannot substitute for an absent final answer.
{
  const missing=harness({textDelivery:true,reasoningOnly:true});
  const before=structuredClone(missing.variables());
  await assert.rejects(missing.controller.requestTowerGeneration(missing.request),/没有返回可写入/);
  assert.equal(missing.calls.length,1);
  assert.equal(missing.writes.length,1,'only failure envelopes are persisted');
  assert.deepEqual(missing.variables().stat_data.battle,before.stat_data.battle);
  assert.deepEqual(missing.variables().__magic_girl_world,before.__magic_girl_world);
  for(const job of missing.jobs){
    const entry=missing.variables().stat_data.run.nodeContent[job.nodeId];
    assert.equal(entry.phase,'failed');
    assert.equal(Object.hasOwn(entry,'content'),false);
    assert.equal(Object.hasOwn(entry,'reward'),false);
  }
  missing.controller.deactivate();
}
// Empty-final recovery and authored repair share one extra model request.
for (const repairMode of ['success','still-invalid','cancel']) {
  const recovering=harness({generate:({index,config,response,context})=>{
    if(index===1){assert.equal(config.empty_json_fallback,false);return '';}
    assert.equal(config.empty_json_fallback,true);
    assert.equal(index,2,'a third call is forbidden');
    if(repairMode==='cancel'){context.chatId='different-chat';throw new TowerGenerationCancelledError();}
    return JSON.stringify(repairMode==='success'?fixBattle(response):response);
  }});
  recovering.request.maxAttempts=2;
  const before=structuredClone(recovering.variables());
  if(repairMode==='cancel')await assert.rejects(recovering.controller.requestTowerGeneration(recovering.request));
  else await recovering.controller.requestTowerGeneration(recovering.request);
  assert.equal(recovering.calls.length,2);
  assert.deepEqual(recovering.variables().stat_data.battle,before.stat_data.battle);
  assert.deepEqual(recovering.variables().__magic_girl_world,before.__magic_girl_world);
  const recoveredStore=recovering.variables().stat_data.run.nodeContent;
  if(repairMode==='cancel')assert.equal(recovering.writes.length,0);
  else {
    assert.equal(recoveredStore[recovering.jobs[0].nodeId].phase,repairMode==='success'?'ready':'failed');
    assert.equal(recoveredStore[recovering.jobs[1].nodeId].phase,'ready');
    assert.deepEqual(recoveredStore[recovering.jobs[1].nodeId].content,recovering.response().results[1]);
    assert.equal(recovering.writes.length,1);
    await recovering.controller.requestTowerGeneration(recovering.request);
    assert.equal(recovering.calls.length,2,'duplicate completion never rerolls');
  }
  recovering.controller.deactivate();
}
for (const [name, generate, expectedReady, expectedCalls] of [
  ['all valid first response',({response})=>JSON.stringify(fixBattle(response)),2,1],
  ['bounded repair fixes bad node',({index,response})=>JSON.stringify(index===2?fixBattle(response):response),2,2],
  ['repair cannot rewrite valid sibling',({index,response})=>{
    if(index===2){
      fixBattle(response);
      response.results[1].title='unrequested rewrite';
      response.results[1].narrative='unrequested narrative rewrite';
      response.results[1].payload.event.choices[0].label='unrequested choice rewrite';
      response.results[1].payload.event.choices[0].outcome={gold:999,heal:8};
    }
    return JSON.stringify(response);
  },2,2],
  ['repair transport failure retains original good node',({index,response})=>{if(index===2)throw Error('upstream unavailable');return JSON.stringify(response);},1,2],
  ['repair malformed JSON retains original good node',({index,response})=>index===2?'not json':JSON.stringify(response),1,2],
  ['repair duplicate identity cannot be masked by preservation',({index,response})=>{
    if(index===2){fixBattle(response);response.results[1].node_id=response.results[0].node_id;}
    return JSON.stringify(response);
  },1,2],
  ['repair foreign request cannot be masked by preservation',({index,response})=>{
    if(index===2){fixBattle(response);response.results[1].request_id='wrong';}
    return JSON.stringify(response);
  },1,2],
]) {
  const test=harness({generate});
  const originalSibling=structuredClone(test.response().results[1]);
  await test.controller.requestTowerGeneration(test.request);
  const store=test.variables().stat_data.run.nodeContent;
  assert.equal(test.jobs.filter(j=>store[j.nodeId].phase==='ready').length,expectedReady,name);
  assert.equal(test.calls.length,expectedCalls,name);
  assert.equal(test.writes.length,1,name);
  assert.deepEqual(store[test.jobs[1].nodeId].content,originalSibling,`${name}: complete authored sibling remains unchanged`);
  assert.equal(test.events[0].payload.batchOutcome.outcome,expectedReady===2?'complete':'partial',name);
  test.controller.deactivate();
}

// A repair wait must not restore the old active battle session or unrelated
// root fields even when the map revision has not changed.
const fresh=harness({generate:({index,response,variables})=>{
  if(index===2){variables.__magic_girl_world.battle_session.state.turn=77;variables.stat_data.battle.core.hp=24;variables.other={retained:true};}
  return JSON.stringify(response);
}});
await fresh.controller.requestTowerGeneration(fresh.request);
assert.equal(fresh.variables().__magic_girl_world.battle_session.state.turn,77);
assert.equal(fresh.variables().stat_data.battle.core.hp,24);
assert.deepEqual(fresh.variables().other,{retained:true});
fresh.controller.deactivate();

// Definitions in a different future node are not player-owned dependencies.
// Full activation validation still runs independently for each saved result.
const closed=harness({generate:({response})=>{
  fixBattle(response);
  response.results[1].payload.event.choices[0].outcome.reward={cards:[{
    id:'borrowed_status_card',name:'引用未拥有状态',type:'Skill',rarity:'Common',cost:1,
    effects:{apply_status:'retain',stacks:1,to:'self'},
  }]};
  return JSON.stringify(response);
}});
await closed.controller.requestTowerGeneration(closed.request);
assert.equal(closed.variables().stat_data.run.nodeContent[closed.jobs[0].nodeId].phase,'ready');
assert.equal(closed.variables().stat_data.run.nodeContent[closed.jobs[1].nodeId].phase,'failed');
assert.deepEqual(closed.variables().stat_data.battle.statuses,[],'future-node definitions never leak into the live registry');
closed.controller.deactivate();

// A candidate valid before repair must be rejected if its live dependency was
// removed while waiting, even with an unchanged run revision.
const dependency=harness({generate:({index,response,variables})=>{
  if(index===2)variables.stat_data.battle.statuses=[];
  response.results[1].payload.event.choices[0].outcome.reward={cards:[{
    id:'live_ref_card',name:'依赖实时状态',type:'Skill',rarity:'Common',cost:1,
    effects:{apply_status:'owned_status',stacks:1,to:'self'},
  }]};
  return JSON.stringify(response);
}});
dependency.variables().stat_data.battle.statuses=[{id:'owned_status',name:'已登记状态',type:'buff',triggers:{tick:{block:1,to:'self'}}}];
await assert.rejects(dependency.controller.requestTowerGeneration(dependency.request));
assert.equal(dependency.jobs.some(j=>dependency.variables().stat_data.run.nodeContent[j.nodeId].phase==='ready'),false);
assert.deepEqual(dependency.variables().stat_data.battle.statuses,[]);
dependency.controller.deactivate();

// A syntax-only repair has no reliable parsed candidate registry. It must still
// see the exact player-owned definitions, not infer them from incomplete text.
const repairStatus={id:'time_debt',name:'偿时之债',emoji:'🧾',type:'debuff',stacks_change:-1,
  triggers:{turn_start:{damage:3,damage_type:'hp_loss',to:'self'}}};
const syntaxContext=harness({generate:({index,config,response})=>{
  if(index===1)return 'not JSON: reward mentions time_debt';
  assert.ok(config.user_input.includes(JSON.stringify(repairStatus)), 'batch syntax repair sees exact registered status');
  const facts=JSON.parse(config.user_input.split('\n').find(line=>line.startsWith('EXISTING_DEFINITIONS=')).slice('EXISTING_DEFINITIONS='.length));
  assert.deepEqual(facts.owned_content_ids,{cards:['strike'],artifacts:['owned_relic'],items:['owned_item']}, 'batch caller passes only owned IDs, not pending reward_0/potion');
  fixBattle(response);
  response.results[0].reward.card[0].effects={apply_status:'time_debt',stacks:2,to:'opponent'};
  return JSON.stringify(response);
}});
syntaxContext.variables().stat_data.battle.statuses=[structuredClone(repairStatus)];
syntaxContext.variables().stat_data.battle.artifacts=[{id:'owned_relic',name:'旧物',rarity:'Common',trigger:{on:'battle_start',effects:{block:1}}}];
syntaxContext.variables().stat_data.battle.items=[{id:'owned_item',name:'药剂',count:1,effects:{heal:1}}];
await syntaxContext.controller.requestTowerGeneration(syntaxContext.request);
assert.equal(syntaxContext.calls.length,2);
assert.equal(syntaxContext.writes.length,1);
assert.ok(syntaxContext.jobs.every(j=>syntaxContext.variables().stat_data.run.nodeContent[j.nodeId].phase==='ready'));
assert.deepEqual(syntaxContext.variables().stat_data.battle.statuses,[repairStatus]);
syntaxContext.controller.deactivate();

// Context is information, not permission to overwrite a conflicting definition.
const conflictingContext=harness({generate:({index,response})=>{
  if(index===1)return 'not JSON';
  fixBattle(response);
  response.results[0].reward.card[0].effects={apply_status:'time_debt',stacks:2,to:'opponent'};
  response.results[0].reward.card[0].statuses=[{...structuredClone(repairStatus),stacks_change:-2}];
  return JSON.stringify(response);
}});
conflictingContext.variables().stat_data.battle.statuses=[structuredClone(repairStatus)];
await conflictingContext.controller.requestTowerGeneration(conflictingContext.request);
assert.equal(conflictingContext.calls.length,2);
assert.equal(conflictingContext.variables().stat_data.run.nodeContent[conflictingContext.jobs[0].nodeId].phase,'failed');
assert.match(conflictingContext.variables().stat_data.run.nodeContent[conflictingContext.jobs[0].nodeId].error,/状态定义 ID 已存在但规则不同/);
assert.deepEqual(conflictingContext.variables().stat_data.battle.statuses,[repairStatus]);
conflictingContext.controller.deactivate();

// Discarded or superseded jobs remain untouched, while their current sibling
// can finish. A same-chat new run and a different message never receive this
// old batch or its failure callback.
for (const mode of ['abandoned','superseded','new-run','new-message','new-chat']) {
  let protectedEnvelope;
  const test=harness({generate:({index,response,variables,context,jobs})=>{
    if(index===2){
      if(mode==='new-run')variables.stat_data.run.seed++;
      else if(mode==='new-message')context.chat.push({mes:'new floor'});
      else if(mode==='new-chat')context.chatId='different-chat';
      else {const e=variables.stat_data.run.nodeContent[jobs[0].nodeId];
        if(mode==='abandoned')e.phase='abandoned';else e.requestId='newer-request';
        protectedEnvelope=structuredClone(e);
      }
    }
    return JSON.stringify(response);
  }});
  if(mode.startsWith('new-')){
    await assert.rejects(test.controller.requestTowerGeneration(test.request));
    assert.equal(test.writes.length,0,mode);assert.equal(test.events.length,0,mode);
  }else{
    await test.controller.requestTowerGeneration(test.request);
    assert.deepEqual(test.variables().stat_data.run.nodeContent[test.jobs[0].nodeId],protectedEnvelope,mode);
    assert.equal(test.variables().stat_data.run.nodeContent[test.jobs[1].nodeId].phase,'ready',mode);
    assert.deepEqual(test.events[0].payload.batchOutcome.ignoredNodeIds,[test.jobs[0].nodeId],mode);
  }
  test.controller.deactivate();
}
for(const mode of ['all-content-bad','initial-scope-bad','write-error','event-error','cancel']){
  const test=harness({writeError:mode==='write-error',eventError:mode==='event-error',generate:({index,response})=>{
    if(mode==='cancel'&&index===2)throw new TowerGenerationCancelledError();
    if(mode==='initial-scope-bad')response.results[1].request_id='wrong';
    if(mode==='all-content-bad')response.results[1].payload.event.choices=[];
    return JSON.stringify(response);
  }});
  await assert.rejects(test.controller.requestTowerGeneration(test.request));
  assert.ok(test.calls.length<=2,mode);
  const store=test.variables().stat_data.run.nodeContent;
  if(mode==='event-error'){
    assert.equal(store[test.jobs[1].nodeId].phase,'ready','notification failure cannot undo durable partial success');
    assert.equal(store[test.jobs[0].nodeId].phase,'failed');
    assert.match(store[test.jobs[0].nodeId].error,/this card_rule does not accept limit/);
    assert.equal(Object.hasOwn(store[test.jobs[0].nodeId],'content'),false);
    assert.equal(Object.hasOwn(store[test.jobs[0].nodeId],'reward'),false);
    assert.equal(test.writes.length,1,'exactly one durable partial commit');
    assert.equal(test.writeAttempts.length,1,'notification failure must not attempt another MVU write');
    assert.equal(test.events.length,1,'completion is dispatched once after persistence');
    assert.deepEqual(test.variables(),test.writes[0],'notification failure preserves the entire persisted root');
    assert.deepEqual(store[test.jobs[1].nodeId].content,test.response().results[1]);
  }else assert.equal(test.jobs.some(j=>store[j.nodeId].phase==='ready'),false,mode);
  if(mode==='write-error')assert.equal(test.events.length,0,'no completion before persistence succeeds');
  test.controller.deactivate();
}
console.log('PASS scoped batch isolation: one bounded repair, independent valid node retained, failed node retryable, atomic MVU/no player mutation, explicit partial completion, strict identity and duplicate handling.');
