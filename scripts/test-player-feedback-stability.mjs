import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const repair=require('../src/runtime/mvuExtraModelRepair.ts');
const {reconcileNaturalLanguageVariableRepair}=require('../src/runtime/naturalLanguageVariableRepair.ts');
const bootstrap=ts.transpileModule(fs.readFileSync('src/runtime/viewBootstrap.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES5,removeComments:true}}).outputText;
assert.ok(!['<','`','?.'].some(token=>bootstrap.includes(token)),'exported regex shells must remain safe for Tavern Helper reparsing');
async function mount({view='start',stat={},text='',ready=async()=>{},read=()=>({stat_data:stat})}={}) {
 const selected=[];
 const node=()=>({dataset:{},style:{},children:[],setAttribute(){},appendChild(v){this.children.push(v)},replaceChildren(){this.children=[]}});
 const document={documentElement:node(),head:node(),body:node(),createElement:node};
 const api={spec:'mwg.tavern-runtime/v1',version:'test',getMessageText:()=>text,getMessageVariables:read,waitForMessageReady:ready,getViewAsset:v=>{selected.push(v);return{title:v,bodyHtml:'<main/>',styles:'body{}',script:'void 0'}}};
 const context=vm.createContext({document,window:{setTimeout:()=>0},__MWG_VIEW_NAME__:view,__MWG_CARD_VERSION__:'test',getCurrentMessageId:()=>0,getLastMessageId:()=>0,waitGlobalInitialized:async()=>api});
 vm.runInContext(bootstrap,context);
 await new Promise(r=>setImmediate(r));
 return {selected,document,context};
}
assert.deepEqual((await mount({stat:{game_mode:'story'}})).selected,['start'],'initvar default must not skip character setup');
assert.deepEqual((await mount({text:'[开始游戏] [剧情模式开场]',stat:{game_mode:'story'}})).selected,['start']);
for(const mode of ['story','tower']) assert.deepEqual((await mount({stat:{game_mode:'story',game_mode_lock:{schemaVersion:1,mode}}})).selected,['common']);
assert.deepEqual((await mount({text:'[爬塔模式开场]'})).selected,['common']);
let restored=false;
assert.deepEqual((await mount({ready:async()=>{await Promise.resolve();restored=true},read:()=>{assert.ok(restored);return{stat_data:{game_mode_lock:{schemaVersion:1,mode:'tower'}}}}})).selected,['common']);
const unavailable=await mount({ready:async()=>{throw Error('MVU not ready')}});
assert.deepEqual(unavailable.selected,[]);
assert.match(unavailable.document.body.children[0].textContent,/MVU not ready/);

let rejectOld;
const oldView=await mount({ready:()=>new Promise((_,reject)=>{rejectOld=reject})});
oldView.context.__MWG_RUNTIME_MOUNT_EPOCH__++;
oldView.document.body.innerHTML='new view';
rejectOld(Error('late old failure'));
await new Promise(r=>setImmediate(r));
assert.equal(oldView.document.body.innerHTML,'new view');
assert.equal(oldView.document.body.children.length,0,'a stale readiness failure cannot replace the new mounted UI');

// The production character-script method owns native MVU work even when a
// message iframe is reconstructed, including duplicate-submit coalescing.
const source=fs.readFileSync('src/runtime/characterRuntime.ts','utf8');
const method=source.slice(source.indexOf('    requestMvuExtraRepair(request:'),source.indexOf('    requestRestMutation(request:'));
let chatId='story-a',message='当前剧情',calls=0;
const original={stat_data:{status:{time:'晚上',location:'城门'},battle:{cards:[]}},user_owned:{keep:true}};
let data=structuredClone(original);
const host={getLastMessageId:()=>1,getChatMessages:()=>[{message,swipe_id:0}],getVariables:o=>o.type==='global'?{}:vm.runInNewContext('('+JSON.stringify(o.message_id===0?{stat_data:{status:{time:'早上',location:'城门'},battle:{cards:[]}}}:data)+')'),replaceVariables:v=>{data=structuredClone(v)},getAllEnabledScriptButtons:()=>({mvu:[{button_name:'重试额外模型解析',button_id:'retry'}]}),getScriptTrees:()=>[],setChatMessages:async updates=>{message=updates[0].message},eventEmit:async()=>{calls++;data={stat_data:{status:{time:'早上',location:'塔楼'},battle:{cards:[]}}};message+='\n<UpdateVariable>_.set("status.location", "塔楼");</UpdateVariable>'}};
const context=vm.createContext({host,registryHost:{SillyTavern:{getContext:()=>({chatId})}},mvuMonitor:{getSnapshot:()=>({chatId})},destroyed:false,nativeRepairRequests:new Map(),retryMessageWithExtraModelHost:repair.retryMessageWithExtraModelHost,reconcileNaturalLanguageVariableRepair});
vm.runInContext(ts.transpileModule('this.api={'+method+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
const request={spec:'mwg.mvu-repair-request/v1',scope:'stat-data',prompt:'[玩家自然语言变量修改] 把地点改为塔楼'};
const first=context.api.requestMvuExtraRepair(request), duplicate=context.api.requestMvuExtraRepair(request);
assert.equal(first,duplicate);
await first;
assert.equal(calls,1);
assert.equal(data.stat_data.status.time,'晚上','cross-realm previous-floor reset must not erase current prose state');
assert.equal(data.stat_data.status.location,'塔楼');
assert.deepEqual(data.user_owned,original.user_owned);
assert.doesNotMatch(message,/MWG_REPAIR_REQUEST_BEGIN/);
assert.equal(context.nativeRepairRequests.size,0);
const beforeSwitch=structuredClone(data);
const pending=context.api.requestMvuExtraRepair(request);chatId='story-b';
await assert.rejects(pending,/聊天已切换/);
assert.deepEqual(data,beforeSwitch);
assert.equal(context.nativeRepairRequests.size,0);
console.log('PASS saved-view bootstrap, initvar setup, readiness failure, persistent native MVU retry, cross-realm delta, duplicate submit and chat isolation');
