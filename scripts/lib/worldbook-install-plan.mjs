import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';

const extensionFields={group:'group',group_override:'groupOverride',scan_depth:'scanDepth',
  prevent_recursion:'preventRecursion',exclude_recursion:'excludeRecursion',depth:'depth',position:'position',role:'role'};

/** Existing managed MVU entries only. Preserve identity, order and unrelated data. */
export function planWorldbookUpdate(characterBook, liveBook, config, contents) {
  assert.ok(Array.isArray(characterBook?.entries));
  assert.ok(liveBook?.entries && !Array.isArray(liveBook.entries));
  assert.ok(Array.isArray(liveBook.originalData?.entries),'missing imported-book provenance');
  const embedded=structuredClone(characterBook),live=structuredClone(liveBook),changes=[];
  for(const [name,settings] of Object.entries(config)) {
    if(!settings.comment?.startsWith('[mvu_update]')) continue;
    assert.equal(typeof contents[name],'string',`missing source ${name}`);
    const find=(entries,label)=>{
      const matches=entries.filter(entry=>entry.comment===settings.comment);
      assert.equal(matches.length,1,`${label}: ambiguous/missing ${name}`);
      return matches[0];
    };
    const entry=find(embedded.entries,'embedded');
    const runtime=find(Object.values(live.entries),'linked');
    const original=find(live.originalData.entries,'originalData');
    assert.equal(runtime.uid,entry.id,`identity drift ${name}`);
    assert.equal(original.id,entry.id,`original identity drift ${name}`);
    assert.equal(runtime.content,entry.content,`linked content drift ${name}`);
    assert.equal(original.content,entry.content,`imported content drift ${name}`);
    const before=structuredClone({entry,runtime,original});
    const update=(field,runtimeField,value,inverse=false)=>{
      if(Object.hasOwn(entry,field)) assert.deepEqual(runtime[runtimeField],inverse?!entry[field]:entry[field],`linked ${field} drift ${name}`);
      entry[field]=structuredClone(value); original[field]=structuredClone(value);
      runtime[runtimeField]=inverse?!value:structuredClone(value);
    };
    entry.content=runtime.content=original.content=contents[name];
    for(const [field,other] of Object.entries({keys:'key',secondary_keys:'keysecondary',constant:'constant',selective:'selective',enabled:'disable'})) {
      if(Object.hasOwn(settings,field)) update(field,other,settings[field],field==='enabled');
    }
    if(Object.hasOwn(settings,'use_regex')) entry.use_regex=original.use_regex=settings.use_regex;
    for(const [field,value] of Object.entries(settings.extensions||{})) {
      assert.ok(Object.hasOwn(extensionFields,field),`unmapped extension ${field}`);
      const other=extensionFields[field];
      if(Object.hasOwn(entry.extensions||{},field)) assert.deepEqual(runtime[other],entry.extensions[field],`linked ${field} drift ${name}`);
      (entry.extensions||={})[field]=structuredClone(value);
      (original.extensions||={})[field]=structuredClone(value);
      runtime[other]=structuredClone(value);
      (runtime.extensions||={})[field]=structuredClone(value);
    }
    if(!isDeepStrictEqual(before,{entry,runtime,original})) changes.push({name,id:entry.id,contentChanged:before.entry.content!==entry.content});
  }
  return {embedded,live,changes};
}
