import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {describeCompactCard}=require(resolve('src/game-core/contentDescription.ts'));
const status={id:'deferred_clock_damage',name:'延迟报时伤害',triggers:{turn_start:{damage:6,damage_type:'hp_loss',to:'self'}},stacks_change:-1};
const card={type:'Skill',description:'造成6点伤害被延迟到本回合结束时结算。',effects:{apply_status:status.id,stacks:1,to:'opponent'}};
const options={statusNames:{[status.id]:status.name},statusDefinitions:{[status.id]:status}};
const before=structuredClone({card,options});
const text=describeCompactCard(card,options);
assert.match(text,/回合开始时/,'referenced actual trigger must be visible at the card');
assert.match(text,/自身.*持有者/,'nested self must not mean the caster');
assert.doesNotMatch(text,/伤害被延迟到本回合结束/);
assert.deepEqual({card,options},before);
assert.equal(describeCompactCard({...card,description:'任何虚构收益'},options),text);
const cyclic={...status,triggers:{turn_start:{apply_status:status.id,stacks:1,to:'self'}}};
const bounded=describeCompactCard(card,{...options,statusDefinitions:{[status.id]:cyclic}});
assert.ok(bounded.length<1000,'cyclic references are not recursively expanded');
assert.match(describeCompactCard(card,{...options,statusDefinitions:{}}),/状态定义不可用/);
assert.match(describeCompactCard(card,{...options,statusDefinitions:{[status.id]:{...status,id:'different'}}}),/状态定义不可用/);
assert.doesNotMatch(describeCompactCard(card,{statusNames:options.statusNames}),/状态定义不可用/,'legacy names-only caller remains supported');
console.log('PASS: referenced trigger timing, holder perspective, bounded cycle, missing identity and prose isolation');
if(process.argv[2]) {
  const file=process.argv[2],bytes=readFileSync(file);
  const battle=JSON.parse(bytes).root.stat_data.battle;
  const actual=battle.cards.find(c=>c.id==='chrono_tally');assert.ok(actual);
  const rendered=describeCompactCard(actual,{
    statusNames:Object.fromEntries(battle.statuses.map(s=>[s.id,s.name])),
    statusDefinitions:Object.fromEntries(battle.statuses.map(s=>[s.id,s])),
  });
  assert.match(actual.description,/本回合结束/);assert.match(rendered,/回合开始时/);
  assert.deepEqual(readFileSync(file),bytes);
  console.log('PASS retained live61: '+rendered);
}
