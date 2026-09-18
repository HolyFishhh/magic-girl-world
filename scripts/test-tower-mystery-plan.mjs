import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const mystery = require('../src/game-core/towerMystery.ts');
const plans = require('../src/game-core/towerDungeonPlan.ts');
const runCore = require('../src/game-core/runState.ts');
const mapCore = require('../src/game-core/runMap.ts');
const requests = require('../src/game-core/towerRequest.ts');
const adapter = require('../src/runtime/towerStateAdapter.ts');
const presenter = require('../src/tower/towerMapPresenter.ts');
const { buildTowerSemanticMvuContext } = require('../src/sillytavern-extension/towerCoordinator.ts');
const clone = value => JSON.parse(JSON.stringify(value));
const counts = fn => Array.from({length:100},(_,i)=>fn(i)).reduce((out,key)=>(out[key]=(out[key]||0)+1,out),{});
assert.deepEqual(counts(mystery.mysteryKindFromRoll), {event:70,battle:20,shop:10});
assert.deepEqual(counts(mystery.eventToneFromRoll), {good:50,risk:30,bad:20});
const distribution = {event:0,battle:0,shop:0,good:0,risk:0,bad:0};
for(let i=0;i<10000;i++) {
  const roll=mystery.rollTowerMystery(i,i+91);
  distribution[roll.kind]++; distribution[roll.tone]++;
  assert.deepEqual(roll,mystery.rollTowerMystery(i,i+91));
  assert.equal(roll.roomRoll,mystery.rollTowerMystery(i,i+92).roomRoll);
  assert.equal(roll.eventRoll,mystery.rollTowerMystery(i+1,i+91).eventRoll);
}
for(const [key,expected] of Object.entries({event:.7,battle:.2,shop:.1,good:.5,risk:.3,bad:.2}))
  assert.ok(Math.abs(distribution[key]/10000-expected)<.025,JSON.stringify(distribution));
const seen = new Set();
for(let seed=1;seed<=80 && (seed<=10 || seen.size<3);seed++) {
  let run=runCore.createRunState({seed});
  const restored=clone(run);
  assert.equal(runCore.validateRunState(restored).ok,true);
  assert.equal(mapCore.validateRunMap(restored.map).ok,true);
  assert.deepEqual(restored.map,runCore.createRunState({seed}).map);
  for(const id of run.map.acts[0].paths[0]) {
    const node=run.map.nodes.find(n=>n.id===id),kind=mapCore.runMapContentKind(node);
    const choice=run.choices.find(n=>n.id===id); assert.ok(choice);
    assert.equal(choice.kind,kind); assert.equal(run.nodeContent[id].kind,kind);
    assert.equal(adapter.collectTowerLookahead(run,1,3).find(n=>n.nodeId===id)?.kind,kind);
    if(node.mystery) {
      seen.add(kind);
      run.nodeContent[id].content={title:'秘密名称',narrative:'秘密剧情'};
      run.nodeContent[id].phase='ready';
      const before=presenter.createTowerMapPresentation(run).nodes.find(n=>n.node.id===id);
      assert.equal(before.type.label,'未知'); assert.equal(before.narrative,'');
      assert.doesNotMatch(before.ariaLabel,/秘密|商店|战斗/);
      if(kind==='event') {
        const job={nodeId:id,requestId:'test',basedOnRevision:0,kind,act:node.act,floor:node.floor,
          contentSeed:node.contentSeed,rewardSeed:node.rewardSeed,difficultyMultiplier:1};
        const prompt=requests.formatTowerNodeGenerationPrompt(job,{difficultyPercent:100});
        assert.ok(prompt.includes(mystery.towerEventToneGuidance(node.rewardSeed)));
      }
    }
    run=runCore.enterRunNode(run,id);
    assert.equal(run.currentNode.kind,kind);
    const after=presenter.createTowerMapPresentation(run).nodes.find(n=>n.node.id===id);
    assert.equal(after.type.label,presenter.getTowerNodeTypePresentation(kind).label);
    run=runCore.completeRunNode(run,{outcome:'cleared'});
  }
}
assert.deepEqual([...seen].sort(),['battle','event','shop']);
const old=clone(runCore.createRunState({seed:2}));
for(const node of [...old.map.nodes,...old.map.acts.flatMap(act=>act.nodes)]) delete node.mystery;
for(const node of old.map.nodes) old.nodeContent[node.id].kind=node.kind;
assert.equal(runCore.validateRunState(old).ok,true,'old maps retain their original event rooms');
const corrupted=clone(runCore.createRunState({seed:2}));
corrupted.map.nodes.find(n=>n.mystery).mystery.kind='rest';
assert.equal(mapCore.validateRunMap(corrupted.map).ok,false,'flattened map cannot change the pre-rolled encounter');

const plan={spec:plans.TOWER_DUNGEON_PLAN_SPEC,theme:'镜海',enemyTypes:['镜灵','潮汐卫兵'],mainSystems:['折射与潮汐'],
  bossDirection:'镜海女王',acts:[1,2,3].map(act=>({act,theme:`镜海第${act}幕`,enemies:'潮汐守卫',mechanics:'逐层增加折射联动',boss:'守门人',progression:'从辨识、组合到破解'}))};
const response=`<TOWER_DUNGEON_PLAN>${JSON.stringify(plan)}</TOWER_DUNGEON_PLAN>\n你来到镜海。`;
assert.deepEqual(plans.parseTowerPlannedNarrative(response),{narrative:'你来到镜海。',dungeonPlan:plan});
for(const invalid of ['没有规划',response+response,response.replace('"act":2','"act":1'),response.replace('"theme":"镜海"','"theme":null')])
  assert.throws(()=>plans.parseTowerPlannedNarrative(invalid));
const run=runCore.createRunState({seed:2});run.dungeonPlan=plan;
const saved=clone(run);assert.equal(runCore.validateRunState(saved).ok,true);assert.deepEqual(saved.dungeonPlan,plan);
const semantic=buildTowerSemanticMvuContext({stat_data:{run:saved,run_event_reveal:{outcome:{gold:77}}}});
assert.deepEqual(semantic.stat_data.run.dungeonPlan,plan); assert.equal('run_event_reveal' in semantic.stat_data,false);
assert.match(plans.towerDungeonPlanningPrompt(),/同一次响应完成/);
console.log('PASS mystery 70/20/10 and event 50/30/20, independent stable seeds, route/content/lookahead alignment, hidden map, old saves, plan parsing/persistence/generation context.');
