import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {bindTowerStartPresets}=require('../src/common/towerStartPresets.ts');
class Element {
 constructor(){this.value='';this.textContent='';this.dataset={};this.listeners={};this.children=[];}
 addEventListener(type,fn){this.listeners[type]=fn;} replaceChildren(){this.children=[];} append(child){this.children.push(child);} focus(){}
}
const ids=['tower-start-panel','tower-preset-select','tower-preset-name','tower-preset-status','tower-preset-load','tower-preset-save','tower-preset-delete',...['name','profession','description','world','opening','card','requirements'].map(id=>'tower-start-'+id)];
const make=()=>{const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));return {elements,getElementById:id=>elements[id],createElement:()=>new Element()};};
const data=new Map();const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
let selected=[]; const options={getSelectedMechanics:()=>selected,setSelectedMechanics:ids=>{selected=ids}};
let doc=make();bindTowerStartPresets(doc,storage,options);selected=['summon'];let e=doc.elements;
e['tower-start-card'].value='欲望主轴\n召唤与强化';e['tower-start-panel'].listeners.input({target:e['tower-start-card']});
e['tower-preset-name'].value='召唤流';e['tower-preset-save'].listeners.click();
selected=[];doc=make();bindTowerStartPresets(doc,storage,options);e=doc.elements;assert.equal(e['tower-start-card'].value,'欲望主轴\n召唤与强化');assert.deepEqual(selected,['summon'],'named preset restores selected mechanics separately');
e['tower-start-card'].value='第二套';e['tower-preset-name'].value='第二套';e['tower-preset-save'].listeners.click();
e['tower-preset-select'].value='0';e['tower-preset-load'].listeners.click();assert.equal(e['tower-start-card'].value,'欲望主轴\n召唤与强化');
e['tower-preset-delete'].listeners.click();assert.equal(e['tower-start-card'].value,'欲望主轴\n召唤与强化','deleting a preset preserves form');
assert.equal(JSON.parse([...data.values()][0]).presets.length,1);
e['tower-preset-name'].value='';e['tower-start-name'].value='测试角色';e['tower-preset-save'].listeners.click();
assert.equal(JSON.parse([...data.values()][0]).presets.at(-1).name,'测试角色','one-click save can use the character name without a dialog');
const corrupt={getItem:()=>'{bad',setItem:()=>{throw Error('quota');}};doc=make();bindTowerStartPresets(doc,corrupt);
doc.elements['tower-start-panel'].listeners.input({target:doc.elements['tower-start-card']});assert.match(doc.elements['tower-preset-status'].textContent,/保存失败/);
console.log('PASS named preset save/load/delete, multiline draft restore and unavailable storage handling.');
