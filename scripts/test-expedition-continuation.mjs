import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const { finishExpeditionIntoStory, continueExpeditionStory } = require('../src/common/expeditionContinuation.ts');
const { TavernCommonActionHost } = require('../src/common/commonActionHost.ts');
const { readGameMode, migrateGameModeInStat } = require('../src/game-core/towerMode.ts');
const { describeCardCost } = require('../src/game-core/combatResource.ts');
const fixture = phase => ({game_mode:'tower',game_mode_lock:{schemaVersion:1,mode:'tower'},run:{phase,score:{defeatedEnemyScore:42}},run_node:{narrative:'archived'},battle:{core:{hp:0},cards:[{id:'keep'}]},custom:{untouched:true}});
for (const phase of ['won','lost']) {
  const stat = fixture(phase); const battle = stat.battle;
  finishExpeditionIntoStory(stat); migrateGameModeInStat(stat);
  assert.equal(readGameMode(stat),'story'); assert.equal(stat.run,null);
  assert.equal(stat.completed_expedition.run.phase,phase);
  assert.equal(stat.battle,battle); assert.deepEqual(stat.custom,{untouched:true});
  assert.equal(stat.run_node,undefined);
}
assert.throws(()=>finishExpeditionIntoStory(fixture('in_node')));
for (const failure of ['none','send','trigger']) {
  let variables={stat_data:fixture('lost')}; const original=structuredClone(variables);
  let sent=0, triggered=0;
  TavernCommonActionHost.instance=new TavernCommonActionHost({
    updateVariablesWith: fn => variables=fn(variables),
    createChatMessages: async messages => { assert.match(messages[0].message,/我的行动：继续/); if(failure==='send') throw Error('send'); sent++; },
    triggerSlash: async () => { triggered++; if(failure==='trigger') throw Error('trigger'); },
  });
  if(failure==='none') await continueExpeditionStory('继续');
  else await assert.rejects(continueExpeditionStory('继续'));
  if(failure==='send') { assert.deepEqual(variables,original); assert.equal(triggered,0); }
  else { assert.equal(readGameMode(variables.stat_data),'story'); assert.equal(sent,1); }
}
assert.match(describeCardCost(0),/⚡/); assert.match(describeCardCost(2),/⚡/);
assert.doesNotMatch(describeCardCost({energy:1,soul:2},{soul:{name:'魂',emoji:'💧'}}),/💎/);
console.log('Won/lost continuation, state preservation, failure rollback, trigger retry and energy labels passed.');
