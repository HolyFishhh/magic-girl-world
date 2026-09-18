import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parse} from 'parse5';
import ts from 'typescript';
const markup=readFileSync('src/common/index.html','utf8'),nodes=[];
const walk=node=>{nodes.push(node);node.childNodes?.forEach(walk);};walk(parse(markup));
const id=node=>node.attrs?.find(a=>a.name==='id')?.value;
const save=nodes.findIndex(node=>id(node)==='tower-preset-save'),start=nodes.findIndex(node=>id(node)==='tower-start-button');
assert.ok(save>=0&&start>save);assert.equal(nodes.filter(node=>id(node)==='tower-preset-save').length,1);
assert.equal(nodes[save].childNodes[0].value,'保存当前预设');
const source=readFileSync('src/common/index.ts','utf8');
const fn=source.match(/async function startTowerFromPanel\([\s\S]*?(?=\n(?:async )?function )/)?.[0];assert.ok(fn);
const js=ts.transpileModule(fn+'\nresult.start=startTowerFromPanel;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
for(const ready of [true,false]){
 const result={},calls=[],config={name:'测试角色',towerRequirements:'保留玩法要求'};
 const context={result,__towerStartInFlight:false,__commonViewInitialized:false,
   isCurrentMessageLatest:()=>true,towerExtensionReadiness:()=>({ready,message:'未就绪'}),
   MagicGirlWorld:{startTowerSingleFloor:async request=>calls.push(['start',request]),reportMvuValidationFailure:err=>{throw err;}},
   getCurrentMessageVariableOptions:()=>({message_id:2}),readTowerStartConfig:()=>config,
   setTowerStartBusy:busy=>{context.__towerStartInFlight=busy;},setTowerStartStatus:()=>{},
   ensureMvuRuntimeReady:async()=>calls.push(['ready']),persistTowerMode:async value=>calls.push(['persist',value]),
   createCharacterStartMessage:()=> '已填写开局',
   document:{createElement:()=>{throw Error('start must not create a confirmation dialog');}},
   confirm:()=>{throw Error('unexpected confirmation');},
 };
 runInNewContext(js,context);await result.start();
 assert.equal(calls.filter(([kind])=>kind==='start').length,ready?1:0);
 if(ready){assert.deepEqual(calls.map(([kind])=>kind),['ready','persist','start']);assert.equal(calls[2][1].config,config);await result.start();assert.equal(calls.filter(([kind])=>kind==='start').length,1);}
}
console.log('PASS save button precedes direct start, no modal or confirmation, readiness and duplicate-start guards remain effective.');
