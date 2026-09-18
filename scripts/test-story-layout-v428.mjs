import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the current renderer with a small DOM host; no save writes or network.
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.className='';this.hidden=false;this.classList={toggle:()=>{}};this._text='';}
  get childElementCount(){return this.children.length;}
  get nextElementSibling(){const p=this.parentElement;return p?.children[p.children.indexOf(this)+1]||null;}
  get previousElementSibling(){const p=this.parentElement;return p?.children[p.children.indexOf(this)-1]||null;}
  closest(selector){return selector==='.'+this.className?this:this.parentElement?.closest(selector)||null;}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  set textContent(v){this._text=v;this.replaceChildren();}
  append(...nodes){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}
  prepend(n){n.remove();n.parentElement=this;this.children.unshift(n);}
  remove(){if(this.parentElement){const p=this.parentElement;p.children=p.children.filter(c=>c!==this);this.parentElement=null;}}
  after(n){n.remove();const p=this.parentElement;n.parentElement=p;p.children.splice(p.children.indexOf(this)+1,0,n);}
  before(n){n.remove();const p=this.parentElement;n.parentElement=p;p.children.splice(p.children.indexOf(this),0,n);}
  replaceChildren(){for(const c of this.children)c.parentElement=null;this.children=[];}
  contains(n){return this===n||this.children.some(c=>c.contains(n));}
  querySelector(selector){return this.children.flatMap(c=>[c,...c.descendants()]).find(c=>selector.startsWith('.')?c.className===selector.slice(1):c.tagName===selector)||null;}
  descendants(){return this.children.flatMap(c=>[c,...c.descendants()]);}
}
const document={body:new Element('body'),documentElement:new Element('html'),createElement:tag=>new Element(tag)};
document.getElementById=id=>document.body.descendants().find(e=>e.id===id)||null;
document.querySelector=s=>document.body.querySelector(s);
const mount=(tag,id)=>{const e=new Element(tag);e.id=id;document.body.append(e);return e;};
const player=mount('div','tower-player-panel'),map=mount('div','tower-map-root'),rewards=mount('div','choice-container'),node=mount('div','tower-node-panel-root');
let variables={stat_data:{game_mode:'tower',run:{seed:1,act:1,floor:2,opening:{phase:'consumed'},visitedNodeIds:['one','two'],nodeContent:{one:{kind:'event',content:{narrative:'第一处剧情'}},two:{kind:'battle',content:{narrative:'最新战斗剧情'}}}}},mwg_tower_initial_commit:{narrative:'开局剧情'}};
const module={exports:{}};
const context={module,exports:module.exports,document,window:{},requestAnimationFrame(){},require(name){
  if(name.includes('messageVariables'))return {getCurrentMessageVariables:()=>variables,getCurrentChatMessageText:()=>''};
  if(name.includes('towerMode'))return {readGameMode:()=> 'tower'};
  throw new Error(name);
}};
vm.runInNewContext(ts.transpileModule(readFileSync('src/runtime/storyPanel.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const render=module.exports.renderStoryPanel;
assert.equal(typeof render,'function');render('common',node);
const root=document.getElementById('mwg-story-panel'),route=document.getElementById('mwg-route-fold');
assert.equal(root.querySelector('.story-prose').textContent,'最新战斗剧情');
const activity=document.getElementById('mwg-adventure-fold');
assert.deepEqual(activity.children.slice(1),[root,node,rewards],'latest prose and room/rewards form first section');
assert.deepEqual(route.children.slice(1),[map],'route is its own section');
assert.equal(activity.nextElementSibling,route);
assert.equal(route.nextElementSibling.id,'mwg-status-fold');
assert.equal(player.parentElement.id,'mwg-status-fold');
const history=root.querySelector('details');assert.ok(history.textContent.includes('开局剧情'));assert.ok(history.textContent.includes('第一处剧情'));assert.ok(!history.textContent.includes('最新战斗剧情'));
assert.ok(!history.open,'history starts collapsed');
history.open=true;const prose=root.querySelector('.story-prose');
for(let i=0;i<10;i++)render('common');
assert.equal(root.querySelector('.story-prose'),prose,'unchanged polling preserves DOM and selection');
assert.equal(root.querySelector('details'),history,'unchanged polling preserves expanded history');
variables.stat_data.run_node={node_id:'three',narrative:'当前节点剧情'};render('common',node);
assert.equal(root.querySelector('.story-prose').textContent,'当前节点剧情');assert.ok(root.querySelector('details').textContent.includes('最新战斗剧情'));
assert.equal(document.body.descendants().filter(e=>e.id==='mwg-story-panel').length,1,'rerender does not duplicate prose');
assert.equal(root.querySelector('details').open,true,'new narrative keeps history open');
variables.stat_data.run_node={node_id:'four'};
variables.stat_data.run.currentNode={id:'four',floor:4};
render('common');
variables.stat_data.run.nodeContent.four={kind:'battle',content:{narrative:'后台稍后送达的完整新剧情'}};
render('common');assert.equal(root.querySelector('.story-prose').textContent,'后台稍后送达的完整新剧情');
const board=mount('div','board');board.className='card-game-container';
const scene=mount('div','battle-scene');board.append(scene);render('fish');assert.equal(board.previousElementSibling,root);
console.log('PASS current-source DOM: latest scene, collapsed visited history, route/rewards/status separation, rerender and battle placement. Browser appearance is not verified.');
