import assert from 'node:assert/strict';
import {planWorldbookUpdate} from './lib/worldbook-install-plan.mjs';
import {assertWorldbookInstallScope} from './lib/worldbook-install-scope.mjs';
const entry={id:9,comment:'[mvu_update] managed',content:'old',keys:['old'],enabled:true,insertion_order:42,
  extensions:{scan_depth:1,custom:'keep'}};
const plot={id:3,comment:'[mvu_plot] keep',content:'user narrative',keys:[],extensions:{custom:'plot'}};
const embedded={name:'same-name',entries:[plot,entry],custom:{keep:true}};
const live={entries:{9:{uid:9,comment:entry.comment,content:'old',key:['old'],disable:false,scanDepth:1,
  order:42,extensions:{scan_depth:1,custom:'keep'},custom:'live-only'},3:{uid:3,comment:plot.comment,content:plot.content}},
  originalData:structuredClone(embedded),custom:{keep:true}};
const config={managed:{comment:entry.comment,keys:['new'],extensions:{scan_depth:2}},plot:{comment:plot.comment}};
const inputs=structuredClone({embedded,live,config});
const result=planWorldbookUpdate(embedded,live,config,{managed:'new source'});
assert.deepEqual({embedded,live,config},inputs,'planner must not mutate any input');
assert.deepEqual(result.embedded.entries[0],plot);
assert.deepEqual(result.live.entries[3],live.entries[3]);
assert.deepEqual(result.live.originalData.entries[0],plot);
assert.equal(result.embedded.entries[1].id,9);
assert.equal(result.embedded.entries[1].insertion_order,42);
assert.equal(result.live.entries[9].order,42);
assert.equal(result.live.entries[9].custom,'live-only');
assert.equal(result.live.entries[9].extensions.custom,'keep');
assert.equal(result.live.entries[9].scanDepth,2);
assert.equal(result.live.entries[9].extensions.scan_depth,2);
assert.deepEqual(result.live.entries[9].key,['new']);
assert.equal(result.live.originalData.entries[1].content,'new source');
assert.deepEqual(result.live.custom,live.custom);
assert.equal(planWorldbookUpdate(result.embedded,result.live,config,{managed:'new source'}).changes.length,0,'plan is idempotent');
for(const mutate of [
  x=>{x.entries[9].content='user edit';},
  x=>{x.entries[9].key=['user key'];},
  x=>{x.entries[9].scanDepth=8;},
  x=>{x.entries[10]=structuredClone(x.entries[9]);},
  x=>{x.entries[9].uid=99;},
  x=>{delete x.originalData;},
]){
  const changed=structuredClone(live);mutate(changed);
  assert.throws(()=>planWorldbookUpdate(embedded,changed,config,{managed:'new source'}));
}
assert.throws(()=>planWorldbookUpdate(embedded,live,config,{}));
assert.throws(()=>planWorldbookUpdate(embedded,live,{managed:{...config.managed,extensions:{unknown:true}}},{managed:'new'}));
console.log('PASS worldbook scoped plan, input/plot/identity preservation, idempotence and drift rejection. No host writes.');
const plotPlan={beforeEmbedded:embedded,beforeLive:live,embedded:structuredClone(embedded),live:structuredClone(live),changes:[{id:3}]};
plotPlan.embedded.entries[0].content=plotPlan.live.entries[3].content=plotPlan.live.originalData.entries[0].content='new plot contract';
assert.throws(()=>assertWorldbookInstallScope(plotPlan),/unmanaged/,'plan metadata alone never grants plot writes');
assertWorldbookInstallScope(plotPlan,{contentOnlyPlotComments:[plot.comment]});
const changedPlotConfig=structuredClone(plotPlan);changedPlotConfig.embedded.entries[0].keys=['changed'];
assert.throws(()=>assertWorldbookInstallScope(changedPlotConfig,{contentOnlyPlotComments:[plot.comment]}),/content only/);
assert.throws(()=>assertWorldbookInstallScope(plotPlan,{contentOnlyPlotComments:['[mvu_plot] different']}),/unmanaged/);
console.log('PASS explicit plot-content scope preserves routing/settings and rejects undeclared entries.');
