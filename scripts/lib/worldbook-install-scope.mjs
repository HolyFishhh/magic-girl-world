import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';

// Independent write-set guard: a reviewed JSON plan is not itself authority.
export function assertWorldbookInstallScope(plan, { contentOnlyPlotComments = [] } = {}) {
  const ids=new Set(plan.changes.map(x=>x.id));
  assert.equal(ids.size,plan.changes.length,'duplicate changed ID');
  const actual=new Set();
  const ext=['group','group_override','scan_depth','prevent_recursion','exclude_recursion','depth','position','role'];
  function entries(before,after,live=false){
    assert.deepEqual(Object.keys(after),Object.keys(before),'entry identity/order changed');
    for(const key of Object.keys(before)){
      const a=before[key],b=after[key],id=live?a.uid:a.id;
      if(isDeepStrictEqual(a,b))continue;
      const plotContentOnly = a.comment?.startsWith('[mvu_plot]') && contentOnlyPlotComments.includes(a.comment);
      assert.ok(ids.has(id)&&(a.comment?.startsWith('[mvu_update]')||plotContentOnly),'unmanaged entry changed');
      actual.add(id);
      if (plotContentOnly) {
        assert.deepEqual({...b,content:a.content},a,'plot update may change content only');
        continue;
      }
      const copy=structuredClone(b);
      const fields=live?['content','key','keysecondary','constant','selective','disable','group','groupOverride','scanDepth','preventRecursion','excludeRecursion','depth','position','role']
        :['content','keys','secondary_keys','constant','selective','enabled','use_regex'];
      for(const field of fields){if(Object.hasOwn(a,field))copy[field]=structuredClone(a[field]);else delete copy[field];}
      for(const field of ext){
        if(Object.hasOwn(a.extensions||{},field))(copy.extensions||={})[field]=structuredClone(a.extensions[field]);
        else if(copy.extensions)delete copy.extensions[field];
      }
      if(!Object.hasOwn(a,'extensions')&&copy.extensions&&Object.keys(copy.extensions).length===0)delete copy.extensions;
      assert.deepEqual(copy,a,'identity, order or noncontract field changed');
    }
  }
  entries(plan.beforeEmbedded.entries,plan.embedded.entries);
  entries(plan.beforeLive.entries,plan.live.entries,true);
  entries(plan.beforeLive.originalData.entries,plan.live.originalData.entries);
  const embedded={...plan.embedded,entries:plan.beforeEmbedded.entries};
  assert.deepEqual(embedded,plan.beforeEmbedded,'embedded root changed');
  const live={...plan.live,entries:plan.beforeLive.entries,originalData:{...plan.live.originalData,entries:plan.beforeLive.originalData.entries}};
  assert.deepEqual(live,plan.beforeLive,'linked root changed');
  assert.deepEqual([...actual].sort(),[...ids].sort(),'declared changed IDs differ');
}
