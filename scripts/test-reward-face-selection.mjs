import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {bindRewardSelectionSurface,refreshRewardSelectionSurfaces}=require('../src/shared/rewardSelectionInteraction.ts');
class Face {
  attrs={};tabIndex=-1;
  constructor(excluded=false){this.excluded=excluded;}
  closest(){return this.excluded?this:null;}
  matches(){return true;}
  setAttribute(k,v){this.attrs[k]=v;}
}
globalThis.Element=Face;
function make(){
  const handlers={}, face=new Face(),classes=new Set();let changes=0;
  const input={checked:false,disabled:false,closest:()=>option,click(){this.checked=!this.checked;changes++;}};
  const option={querySelector:()=>input,querySelectorAll:()=>[face],addEventListener:(name,fn)=>handlers[name]=fn,classList:{toggle:(k,v)=>v?classes.add(k):classes.delete(k)}};
  bindRewardSelectionSurface(input);
  return {input,face,option,handlers,classes,changes:()=>changes};
}
const a=make(),b=make();const root={querySelectorAll:()=>[a.option,b.option]};
let prevented=0;const click=target=>({target,preventDefault(){prevented++;}});
a.handlers.click(click(a.face));refreshRewardSelectionSurfaces(root);
assert.equal(a.input.checked,true);assert.equal(a.changes(),1);assert.equal(a.face.attrs['aria-pressed'],'true');assert.ok(a.classes.has('is-selected'));
a.handlers.click(click(a.input));assert.equal(a.changes(),1,'forwarded checkbox event does not recurse');
a.handlers.click(click(new Face(true)));assert.equal(a.changes(),1,'summary/status/action does not select');
a.handlers.keydown({...click(a.face),key:' '});refreshRewardSelectionSurfaces(root);assert.equal(a.input.checked,false);
b.input.checked=true;refreshRewardSelectionSurfaces(root);assert.equal(a.face.attrs['aria-pressed'],'false');assert.equal(b.face.attrs['aria-pressed'],'true');
a.input.disabled=true;a.handlers.click(click(a.face));assert.equal(a.input.checked,false);
assert.equal(prevented,2);
console.log('PASS reward face click/keyboard toggles once, highlight syncs, nested details and disabled rewards do not select.');
