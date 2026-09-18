import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {installGenerationDiagnosticPanel}=require('../src/shared/generationDiagnosticPanel.ts');
class Element {
  children=[];dataset={};style={};isConnected=true;listeners={};textContent='';
  constructor(tag){this.tag=tag;}
  append(...values){this.children.push(...values);}
  querySelector(){return this.children.find(x=>'generationDiagnostics' in x.dataset)||null;}
  addEventListener(type,fn){this.listeners[type]=fn;}
}
let tick,cleared=false,report=null,copied='',opened=false;
global.document={createElement:tag=>new Element(tag)};
global.window={setInterval:fn=>(tick=fn,1),clearInterval:()=>cleared=true,addEventListener:()=>{}};
Object.defineProperty(global,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>copied=value}}});
global.MagicGirlWorld={getGenerationDiagnosticReport:()=>report,getMvuMonitorSnapshot:()=>({phase:'idle'}),openGenerationDiagnostics:()=>opened=true};
const root=new Element('main');installGenerationDiagnosticPanel(root);installGenerationDiagnosticPanel(root);
assert.equal(root.children.length,1);
const panel=root.children[0],body=panel.children[1],copy=panel.children[2],inspect=panel.children[3];
assert.equal(copy.disabled,true);
report={phase:'error',generationId:'test',startedAt:1000,detail:'battle.cards[6].effects: INVALID_MODIFIER',timeline:[{at:4000,label:'完整运行校验',detail:'未发出修复请求'}]};
tick();assert.equal(panel.open,true);assert.match(body.textContent,/3.0s/);assert.match(body.textContent,/cards\[6\]/);
await copy.listeners.click();assert.equal(copied,body.textContent);
inspect.listeners.click();assert.equal(opened,true);
root.isConnected=false;tick();assert.equal(cleared,true);
console.log('PASS persistent visible error panel, explicit copy, diagnostic inspector, singleton and teardown.');
