import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {lockGameModeInStat}=require('../src/game-core/towerMode.ts');
const source=readFileSync('src/common/index.ts','utf8');
const fn=source.match(/async function persistTowerMode\([\s\S]*?(?=\n(?:async )?function )/)?.[0];
assert.ok(fn);
const js=ts.transpileModule(fn+'\nresult.persist=persistTowerMode;',{
  compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022},
}).outputText;
for(const old of [{game_mode:'tower'}, {game_mode:'story',game_mode_lock:{schemaVersion:1,mode:'story'}}]) {
  for(const config of [undefined,{}, {towerRequirements:'由玩家要求的敌人与事件规则'}]) {
    let message={stat_data:{...structuredClone(old),tower_requirements:'previous',status:{time:'authored'},battle:{cards:[]}},schema:{keep:true}};
    const original=structuredClone(message),result={};let writes=0,chatWrites=0;
    runInNewContext(js,{result,lockGameModeInStat,
      updateCurrentMessageVariablesWith:async update=>{writes++;message=await update(structuredClone(message));},
      updateCurrentChatVariablesWith:async()=>{chatWrites++;},
    });
    await result.persist(config);assert.equal(writes,1);
    assert.equal(chatWrites,0,'single-floor start owns the message, never a transient chat-scope MVU mirror');
    assert.deepEqual(message.stat_data.status,original.stat_data.status);
    assert.deepEqual(message.stat_data.battle,original.stat_data.battle);assert.deepEqual(message.schema,original.schema);
    assert.equal(message.stat_data.game_mode,old.game_mode);
    assert.equal(message.stat_data.tower_requirements,config?config.towerRequirements:original.stat_data.tower_requirements);
    const saved=JSON.stringify(message);await result.persist(config);assert.equal(JSON.stringify(message),saved,'idempotent message state');
  }
}
const result={};let writes=0;
runInNewContext(js,{result,lockGameModeInStat,
  updateCurrentMessageVariablesWith:async()=>{throw Error('historical/scope changed');},
  updateCurrentChatVariablesWith:async()=>{writes++;},
});
await assert.rejects(result.persist({towerRequirements:'x'}),/scope changed/);assert.equal(writes,0);
console.log('PASS single-floor start persists exact user requirements and immutable mode lock only on authoritative message; no chat mirror, authored defaults, or fallback write.');
