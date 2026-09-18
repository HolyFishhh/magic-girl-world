import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {extractTowerInitialRepairSlotTargets,parseTowerInitialSlotRepairResponse,mergeTowerInitialSlotRepair}=require('../src/sillytavern-extension/controller.ts');
const {createTowerInitialSlotRepairJsonSchema,TOWER_INITIAL_SLOT_REPAIR_SPEC}=require('../src/game-core/towerRequest.ts');
const {compileCompactEffectList}=require('../src/game-core/compactEffectDsl.ts');
const original={narrative:'剧情保持',status:{time:'黄昏'},player:{cards:[{
  id:'vent_shift',name:'均衡气流',type:'Skill',rarity:'Common',cost:1,quantity:1,effects:[
    {stance:{id:'balanced_flow',name:'均衡',emoji:'🌪️',events:[{on:'attack_played',scope:'turn',ordinal:'first',
      effects:{resource:{id:'pressure',amount:1},when:"self.has_stance('balanced_flow')"}}]}},
    {block:3},
  ],
}]},opening:{title:'馈赠',choices:[]}};
const parentPath='battle.cards[0].effects[0].stance.events[0].effects';
const childError=`${parentPath}.when：when 必须是会得到真/假的比较或逻辑条件，不能填写 true、数字或三元表达式（具体原因：Unsupported boolean CEL node: CallExpression）`;
const parentError=`${parentPath}：规则字段不符合浅层 effects 契约`;
const before=structuredClone(original);
const guarded=structuredClone(original);
guarded.player.cards[0].effects=[{guard:"self.has_stance('balanced_flow')",effects:[{block:3},{draw:1}]}];
const guardTargets=extractTowerInitialRepairSlotTargets(guarded,'battle.cards[0].effects[0].guard：不支持的条件公式');
assert.equal(guardTargets.length,1);
assert.deepEqual(guardTargets[0].slots.map(s=>({kind:s.kind,path:s.path})),[
  {kind:'condition',path:'player.cards[0].effects[0].guard'},
]);
const guardResponse={spec:TOWER_INITIAL_SLOT_REPAIR_SPEC,roots:{r0:{slots:{s0:{action:'replace_value',value:"self.stance == 'balanced_flow'"}}}},support_statuses:[],support_resources:[]};
const fixedGuard=mergeTowerInitialSlotRepair(guarded,guardTargets,parseTowerInitialSlotRepairResponse(guardResponse,guardTargets));
assert.deepEqual(fixedGuard.player.cards[0].effects[0].effects,guarded.player.cards[0].effects[0].effects);
assert.equal(compileCompactEffectList(fixedGuard.player.cards[0].effects).ok,true);
const nullGuard=structuredClone(guardResponse);nullGuard.roots.r0.slots.s0.value=null;
assert.throws(()=>parseTowerInitialSlotRepairResponse(nullGuard,guardTargets));
assert.throws(()=>mergeTowerInitialSlotRepair(guarded,guardTargets,nullGuard));
for(const errors of [[childError,parentError],[parentError,childError]]){
  const targets=extractTowerInitialRepairSlotTargets(original,errors.join('；'));
  assert.equal(targets.length,1);
  assert.deepEqual(targets[0].slots.map(s=>({kind:s.kind,path:s.path})),[
    {kind:'condition',path:parentPath.replace('battle.','player.')+'.when'},
  ],'cascading parent cannot unlock resource values or event rules');
  const validate=new Ajv2020({strict:false}).compile(createTowerInitialSlotRepairJsonSchema(targets).value);
  for(const condition of ["self.stance == 'balanced_flow'"]){
    const response={spec:TOWER_INITIAL_SLOT_REPAIR_SPEC,roots:{r0:{slots:{s0:{action:'replace_value',value:condition}}}},support_statuses:[],support_resources:[]};
    assert.equal(validate(response),true,JSON.stringify(validate.errors));
    const parsed=parseTowerInitialSlotRepairResponse(response,targets);
    const result=mergeTowerInitialSlotRepair(original,targets,parsed);
    const expected=structuredClone(original);
    const effect=expected.player.cards[0].effects[0].stance.events[0].effects;
    effect.when=condition;
    assert.deepEqual(result,expected,'only model-chosen condition may change');
    assert.equal(compileCompactEffectList(result.player.cards[0].effects).ok,true);
    const extra=structuredClone(response);extra.roots.r0.slots.s1={action:'replace_value',value:99};
    assert.throws(()=>parseTowerInitialSlotRepairResponse(extra,targets));
    for(const invalid of [null,'', 'true', '!self.took_damage_this_turn']) {
      const bad=structuredClone(response);bad.roots.r0.slots.s0.value=invalid;
      if(invalid===null)assert.equal(validate(bad),false,'schema must not advertise deletion');
      assert.throws(()=>parseTowerInitialSlotRepairResponse(bad,targets),/条件|限制/);
      assert.throws(()=>mergeTowerInitialSlotRepair(original,targets,bad),/条件|限制/,'direct merge also rejects condition removal');
    }
    const stale=structuredClone(original);stale.player.cards[0].effects[0].stance.events[0].effects.resource.amount=99;
    const preserved=mergeTowerInitialSlotRepair(stale,targets,parsed);
    assert.equal(preserved.player.cards[0].effects[0].stance.events[0].effects.resource.amount,99,
      'pure merge preserves the supplied source outside its write set; live freshness is checked at publication');
  }
}
const additional=structuredClone(original);additional.player.cards[0].effects[0].stance.events[0].effects.resource.amount={invalid:1};
assert.deepEqual(extractTowerInitialRepairSlotTargets(additional,`${childError}；${parentError}`),[],
  'parent with another compiler fault is not suppressed; overlapping writes fail closed');
const reasoned=`${parentError}（具体原因：其他错误）`;
assert.deepEqual(extractTowerInitialRepairSlotTargets(original,`${childError}；${reasoned}`),[],
  'a parent with its own detailed reason is not an incidental summary');
assert.deepEqual(original,before);
console.log('PASS condition repair: exact slot, legal equivalent stance condition, schema rejects null, parser/merge reject deletion and invalid formulas, sibling writes locked.');
