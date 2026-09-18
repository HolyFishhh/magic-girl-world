import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/runtime/characterRuntime.ts','utf8');
const start=source.indexOf('const renderEvidenceHistory = (): void => {');
const end=source.indexOf('    const renderMvuProcess', start);
assert.ok(start>=0&&end>start);
class Element {
  children=[]; textContent=''; className='';
  append(...children){this.children.push(...children)}
  replaceChildren(){this.children=[]}
  addEventListener(){}
  get childElementCount(){return this.children.length}
}
const container=new Element();container.ownerDocument={createElement:()=>new Element()};
let tower={chatId:'chat',retention:{droppedRecords:0},records:[{requestId:'r',stage:'request',recordedAt:1}]};
const context={root:{querySelector:()=>container},monitorState:{settingsVisible:true,chatId:'chat'},readEvidenceHistory:()=>null,readTowerEvidenceHistory:()=>tower,console};
vm.createContext(context);
vm.runInContext(ts.transpile('let evidenceHistorySignature="";'+source.slice(start,end)+';globalThis.render=renderEvidenceHistory;', {target:ts.ScriptTarget.ES2022}),context);
context.render();assert.equal(container.children.length,2,'tower-only history renders without initial history');
let first=container.children[1];assert.match(first.children[0].textContent,/1 条/);
tower.records.push({requestId:'r',stage:'response',recordedAt:2});
context.render();assert.notEqual(container.children[1],first);assert.match(container.children[1].children[0].textContent,/2 条/,'new response invalidates history signature');
first=container.children[1];context.render();assert.equal(container.children[1],first,'unchanged history avoids DOM replacement');
console.log('PASS tower-only history and subsequent responses refresh without initial-generation changes');
