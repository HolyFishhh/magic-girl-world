import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync('src/common/index.ts','utf8');
const selection=source.slice(source.indexOf('  const readyReservedChoice ='),source.indexOf('  return true;',source.indexOf('  const readyReservedChoice =')));
assert.ok(selection.includes('activateTowerNode'));
function fixture(overrides={}){
 const calls=[];
 let finish;
 const context={run:{phase:'awaiting_choice',currentNode:null,opening:{phase:'consumed'},choices:[{id:'node_a'}],nodeContent:{node_a:{phase:'ready'}}},stat:{},selectionEnabled:true,__TOWER_PRESELECTED_NODE_ID:'node_a',__TOWER_PRESELECT_ACTIVATING_NODE_ID:null,__IS_SENDING_ACTION:false,isCurrentMessageLatest:()=>true,hasSelectableRewards:()=>false,activateTowerNode:(node,notice)=>{calls.push([node.id,notice]);return new Promise(resolve=>{finish=resolve;});},...overrides};
 const sandbox=vm.createContext(context);
 const execute=()=>vm.runInContext(`(()=>{${selection}})()`,sandbox);
 return {context,calls,execute,finish:()=>finish?.()};
}
const success=fixture();success.execute();success.execute();
assert.deepEqual(success.calls,[['node_a',true]],'ready reservation activates once and requests notice');
assert.equal(success.context.__TOWER_PRESELECTED_NODE_ID,null,'consume before asynchronous activation');
success.finish();await Promise.resolve();
for(const change of [c=>c.hasSelectableRewards=()=>true,c=>c.isCurrentMessageLatest=()=>false,c=>c.selectionEnabled=false,c=>c.__IS_SENDING_ACTION=true,c=>c.run.opening.phase='ready',c=>c.run.currentNode={id:'old'},c=>c.run.phase='in_node',c=>c.run.nodeContent.node_a.phase='generating',c=>c.run.nodeContent.node_a.phase='failed',c=>c.run.choices=[]]){
 const f=fixture();change(f.context);f.execute();assert.equal(f.calls.length,0,'pending, failed, reward, opening, locked or stale state cannot enter');
}
const activation=source.match(/async function activateTowerNode\([\s\S]*?\n\}/)?.[0];assert.ok(activation);
const js=ts.transpileModule(activation,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const fail of [false,true]){
 const notices=[],errors=[],focus=[],sending=[];
 const sandbox=vm.createContext({__IS_SENDING_ACTION:false,setSendingState:v=>sending.push(v),setRunButtonsDisabled:()=>{},runActionHost:{activateTowerRunNode:async()=>{if(fail)throw Error('fixture failed');}},requestUserFocus:id=>focus.push(id),toastr:{success:(...args)=>notices.push(args)},loadGameData:async()=>{},showRunError:(...args)=>errors.push(args),__PENDING_REWARD_SUMMARY:null,__PENDING_RUN_SUMMARY:null,__RUN_ERROR:null});
 vm.runInContext(js,sandbox);await vm.runInContext("activateTowerNode({id:'node_a'}, true)",sandbox);
 assert.equal(notices.length,fail?0:1,'only successful activation announces entry');assert.equal(errors.length,fail?1:0);assert.equal(focus.length,fail?0:1);assert.equal(sending.at(-1),false);
}
console.log('PASS preselected node actual UI gate: ready/duplicate/pending/failure/reward/opening/stale/locked and success-only notification');
