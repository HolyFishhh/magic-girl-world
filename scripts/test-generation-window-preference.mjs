import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync('src/runtime/characterRuntime.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function boot(enabled,previous=[]){
  const stored=new Map([['mwg:settings-center:v2',JSON.stringify({showMvuWindow:enabled})],...previous]),nodes=new Map();
  const close={addEventListener(type,fn){this[type]=fn;}},toggle={dataset:{mwgMonitorSetting:'showMvuWindow'},checked:enabled,addEventListener(type,fn){this[type]=fn;}};
  const open={addEventListener(type,fn){this[type]=fn;}};
  const loadingTitle={textContent:''},loadingDetail={textContent:''};
  const stop={hidden:true,disabled:false,addEventListener(type,fn){this[type]=fn;}},feedback={textContent:''};
  let doc;
  const evidenceHistory={style:{},dataset:{},children:[],childElementCount:0,replaceChildren(){this.children=[];this.childElementCount=0;},append(...children){this.children.push(...children);this.childElementCount=this.children.length;},appendChild(child){this.append(child);}};
  const element=()=>({style:{},dataset:{},children:[],childElementCount:0,append(...children){this.children.push(...children);this.childElementCount=this.children.length;},appendChild(child){this.append(child);},replaceChildren(){this.children=[];this.childElementCount=0;},addEventListener(type,fn){this[type]=fn;},querySelector:selector=>selector==='[data-action="cancel-tower-generation"]'?stop:selector==='[data-mwg-diagnostic-feedback]'?feedback:selector==='[data-action="open-mvu"]'?open:selector==='[data-action="close-mvu"]'?close:selector==='[data-mwg-monitor-loading-title]'?loadingTitle:selector==='[data-mwg-monitor-loading-detail]'?loadingDetail:selector==='[data-mwg-evidence-history]'?evidenceHistory:null,querySelectorAll:selector=>selector==='[data-mwg-monitor-setting]'?[toggle]:[],remove(){},setAttribute(){}});
  doc={getElementById:id=>nodes.get(id),createElement:()=>{const node=element();node.ownerDocument=doc;return node;}};
  evidenceHistory.ownerDocument=doc;
  const append=node=>{nodes.set(node.id,node);node.isConnected=true;};doc.body={appendChild:append};doc.head={appendChild:append};
  const ctx={document:doc,localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},console,
    __MWG_BUILD_INFO__:{cardVersion:'test',views:{}},__MWG_VIEW_ASSETS__:Object.fromEntries(['start','common','fish','update'].map(n=>[n,{}])),
    SillyTavern:{getContext:()=>({chatId:'isolated-test'})},setTimeout(){return 1},clearTimeout(){},setInterval(){return 2},clearInterval(){},eventOn(){},eventRemoveListener(){},initializeGlobal(name,value){ctx[name]=value;}};
  ctx.globalThis=ctx;vm.runInNewContext(source,ctx);
  return {monitor:ctx.MagicGirlWorldMvuMonitor,nodes,open,close,toggle,stored,loadingTitle,loadingDetail,evidenceHistory,stop,feedback,ctx};
}
for(const enabled of [true,false]){
  const {monitor,nodes,open,close,toggle,stored,loadingTitle,loadingDetail,ctx}=boot(enabled);
  monitor.beginStructuredOperation({generationId:'opening',detail:'开局生成'});
  assert.equal(monitor.getSnapshot().open,enabled);
  assert.equal(nodes.get('mwg-mvu-monitor').dataset.mvuOpen,String(enabled),'actual render state follows setting');
  close.click();
  monitor.beginStructuredOperation({generationId:'opening',detail:'开局校验'});
  assert.equal(monitor.getSnapshot().open,false,'same operation does not reopen after manual close');
  monitor.applyStructuredOperation({generationId:'opening',detail:'应用结果'});
  assert.equal(monitor.getSnapshot().open,false);
  assert.equal(loadingTitle.textContent,'正在处理游戏内容');
  assert.equal(loadingDetail.textContent,'应用结果');
  monitor.applyStructuredOperation({generationId:'opening',detail:'正在本地复测战斗（2/3）'});
  assert.equal(loadingDetail.textContent,'正在本地复测战斗（2/3）','render the real local stage instead of claiming the model or save is still running');
  monitor.completeStructuredOperation({generationId:'opening',summary:'完成'});
  monitor.receiveTowerGenerationStatus({requestId:'next-node',nodeId:'act-1-floor-2-col-0',phase:'running'});
  assert.equal(monitor.getSnapshot().open,false,'playable-run prefetch stays quiet even with the preference enabled');
  monitor.openSettings();
  open.click();
  assert.equal(monitor.getSnapshot().open,true,'manual show works even when automatic display is disabled');
  close.click();
  ctx.MagicGirlWorld.openGenerationDiagnostics();
  assert.equal(monitor.getSnapshot().open,true,'route notice opens the same progress popup directly');
  assert.equal(nodes.get('mwg-mvu-monitor').dataset.settingsOpen,'false','route progress does not open a second settings sheet');
  monitor.beginStructuredOperation({generationId:'tower-task:next-node',autoOpen:false,detail:'后台更新'});
  assert.equal(monitor.getSnapshot().open,true,'same background operation preserves manual opening');
  assert.equal((nodes.get('mwg-mvu-monitor').innerHTML.match(/<pre data-mwg-mvu-timeline>/g)||[]).length,1,'timeline only exists in the popup');
  close.click();
  monitor.receiveTowerGenerationStatus({requestId:'next-node__structure_repair_1',nodeId:'act-1-floor-2-col-0',phase:'retrying',attempt:1});
  assert.equal(monitor.getSnapshot().open,false,'repair status belongs to the dismissed operation');
  toggle.checked=!enabled;toggle.change();
  assert.equal(JSON.parse(stored.get('mwg:settings-center:v2')).showMvuWindow,!enabled);
  monitor.beginStructuredOperation({generationId:'later-node',detail:'下一节点',autoOpen:false});
  assert.equal(monitor.getSnapshot().open,false,'direct background progress also stays quiet');
  monitor.beginStructuredOperation({generationId:'new-opening',detail:'新开局'});
  assert.equal(monitor.getSnapshot().open,!enabled,'new initialization still follows the preference');
  monitor.receiveTowerGenerationStatus({requestId:'legacy-opening',nodeId:'__tower_opening__',phase:'running'});
  assert.equal(monitor.getSnapshot().open,false,'queue updates alone cannot auto-open a later act or background opening');
  monitor.resetForChat('another-chat');assert.equal(monitor.getSnapshot().open,false);
}
{
  const first=boot(true);
  first.monitor.beginStructuredOperation({generationId:'retained-one',detail:'首轮'});
  first.monitor.fail(new Error('failure'), 'retained-one');
  first.monitor.beginStructuredOperation({generationId:'retained-two',detail:'后续生成'});
  const reloaded=boot(true,[...first.stored]);
  const report=reloaded.monitor.getDiagnosticReport();
  assert.equal(report.generationId,'retained-two','restart exports the latest request');
  assert.equal(report.recentRequests.some(entry=>entry.generationId==='retained-one'),true,'later requests preserve previous failure evidence');
  reloaded.monitor.resetForChat('different-chat');
  assert.equal(reloaded.monitor.getDiagnosticReport(),null,'history never exports a different chat');
}
{
  const {monitor,evidenceHistory,ctx}=boot(true);
  ctx.MagicGirlDesignAssistant={getInitialGenerationEvidence:()=>({retention:{maxRuns:8},runs:[{
    generationId:'retained-draft',startedAt:0,updatedAt:1,outcome:'failed',archive:{status:'pending'},records:[],
  }]})};
  assert.doesNotThrow(()=>monitor.openSettings(),'retained evidence uses its owning document when rendered');
  assert.equal(evidenceHistory.childElementCount,2,'render retained evidence summary and its expandable record');
  assert.equal(evidenceHistory.children[1].children[0].textContent.includes('retained-draft'),true);
}
{
  const {monitor,ctx}=boot(true);
  ctx.MagicGirlDesignAssistant={getInitialGenerationEvidence:()=>{throw new Error('diagnostic display failure');}};
  assert.doesNotThrow(()=>monitor.openSettings(),'diagnostic rendering failure cannot block an active generation display');
  assert.doesNotThrow(()=>monitor.beginStructuredOperation({generationId:'draft',detail:'草稿已返回'}));
  assert.doesNotThrow(()=>monitor.applyStructuredOperation({generationId:'draft',detail:'正在解析与校验'}));
  assert.equal(monitor.getSnapshot().phase,'applying','display-only error does not change generation phase');
}
console.log('PASS actual runtime generation window: enabled/disabled, opening/node, close, repair, setting persistence, retained evidence rendering and display failure isolation.');

{
  const first=boot(true);
  first.monitor.beginStructuredOperation({generationId:'pending-before-restart',detail:'等待模型返回',autoOpen:false});
  const restarted=boot(true,[...first.stored]);
  assert.equal(restarted.monitor.getDiagnosticReport().generationId,'pending-before-restart','unfinished stage diagnostics survive runtime restart');
  assert.equal(restarted.monitor.getSnapshot().open,false,'restoring records does not open a stale operation');
}

{
  const {monitor,ctx,stop,close,feedback}=boot(true);
  let calls=0,settle;
  ctx.MagicGirlDesignAssistant={cancelTowerGenerationById:({generationId})=>{
    calls++; assert.equal(generationId,'tower-task:boss-retry');
    return new Promise(resolve=>{settle=resolve;});
  }};
  monitor.beginStructuredOperation({generationId:'tower-task:boss-retry',autoOpen:false,detail:'等待模型'});
  monitor.applyStructuredOperation({generationId:'tower-task:boss-retry',detail:'第二次请求'});
  assert.equal(stop.hidden,false,'background retry is stoppable during applying phase');
  close.click(); assert.equal(calls,0,'closing only hides the popup');
  ctx.MagicGirlWorld.openGenerationDiagnostics();
  stop.click(); stop.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1,'repeated clicks do not dispatch concurrent stops');
  assert.equal(stop.disabled,true);
  settle(true); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stop.disabled,false);
  assert.match(feedback.textContent,/已停止/);
  monitor.completeStructuredOperation({generationId:'tower-task:boss-retry',summary:'结束'});
  assert.equal(stop.hidden,true,'completed generations do not offer an active stop');
}
